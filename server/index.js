const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { exec, execFile } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const LEGACY_STATE_FILE = path.join(__dirname, "state.json");

const STATE_FILE =
  process.env.SMART_MIRROR_STATE_FILE ||
  path.join(os.homedir(), ".local", "share", "smart-mirror-os", "state.json");

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { fetchJellyfinNowPlaying } = require("./providers/jellyfinNowPlaying");
const { fetchJellyfinTriviaForMedia } = require("./providers/jellyfinTrivia");
const {
  fetchSpotifyNowPlaying,
  resetSpotifyAccessTokenCache,
} = require("./providers/spotifyNowPlaying");
const {
  saveJellyfinSecrets,
  getSpotifySecrets,
  saveSpotifySecrets,
  saveWeatherConfig,
  saveCalendarConfig,
  getEditableProviderConfig,
  getRedactedProviderSecrets,
} = require("./secretsStore");
const { fetchMirrorWeather } = require("./providers/weatherOpenMeteo");
const { fetchMirrorAgenda } = require("./providers/calendarFeeds");

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [
  process.env.ADMIN_ALLOWED_ORIGIN,
  "http://localhost:4173",
  "http://127.0.0.1:4173",
].filter(Boolean);

const { startLightSensor, readLightSensor } = require("./sensors/veml7700");

function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
});

console.log("[boot] backend process starting");

const PERF_LOG_ENABLED = process.env.PERF_LOG_ENABLED === "1";

app.post("/debug/perf", (req, res) => {
  if (!PERF_LOG_ENABLED) {
    res.sendStatus(204);
    return;
  }

  console.log("[perf]", JSON.stringify(req.body));
  res.sendStatus(204);
});

const HEARTBEAT_INTERVAL_MS = 25000;
const NOW_PLAYING_IDLE_POLL_INTERVAL_MS = 10000;
const NOW_PLAYING_ACTIVE_POLL_INTERVAL_MS = 2500;
const LYRICS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LYRICS_NOT_FOUND_CACHE_TTL_MS = 15 * 60 * 1000;

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const LRCLIB_GET_URL = "https://lrclib.net/api/get";
const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-library-read",
];
const SPOTIFY_STATE_TTL_MS = 10 * 60 * 1000;

const pendingSpotifyStates = new Map();
const lyricsCache = new Map();
const lyricsPendingRequests = new Map();

function cleanupPendingSpotifyStates() {
  const now = Date.now();

  for (const [stateKey, expiresAt] of pendingSpotifyStates.entries()) {
    if (expiresAt <= now) {
      pendingSpotifyStates.delete(stateKey);
    }
  }
}

function getBasicAuthorizationHeader(clientId, clientSecret) {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function buildSpotifyAuthorizeUrl() {
  const spotifySecrets = getSpotifySecrets();
  const state = crypto.randomBytes(16).toString("hex");

  cleanupPendingSpotifyStates();
  pendingSpotifyStates.set(state, Date.now() + SPOTIFY_STATE_TTL_MS);

  const url = new URL(SPOTIFY_AUTHORIZE_URL);
  url.searchParams.set("client_id", spotifySecrets.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", spotifySecrets.redirectUri);
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("show_dialog", "true");

  return url.toString();
}

async function exchangeSpotifyAuthorizationCode(code) {
  const spotifySecrets = getSpotifySecrets();

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthorizationHeader(
        spotifySecrets.clientId,
        spotifySecrets.clientSecret,
      ),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifySecrets.redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Spotify code exchange gaf status ${response.status} · ${errorText}`,
    );
  }

  const payload = await response.json();

  if (!payload.refresh_token) {
    throw new Error("Spotify gaf geen refresh_token terug");
  }

  return payload;
}

function markWebSocketAlive() {
  this.isAlive = true;
}

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) {
      client.terminate();
      return;
    }

    client.isAlive = false;
    client.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

const WIDGET_IDS = ["clock", "weather", "media", "calendar"];

const WIDGET_EDGE_POSITIONS = [
  "top-left",
  "top-right",
  "left-middle",
  "right-middle",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const WIDGET_DEFAULT_EDGE_POSITIONS = {
  clock: "top-left",
  weather: "top-left",
  media: "bottom-right",
  calendar: "bottom-left",
};

const FOCUS_SOURCES = ["manual", "media-auto"];
const MEDIA_STATUSES = ["idle", "playing", "paused", "error"];
const MEDIA_KINDS = ["movie", "episode", "track", "podcast", "unknown"];
const MEDIA_SOURCES = ["jellyfin", "spotify"];

function isWidgetId(value) {
  return typeof value === "string" && WIDGET_IDS.includes(value);
}

function isWidgetEdgePosition(value) {
  return typeof value === "string" && WIDGET_EDGE_POSITIONS.includes(value);
}

function getDefaultWidgetPosition(widgetId) {
  if (!isWidgetId(widgetId)) {
    return "bottom-right";
  }

  return WIDGET_DEFAULT_EDGE_POSITIONS[widgetId] ?? "bottom-right";
}

function getDefaultLayout() {
  return WIDGET_IDS.map((id) => ({
    id,
    enabled: true,
    position: getDefaultWidgetPosition(id),
  }));
}

const defaultState = {
  layout: getDefaultLayout(),
  settings: {
    showSeconds: true,
    mirrorMode: "normal",
    autoSleepEnabled: true,
    sleepTimeoutSeconds: 180,
    showStatusBar: false,
    layoutPaddingPx: 32,
    layoutPaddingTopPx: 32,
    layoutPaddingRightPx: 32,
    layoutPaddingBottomPx: 32,
    layoutPaddingLeftPx: 32,
    widgetGapPx: 16,
    zoomPercent: 100,
    focusIdleTimeoutSeconds: 45,
    mediaFocusExitDelaySeconds: 10,
    lightSensorEnabled: true,
    lightOffLuxThreshold: 13.5,
    lightOnLuxThreshold: 28,
    calibrationModeEnabled: false,
    mediaLyricsDefaultVisible: false,
    mediaLyricsUpdateIntervalMs: 1000,
    mediaJellyfinTriviaDefaultVisible: false,
  },
  presence: {
    mode: "idle",
    lastMotionAt: null,
  },
  light: {
    enabled: true,
    status: "unknown",
    mode: "unknown",
    raw: null,
    lux: null,
    roomLightOn: false,
    updatedAt: null,
    error: null,
  },
  display: {
    mode: "dimmed",
    reason: "initial",
    keepAwakeReason: null,
    updatedAt: Date.now(),
    focusedWidgetId: null,
    focusSource: null,
    focusSetAt: null,
    focusUntil: null,
    mediaIdleSince: null,
    mediaAutoFocusSuppressed: false,
    mediaAutoFocusSuppressedAt: null,
    mediaAutoFocusSuppressionSawActive: false,
    mediaLyricsVisible: false,
    mediaJellyfinTriviaVisible: false,
    mediaJellyfinTriviaSessionKey: null,
    spotifyContextKeepAwake: false,
    spotifyContextKeepAwakeSetAt: null,
  },
  deployment: {
    status: "idle",
    currentCommit: null,
    currentCommitMessage: null,
    remoteCommit: null,
    remoteCommitMessage: null,
    hasUpdate: false,
    lastCheckedAt: null,
    lastDeployedAt: null,
    message: null,
  },
  media: {
    status: "idle",
    source: null,
    kind: "unknown",
    title: "Geen media actief",
    subtitle: "Er wordt nu niets afgespeeld",
    secondaryText: "",
    sourceItemId: null,
    playSessionId: null,
    seriesTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    providerIds: {
      imdb: null,
      tmdb: null,
      tvdb: null,
    },
    productionYear: null,
    genres: [],
    communityRating: null,
    artworkUrl: null,
    progressMs: null,
    durationMs: null,
    deviceName: null,
    userName: null,
    isLiked: null,
    lastUpdatedAt: null,
    statusChangedAt: null,
    lastPlayed: null,
    sourceState: {
      jellyfin: {
        enabled: true,
        status: "idle",
        message: null,
        lastCheckedAt: null,
      },
      spotify: {
        enabled: true,
        status: "idle",
        message: null,
        lastCheckedAt: null,
      },
    },
  },
  logs: [],
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeSettings(input = {}) {
  const {
    idleTimeoutSeconds,
    sleepTimeoutSeconds,
    showSeconds,
    mirrorMode,
    autoSleepEnabled,
    showStatusBar,
    layoutPaddingPx,
    layoutPaddingTopPx,
    layoutPaddingRightPx,
    layoutPaddingBottomPx,
    layoutPaddingLeftPx,
    widgetGapPx,
    zoomPercent,
    focusIdleTimeoutSeconds,
    mediaFocusExitDelaySeconds,
    calibrationModeEnabled,
    mediaLyricsDefaultVisible,
    mediaLyricsUpdateIntervalMs,
    mediaJellyfinTriviaDefaultVisible,
  } = input;

  return {
    ...defaultState.settings,
    showSeconds:
      typeof showSeconds === "boolean"
        ? showSeconds
        : defaultState.settings.showSeconds,
    mirrorMode:
      mirrorMode === "portrait-left" ||
      mirrorMode === "portrait-right" ||
      mirrorMode === "normal"
        ? mirrorMode
        : defaultState.settings.mirrorMode,
    autoSleepEnabled:
      typeof autoSleepEnabled === "boolean"
        ? autoSleepEnabled
        : defaultState.settings.autoSleepEnabled,
    sleepTimeoutSeconds: clampNumber(
      sleepTimeoutSeconds ?? idleTimeoutSeconds,
      10,
      3600,
      defaultState.settings.sleepTimeoutSeconds,
    ),
    showStatusBar:
      typeof showStatusBar === "boolean"
        ? showStatusBar
        : defaultState.settings.showStatusBar,

    calibrationModeEnabled:
      typeof calibrationModeEnabled === "boolean"
        ? calibrationModeEnabled
        : defaultState.settings.calibrationModeEnabled,

    mediaLyricsDefaultVisible:
      typeof mediaLyricsDefaultVisible === "boolean"
        ? mediaLyricsDefaultVisible
        : defaultState.settings.mediaLyricsDefaultVisible,

    mediaLyricsUpdateIntervalMs:
      Math.round(
        clampNumber(
          mediaLyricsUpdateIntervalMs,
          250,
          1000,
          defaultState.settings.mediaLyricsUpdateIntervalMs,
        ) / 250,
      ) * 250,

    mediaJellyfinTriviaDefaultVisible:
      typeof mediaJellyfinTriviaDefaultVisible === "boolean"
        ? mediaJellyfinTriviaDefaultVisible
        : defaultState.settings.mediaJellyfinTriviaDefaultVisible,

    layoutPaddingPx: clampNumber(
      layoutPaddingPx,
      0,
      96,
      defaultState.settings.layoutPaddingPx,
    ),
    layoutPaddingTopPx: clampNumber(
      layoutPaddingTopPx ?? layoutPaddingPx,
      0,
      160,
      defaultState.settings.layoutPaddingTopPx,
    ),
    layoutPaddingRightPx: clampNumber(
      layoutPaddingRightPx ?? layoutPaddingPx,
      0,
      160,
      defaultState.settings.layoutPaddingRightPx,
    ),
    layoutPaddingBottomPx: clampNumber(
      layoutPaddingBottomPx ?? layoutPaddingPx,
      0,
      160,
      defaultState.settings.layoutPaddingBottomPx,
    ),
    layoutPaddingLeftPx: clampNumber(
      layoutPaddingLeftPx ?? layoutPaddingPx,
      0,
      160,
      defaultState.settings.layoutPaddingLeftPx,
    ),
    widgetGapPx: clampNumber(
      widgetGapPx,
      0,
      64,
      defaultState.settings.widgetGapPx,
    ),
    zoomPercent: clampNumber(
      zoomPercent,
      50,
      150,
      defaultState.settings.zoomPercent,
    ),
    focusIdleTimeoutSeconds: clampNumber(
      focusIdleTimeoutSeconds,
      10,
      3600,
      defaultState.settings.focusIdleTimeoutSeconds,
    ),
    mediaFocusExitDelaySeconds: clampNumber(
      mediaFocusExitDelaySeconds,
      3,
      600,
      defaultState.settings.mediaFocusExitDelaySeconds,
    ),
    lightSensorEnabled:
      typeof input.lightSensorEnabled === "boolean"
        ? input.lightSensorEnabled
        : defaultState.settings.lightSensorEnabled,

    lightOffLuxThreshold:
      typeof input.lightOffLuxThreshold === "number"
        ? input.lightOffLuxThreshold
        : defaultState.settings.lightOffLuxThreshold,

    lightOnLuxThreshold:
      typeof input.lightOnLuxThreshold === "number"
        ? input.lightOnLuxThreshold
        : defaultState.settings.lightOnLuxThreshold,
  };
}

function ensureUniqueLayoutPositions(layoutItems) {
  const usedPositions = new Set();

  return layoutItems.map((item) => {
    if (item.id === "clock") {
      return item;
    }

    if (!usedPositions.has(item.position)) {
      usedPositions.add(item.position);
      return item;
    }

    const firstUnused =
      WIDGET_EDGE_POSITIONS.find((position) => !usedPositions.has(position)) ??
      item.position;

    usedPositions.add(firstUnused);

    return {
      ...item,
      position: firstUnused,
    };
  });
}

function normalizeLayout(layoutInput = []) {
  const normalizedById = new Map();

  if (Array.isArray(layoutInput)) {
    for (const candidate of layoutInput) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const { id, enabled, position } = candidate;

      if (!isWidgetId(id)) {
        continue;
      }

      normalizedById.set(id, {
        id,
        enabled: typeof enabled === "boolean" ? enabled : true,
        position: isWidgetEdgePosition(position)
          ? position
          : getDefaultWidgetPosition(id),
      });
    }
  }

  const normalizedLayout = WIDGET_IDS.map((widgetId) => {
    const fallbackItem = defaultState.layout.find(
      (item) => item.id === widgetId,
    );

    if (!fallbackItem) {
      return {
        id: widgetId,
        enabled: true,
        position: getDefaultWidgetPosition(widgetId),
      };
    }

    return normalizedById.get(widgetId) ?? fallbackItem;
  });

  return ensureUniqueLayoutPositions(normalizedLayout);
}

function normalizeFocusSource(value) {
  return typeof value === "string" && FOCUS_SOURCES.includes(value)
    ? value
    : null;
}

function normalizeDisplay(displayInput = {}) {
  const nextDisplay = {
    ...defaultState.display,

    mode:
      displayInput.mode === "on" ||
      displayInput.mode === "dimmed" ||
      displayInput.mode === "sleep"
        ? displayInput.mode
        : defaultState.display.mode,

    reason:
      typeof displayInput.reason === "string" && displayInput.reason.length > 0
        ? displayInput.reason
        : defaultState.display.reason,

    keepAwakeReason:
      typeof displayInput.keepAwakeReason === "string"
        ? displayInput.keepAwakeReason
        : null,

    updatedAt: Number.isFinite(Number(displayInput.updatedAt))
      ? Number(displayInput.updatedAt)
      : Date.now(),

    focusedWidgetId: isWidgetId(displayInput.focusedWidgetId)
      ? displayInput.focusedWidgetId
      : null,

    focusSource: normalizeFocusSource(displayInput.focusSource),

    focusSetAt: Number.isFinite(Number(displayInput.focusSetAt))
      ? Number(displayInput.focusSetAt)
      : null,

    focusUntil: Number.isFinite(Number(displayInput.focusUntil))
      ? Number(displayInput.focusUntil)
      : null,

    mediaIdleSince: Number.isFinite(Number(displayInput.mediaIdleSince))
      ? Number(displayInput.mediaIdleSince)
      : null,

    mediaAutoFocusSuppressed:
      typeof displayInput.mediaAutoFocusSuppressed === "boolean"
        ? displayInput.mediaAutoFocusSuppressed
        : defaultState.display.mediaAutoFocusSuppressed,

    mediaAutoFocusSuppressedAt: Number.isFinite(
      Number(displayInput.mediaAutoFocusSuppressedAt),
    )
      ? Number(displayInput.mediaAutoFocusSuppressedAt)
      : null,

    mediaAutoFocusSuppressionSawActive:
      typeof displayInput.mediaAutoFocusSuppressionSawActive === "boolean"
        ? displayInput.mediaAutoFocusSuppressionSawActive
        : defaultState.display.mediaAutoFocusSuppressionSawActive,

    mediaLyricsVisible:
      typeof displayInput.mediaLyricsVisible === "boolean"
        ? displayInput.mediaLyricsVisible
        : defaultState.display.mediaLyricsVisible,

    mediaJellyfinTriviaVisible:
      typeof displayInput.mediaJellyfinTriviaVisible === "boolean"
        ? displayInput.mediaJellyfinTriviaVisible
        : defaultState.display.mediaJellyfinTriviaVisible,

    mediaJellyfinTriviaSessionKey:
      typeof displayInput.mediaJellyfinTriviaSessionKey === "string" &&
      displayInput.mediaJellyfinTriviaSessionKey.length > 0
        ? displayInput.mediaJellyfinTriviaSessionKey
        : null,

    spotifyContextKeepAwake:
      typeof displayInput.spotifyContextKeepAwake === "boolean"
        ? displayInput.spotifyContextKeepAwake
        : defaultState.display.spotifyContextKeepAwake,

    spotifyContextKeepAwakeSetAt: Number.isFinite(
      Number(displayInput.spotifyContextKeepAwakeSetAt),
    )
      ? Number(displayInput.spotifyContextKeepAwakeSetAt)
      : null,
  };

  if (!nextDisplay.focusedWidgetId) {
    nextDisplay.focusSource = null;
    nextDisplay.focusSetAt = null;
    nextDisplay.focusUntil = null;
    nextDisplay.mediaIdleSince = null;
    nextDisplay.mediaLyricsVisible = false;
    nextDisplay.mediaJellyfinTriviaVisible = false;
    nextDisplay.mediaJellyfinTriviaSessionKey = null;
  }

  if (nextDisplay.focusedWidgetId !== "media") {
    nextDisplay.mediaLyricsVisible = false;
    nextDisplay.mediaJellyfinTriviaVisible = false;
    nextDisplay.mediaJellyfinTriviaSessionKey = null;
  }

  if (nextDisplay.focusSource === "media-auto") {
    nextDisplay.focusedWidgetId = "media";
    nextDisplay.mediaAutoFocusSuppressed = false;
    nextDisplay.mediaAutoFocusSuppressedAt = null;
    nextDisplay.mediaAutoFocusSuppressionSawActive = false;
  }

  return nextDisplay;
}

function normalizeMediaSource(value) {
  return typeof value === "string" && MEDIA_SOURCES.includes(value)
    ? value
    : null;
}

function normalizeMediaStatus(value) {
  return typeof value === "string" && MEDIA_STATUSES.includes(value)
    ? value
    : defaultState.media.status;
}

function normalizeMediaKind(value) {
  return typeof value === "string" && MEDIA_KINDS.includes(value)
    ? value
    : defaultState.media.kind;
}

function normalizeOptionalTimestamp(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeOptionalNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeProviderRuntimeStatus(input = {}, fallback = {}) {
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : Boolean(fallback.enabled),
    status:
      input.status === "ok" ||
      input.status === "error" ||
      input.status === "idle"
        ? input.status
        : (fallback.status ?? "idle"),
    message: typeof input.message === "string" ? input.message : null,
    lastCheckedAt: normalizeOptionalTimestamp(input.lastCheckedAt),
  };
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeMediaProviderIds(input = {}) {
  const providerIds = input && typeof input === "object" ? input : {};

  return {
    imdb: normalizeOptionalString(providerIds.imdb ?? providerIds.Imdb),
    tmdb: normalizeOptionalString(providerIds.tmdb ?? providerIds.Tmdb),
    tvdb: normalizeOptionalString(providerIds.tvdb ?? providerIds.Tvdb),
  };
}

function normalizeMediaSnapshot(snapshotInput = null) {
  if (!snapshotInput || typeof snapshotInput !== "object") {
    return null;
  }

  return {
    source: normalizeMediaSource(snapshotInput.source),
    kind: normalizeMediaKind(snapshotInput.kind),
    title:
      typeof snapshotInput.title === "string" && snapshotInput.title.length > 0
        ? snapshotInput.title
        : defaultState.media.title,
    subtitle:
      typeof snapshotInput.subtitle === "string"
        ? snapshotInput.subtitle
        : defaultState.media.subtitle,
    secondaryText:
      typeof snapshotInput.secondaryText === "string"
        ? snapshotInput.secondaryText
        : defaultState.media.secondaryText,
    sourceItemId: normalizeOptionalString(snapshotInput.sourceItemId),
    playSessionId: normalizeOptionalString(snapshotInput.playSessionId),
    seriesTitle: normalizeOptionalString(snapshotInput.seriesTitle),
    seasonNumber: normalizeOptionalNumber(snapshotInput.seasonNumber),
    episodeNumber: normalizeOptionalNumber(snapshotInput.episodeNumber),
    providerIds: normalizeMediaProviderIds(snapshotInput.providerIds),
    productionYear: Number.isFinite(Number(snapshotInput.productionYear))
      ? Number(snapshotInput.productionYear)
      : null,
    genres: Array.isArray(snapshotInput.genres)
      ? snapshotInput.genres.filter((genre) => typeof genre === "string")
      : [],
    communityRating: normalizeOptionalNumber(snapshotInput.communityRating),
    artworkUrl:
      typeof snapshotInput.artworkUrl === "string" &&
      snapshotInput.artworkUrl.length > 0
        ? snapshotInput.artworkUrl
        : null,
    durationMs: normalizeOptionalNumber(snapshotInput.durationMs),
    deviceName:
      typeof snapshotInput.deviceName === "string" &&
      snapshotInput.deviceName.length > 0
        ? snapshotInput.deviceName
        : null,
    userName:
      typeof snapshotInput.userName === "string" &&
      snapshotInput.userName.length > 0
        ? snapshotInput.userName
        : null,
    isLiked:
      typeof snapshotInput.isLiked === "boolean" ? snapshotInput.isLiked : null,
    capturedAt:
      normalizeOptionalTimestamp(snapshotInput.capturedAt) ?? Date.now(),
  };
}

function normalizeMediaState(mediaInput = {}) {
  const jellyfinInput =
    mediaInput.sourceState && typeof mediaInput.sourceState === "object"
      ? mediaInput.sourceState.jellyfin
      : undefined;

  const spotifyInput =
    mediaInput.sourceState && typeof mediaInput.sourceState === "object"
      ? mediaInput.sourceState.spotify
      : undefined;

  return {
    ...defaultState.media,
    status: normalizeMediaStatus(mediaInput.status),
    source: normalizeMediaSource(mediaInput.source),
    kind: normalizeMediaKind(mediaInput.kind),
    title:
      typeof mediaInput.title === "string" && mediaInput.title.length > 0
        ? mediaInput.title
        : defaultState.media.title,
    subtitle:
      typeof mediaInput.subtitle === "string"
        ? mediaInput.subtitle
        : defaultState.media.subtitle,
    secondaryText:
      typeof mediaInput.secondaryText === "string"
        ? mediaInput.secondaryText
        : defaultState.media.secondaryText,
    sourceItemId: normalizeOptionalString(mediaInput.sourceItemId),
    playSessionId: normalizeOptionalString(mediaInput.playSessionId),
    seriesTitle: normalizeOptionalString(mediaInput.seriesTitle),
    seasonNumber: normalizeOptionalNumber(mediaInput.seasonNumber),
    episodeNumber: normalizeOptionalNumber(mediaInput.episodeNumber),
    providerIds: normalizeMediaProviderIds(mediaInput.providerIds),
    productionYear: Number.isFinite(Number(mediaInput.productionYear))
      ? Number(mediaInput.productionYear)
      : null,
    genres: Array.isArray(mediaInput.genres)
      ? mediaInput.genres.filter((genre) => typeof genre === "string")
      : [],
    communityRating: normalizeOptionalNumber(mediaInput.communityRating),
    artworkUrl:
      typeof mediaInput.artworkUrl === "string" &&
      mediaInput.artworkUrl.length > 0
        ? mediaInput.artworkUrl
        : null,
    progressMs: normalizeOptionalNumber(mediaInput.progressMs),
    durationMs: normalizeOptionalNumber(mediaInput.durationMs),
    deviceName:
      typeof mediaInput.deviceName === "string" &&
      mediaInput.deviceName.length > 0
        ? mediaInput.deviceName
        : null,
    userName:
      typeof mediaInput.userName === "string" && mediaInput.userName.length > 0
        ? mediaInput.userName
        : null,
    isLiked:
      typeof mediaInput.isLiked === "boolean" ? mediaInput.isLiked : null,
    lastUpdatedAt: normalizeOptionalTimestamp(mediaInput.lastUpdatedAt),
    statusChangedAt: normalizeOptionalTimestamp(mediaInput.statusChangedAt),
    lastPlayed: normalizeMediaSnapshot(mediaInput.lastPlayed),
    sourceState: {
      jellyfin: normalizeProviderRuntimeStatus(
        jellyfinInput,
        defaultState.media.sourceState.jellyfin,
      ),
      spotify: normalizeProviderRuntimeStatus(
        spotifyInput,
        defaultState.media.sourceState.spotify,
      ),
    },
  };
}

function normalizeLoadedState(parsedState = {}) {
  const baseState = structuredClone(defaultState);

  return {
    ...baseState,
    ...parsedState,
    layout: normalizeLayout(parsedState.layout ?? []),
    settings: normalizeSettings(parsedState.settings ?? {}),
    presence: {
      ...baseState.presence,
      ...parsedState.presence,
    },
    light: {
      ...baseState.light,
      ...parsedState.light,
    },
    display: normalizeDisplay(parsedState.display ?? {}),
    deployment: {
      ...baseState.deployment,
      ...parsedState.deployment,
    },
    media: normalizeMediaState(parsedState.media ?? {}),
  };
}

function loadState() {
  const sourceFile = fs.existsSync(STATE_FILE)
    ? STATE_FILE
    : fs.existsSync(LEGACY_STATE_FILE)
      ? LEGACY_STATE_FILE
      : null;

  try {
    if (!sourceFile) {
      return structuredClone(defaultState);
    }

    const raw = fs.readFileSync(sourceFile, "utf-8");
    const parsedState = JSON.parse(raw);
    const normalizedState = normalizeLoadedState(parsedState);

    if (sourceFile === LEGACY_STATE_FILE && !fs.existsSync(STATE_FILE)) {
      saveState(normalizedState);
      console.log(
        `[state] migrated legacy state from ${LEGACY_STATE_FILE} to ${STATE_FILE}`,
      );
    }

    return normalizedState;
  } catch (error) {
    console.error("failed to load state, using default", error);
    return structuredClone(defaultState);
  }
}

function saveState(nextState) {
  try {
    const { logs, ...persistableState } = nextState;
    const stateDirectory = path.dirname(STATE_FILE);
    const temporaryStateFile = `${STATE_FILE}.${process.pid}.tmp`;

    fs.mkdirSync(stateDirectory, { recursive: true });

    fs.writeFileSync(
      temporaryStateFile,
      JSON.stringify(persistableState, null, 2),
      "utf-8",
    );

    fs.renameSync(temporaryStateFile, STATE_FILE);
  } catch (error) {
    console.error("failed to save state", error);
  }
}

const state = loadState();
console.log("[boot] state loaded");

const lightSensorStartup = startLightSensor();

state.light = {
  ...state.light,
  enabled: true,
  status: lightSensorStartup.ok ? "ok" : "error",
  error: lightSensorStartup.ok ? null : lightSensorStartup.error,
  updatedAt: Date.now(),
};

function getLightMode(lux, settings) {
  if (lux >= settings.lightOnLuxThreshold) {
    return "bright";
  }

  if (lux > settings.lightOffLuxThreshold) {
    return "context";
  }

  return "dark";
}

function pollLightSensor() {
  if (!state.settings.lightSensorEnabled) {
    state.light = {
      ...state.light,
      enabled: false,
      status: "disabled",
      updatedAt: Date.now(),
      error: null,
    };

    saveState(state);
    broadcastState();
    return;
  }

  try {
    const reading = readLightSensor();
    const mode = getLightMode(reading.lux, state.settings);

    state.light = {
      ...state.light,
      enabled: true,
      status: "ok",
      mode,
      raw: reading.raw,
      lux: reading.lux,
      roomLightOn: mode === "bright",
      updatedAt: reading.updatedAt,
      error: null,
    };

    syncPresenceFromEnvironment();
    updateDisplayState(`light:${mode}`);
    persistAndBroadcast();
  } catch (error) {
    state.light = {
      ...state.light,
      enabled: true,
      status: "error",
      error: error.message,
      updatedAt: Date.now(),
    };

    saveState(state);
    broadcastState();
  }
}

setInterval(pollLightSensor, 5000);

state.logs = [];

const MAX_LOG_ENTRIES = 100;

let nextWsClientId = 1;

function getClientAddress(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress ?? "unknown";
}

function getClientUserAgent(req) {
  const userAgent = req.headers["user-agent"];

  return typeof userAgent === "string" && userAgent.length > 0
    ? userAgent
    : "unknown";
}

function appendLog(level, source, message, meta = null) {
  state.logs = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      level,
      source,
      message,
      meta,
    },
    ...(state.logs ?? []),
  ].slice(0, MAX_LOG_ENTRIES);
}

function hasMediaChanged(currentMedia, nextMedia) {
  return JSON.stringify(currentMedia) !== JSON.stringify(nextMedia);
}

function getFocusIdleTimeoutMs() {
  return state.settings.focusIdleTimeoutSeconds * 1000;
}

function getMediaFocusExitDelayMs() {
  return state.settings.mediaFocusExitDelaySeconds * 1000;
}

function createLastPlayedSnapshot(mediaState) {
  return {
    source: mediaState.source,
    kind: mediaState.kind,
    title: mediaState.title,
    subtitle: mediaState.subtitle,
    secondaryText: mediaState.secondaryText,
    sourceItemId: mediaState.sourceItemId,
    playSessionId: mediaState.playSessionId,
    seriesTitle: mediaState.seriesTitle,
    seasonNumber: mediaState.seasonNumber,
    episodeNumber: mediaState.episodeNumber,
    providerIds: {
      ...(mediaState.providerIds ?? defaultState.media.providerIds),
    },
    productionYear: mediaState.productionYear,
    genres: [...(mediaState.genres ?? [])],
    communityRating: mediaState.communityRating,
    artworkUrl: mediaState.artworkUrl,
    durationMs: mediaState.durationMs,
    deviceName: mediaState.deviceName,
    userName: mediaState.userName,
    isLiked: mediaState.isLiked,
    capturedAt: Date.now(),
  };
}

function shouldRefreshLastPlayedSnapshot(previousSnapshot, nextMedia) {
  if (!previousSnapshot) {
    return true;
  }

  return (
    previousSnapshot.source !== nextMedia.source ||
    previousSnapshot.kind !== nextMedia.kind ||
    previousSnapshot.title !== nextMedia.title ||
    previousSnapshot.subtitle !== nextMedia.subtitle ||
    previousSnapshot.secondaryText !== nextMedia.secondaryText ||
    previousSnapshot.sourceItemId !== nextMedia.sourceItemId ||
    previousSnapshot.playSessionId !== nextMedia.playSessionId ||
    previousSnapshot.seriesTitle !== nextMedia.seriesTitle ||
    previousSnapshot.seasonNumber !== nextMedia.seasonNumber ||
    previousSnapshot.episodeNumber !== nextMedia.episodeNumber ||
    JSON.stringify(previousSnapshot.providerIds) !==
      JSON.stringify(nextMedia.providerIds) ||
    previousSnapshot.artworkUrl !== nextMedia.artworkUrl ||
    previousSnapshot.durationMs !== nextMedia.durationMs ||
    previousSnapshot.isLiked !== nextMedia.isLiked
  );
}

function isMediaPlayableSource(mediaState) {
  return mediaState.source === "jellyfin" || mediaState.source === "spotify";
}

function isJellyfinTriviaEligible(mediaState) {
  return (
    mediaState.source === "jellyfin" &&
    (mediaState.kind === "movie" || mediaState.kind === "episode") &&
    (mediaState.status === "playing" || mediaState.status === "paused")
  );
}

function getJellyfinTriviaSessionKey(mediaState) {
  if (!isJellyfinTriviaEligible(mediaState)) {
    return null;
  }

  if (mediaState.playSessionId) {
    return `play-session:${mediaState.playSessionId}`;
  }

  return [
    "fallback",
    mediaState.sourceItemId ?? "",
    mediaState.title ?? "",
    mediaState.subtitle ?? "",
    mediaState.artworkUrl ?? "",
    mediaState.durationMs ?? "",
    mediaState.seasonNumber ?? "",
    mediaState.episodeNumber ?? "",
  ].join("\n");
}

function shouldShowMediaLyricsByDefault() {
  return (
    state.settings.mediaLyricsDefaultVisible === true &&
    state.media.kind === "track" &&
    (state.media.status === "playing" || state.media.status === "paused")
  );
}

function getDefaultJellyfinTriviaSessionKey() {
  const sessionKey = getJellyfinTriviaSessionKey(state.media);

  if (
    state.settings.mediaJellyfinTriviaDefaultVisible !== true ||
    sessionKey === null
  ) {
    return null;
  }

  return sessionKey;
}

function applyMediaVisibilityDefaults(reason = "media:defaults") {
  if (state.display.focusedWidgetId !== "media") {
    return false;
  }

  const nextTriviaSessionKey = getDefaultJellyfinTriviaSessionKey();
  const shouldShowTrivia = nextTriviaSessionKey !== null;
  const shouldShowLyrics = shouldShowMediaLyricsByDefault();

  const nextDisplay = {
    ...state.display,
  };

  let changed = false;

  if (!nextDisplay.mediaLyricsVisible && shouldShowLyrics) {
    nextDisplay.mediaLyricsVisible = true;
    changed = true;
  }

  if (!nextDisplay.mediaJellyfinTriviaVisible && shouldShowTrivia) {
    nextDisplay.mediaJellyfinTriviaVisible = true;
    nextDisplay.mediaJellyfinTriviaSessionKey = nextTriviaSessionKey;
    changed = true;
  }

  if (!changed) {
    return false;
  }

  state.display = {
    ...nextDisplay,
    reason,
    updatedAt: Date.now(),
  };

  appendLog(
    "info",
    "focus",
    "Media defaults toegepast",
    JSON.stringify({
      lyrics: state.display.mediaLyricsVisible,
      jellyfinTrivia: state.display.mediaJellyfinTriviaVisible,
    }),
  );

  return true;
}

function setFocusedWidget(
  widgetId,
  focusSource = "manual",
  reason = "focus:set",
) {
  if (!isWidgetId(widgetId)) {
    return false;
  }

  const now = Date.now();
  const normalizedSource =
    focusSource === "media-auto" ? "media-auto" : "manual";
  const normalizedWidgetId =
    normalizedSource === "media-auto" ? "media" : widgetId;
  const nextFocusUntil =
    normalizedSource === "media-auto" ? null : now + getFocusIdleTimeoutMs();

  const isMediaFocus = normalizedWidgetId === "media";
  const nextTriviaSessionKey = isMediaFocus
    ? getDefaultJellyfinTriviaSessionKey()
    : null;
  const currentTriviaSessionStillValid =
    isMediaFocus &&
    state.display.mediaJellyfinTriviaVisible &&
    state.display.mediaJellyfinTriviaSessionKey !== null &&
    state.display.mediaJellyfinTriviaSessionKey ===
      getJellyfinTriviaSessionKey(state.media);

  const changed =
    state.display.focusedWidgetId !== normalizedWidgetId ||
    state.display.focusSource !== normalizedSource;

  state.display = {
    ...state.display,
    focusedWidgetId: normalizedWidgetId,
    focusSource: normalizedSource,
    focusSetAt: now,
    focusUntil: nextFocusUntil,
    mediaIdleSince: null,
    mediaAutoFocusSuppressed: false,
    mediaAutoFocusSuppressedAt: null,
    mediaAutoFocusSuppressionSawActive: false,
    mediaLyricsVisible:
      isMediaFocus &&
      (state.display.mediaLyricsVisible || shouldShowMediaLyricsByDefault()),
    mediaJellyfinTriviaVisible:
      isMediaFocus &&
      (currentTriviaSessionStillValid || nextTriviaSessionKey !== null),
    mediaJellyfinTriviaSessionKey:
      isMediaFocus && (currentTriviaSessionStillValid || nextTriviaSessionKey)
        ? currentTriviaSessionStillValid
          ? state.display.mediaJellyfinTriviaSessionKey
          : nextTriviaSessionKey
        : null,
    reason,
    updatedAt: now,
  };

  if (changed) {
    appendLog(
      "info",
      "focus",
      "Focus widget gewijzigd",
      `${normalizedSource}:${normalizedWidgetId}`,
    );
  }

  return true;
}

function clearFocusedWidget(reason = "focus:clear", options = {}) {
  if (!state.display.focusedWidgetId && !state.display.focusSource) {
    return false;
  }

  const previousWidgetId = state.display.focusedWidgetId;
  const now = Date.now();
  const mediaIsCurrentlyActive =
    (state.media.status === "playing" || state.media.status === "paused") &&
    isMediaPlayableSource(state.media);
  const shouldSuppressMediaAutoFocus =
    options.suppressMediaAutoFocus === true && previousWidgetId === "media";

  state.display = {
    ...state.display,
    focusedWidgetId: null,
    focusSource: null,
    focusSetAt: null,
    focusUntil: null,
    mediaIdleSince: null,
    mediaAutoFocusSuppressed: shouldSuppressMediaAutoFocus,
    mediaAutoFocusSuppressedAt: shouldSuppressMediaAutoFocus ? now : null,
    mediaAutoFocusSuppressionSawActive:
      shouldSuppressMediaAutoFocus &&
      (mediaIsCurrentlyActive || state.display.focusSource === "media-auto"),
    mediaLyricsVisible: false,
    mediaJellyfinTriviaVisible: false,
    mediaJellyfinTriviaSessionKey: null,
    reason,
    updatedAt: now,
  };

  appendLog(
    "info",
    "focus",
    "Focus widget gewist",
    `${previousWidgetId ?? "none"} · reason=${reason}`,
  );

  return true;
}

function setMediaLyricsVisible(visible, reason = "lyrics:toggle") {
  const nextVisible =
    visible === true &&
    state.display.focusedWidgetId === "media" &&
    state.media.kind === "track" &&
    (state.media.status === "playing" || state.media.status === "paused");

  const changed = state.display.mediaLyricsVisible !== nextVisible;

  state.display = {
    ...state.display,
    mediaLyricsVisible: nextVisible,
    reason,
    updatedAt: Date.now(),
  };

  if (changed) {
    appendLog(
      "info",
      "focus",
      "Media lyrics zichtbaarheid gewijzigd",
      nextVisible ? "aan" : "uit",
    );
  }

  return true;
}

function setMediaJellyfinTriviaVisible(
  visible,
  reason = "jellyfin-trivia:toggle",
) {
  const nextSessionKey = getJellyfinTriviaSessionKey(state.media);
  const nextVisible =
    visible === true &&
    state.display.focusedWidgetId === "media" &&
    nextSessionKey !== null;

  const changed =
    state.display.mediaJellyfinTriviaVisible !== nextVisible ||
    state.display.mediaJellyfinTriviaSessionKey !==
      (nextVisible ? nextSessionKey : null);

  state.display = {
    ...state.display,
    mediaJellyfinTriviaVisible: nextVisible,
    mediaJellyfinTriviaSessionKey: nextVisible ? nextSessionKey : null,
    reason,
    updatedAt: Date.now(),
  };

  if (changed) {
    appendLog(
      "info",
      "focus",
      "Jellyfin trivia zichtbaarheid gewijzigd",
      nextVisible ? "aan" : "uit",
    );
  }

  return true;
}

function syncMediaJellyfinTriviaSession() {
  if (!state.display.mediaJellyfinTriviaVisible) {
    return false;
  }

  const nextSessionKey = getJellyfinTriviaSessionKey(state.media);

  if (
    state.display.focusedWidgetId === "media" &&
    nextSessionKey !== null &&
    state.display.mediaJellyfinTriviaSessionKey === nextSessionKey
  ) {
    return false;
  }

  state.display = {
    ...state.display,
    mediaJellyfinTriviaVisible: false,
    mediaJellyfinTriviaSessionKey: null,
    reason: "jellyfin-trivia:session-ended",
    updatedAt: Date.now(),
  };

  appendLog(
    "info",
    "focus",
    "Jellyfin trivia automatisch uitgezet",
    "Jellyfin sessie is beÃ«indigd of media is gewijzigd",
  );

  return true;
}

function setSpotifyContextKeepAwake(
  enabled,
  reason = "spotify-context:toggle",
) {
  const nextEnabled =
    enabled === true && isSpotifyListeningSession(state.media);

  const changed = state.display.spotifyContextKeepAwake !== nextEnabled;

  state.display = {
    ...state.display,
    spotifyContextKeepAwake: nextEnabled,
    spotifyContextKeepAwakeSetAt: nextEnabled ? Date.now() : null,
    reason,
    updatedAt: Date.now(),
  };

  if (changed) {
    appendLog(
      "info",
      "display",
      "Spotify context keep-awake gewijzigd",
      nextEnabled ? "aan voor huidige sessie" : "uit",
    );
  }

  syncPresenceFromEnvironment();
  updateDisplayState(reason);

  return changed;
}

function syncSpotifyContextKeepAwakeSession() {
  if (!state.display.spotifyContextKeepAwake) {
    return false;
  }

  if (isSpotifyContextSessionAlive()) {
    return false;
  }

  state.display = {
    ...state.display,
    spotifyContextKeepAwake: false,
    spotifyContextKeepAwakeSetAt: null,
    reason: "spotify-context:session-ended",
    updatedAt: Date.now(),
  };

  appendLog(
    "info",
    "display",
    "Spotify context keep-awake automatisch uitgezet",
    "Spotify sessie is beëindigd of provider is niet meer actief",
  );

  return true;
}

function reconcileFocusState(trigger = "focus:tick") {
  const now = Date.now();
  const focusedWidgetId = state.display.focusedWidgetId;
  const mediaIsPlaying =
    state.media.status === "playing" && isMediaPlayableSource(state.media);
  const mediaIsActive =
    (state.media.status === "playing" || state.media.status === "paused") &&
    isMediaPlayableSource(state.media);

  if (state.display.mediaAutoFocusSuppressed && mediaIsActive) {
    if (!state.display.mediaAutoFocusSuppressionSawActive) {
      state.display = {
        ...state.display,
        mediaAutoFocusSuppressionSawActive: true,
        reason: "focus:media-auto-suppression-active",
        updatedAt: now,
      };

      return true;
    }

    return false;
  }

  if (
    state.display.mediaAutoFocusSuppressed &&
    state.display.mediaAutoFocusSuppressionSawActive &&
    !mediaIsActive
  ) {
    state.display = {
      ...state.display,
      mediaAutoFocusSuppressed: false,
      mediaAutoFocusSuppressedAt: null,
      mediaAutoFocusSuppressionSawActive: false,
      reason: "focus:media-auto-suppression-cleared",
      updatedAt: now,
    };

    return true;
  }

  if (
    state.display.mediaAutoFocusSuppressed &&
    !state.display.mediaAutoFocusSuppressionSawActive &&
    state.display.mediaAutoFocusSuppressedAt !== null &&
    now - state.display.mediaAutoFocusSuppressedAt >= getFocusIdleTimeoutMs()
  ) {
    state.display = {
      ...state.display,
      mediaAutoFocusSuppressed: false,
      mediaAutoFocusSuppressedAt: null,
      mediaAutoFocusSuppressionSawActive: false,
      reason: "focus:media-auto-suppression-expired",
      updatedAt: now,
    };

    return true;
  }

  if (!focusedWidgetId) {
    if (mediaIsPlaying && !state.display.mediaAutoFocusSuppressed) {
      const didChange = setFocusedWidget(
        "media",
        "media-auto",
        "focus:auto-media",
      );

      if (didChange) {
        appendLog("info", "focus", "Media auto-focus actief", trigger);
      }

      return didChange;
    }

    return false;
  }

  if (state.display.focusSource === "manual") {
    if (state.display.focusUntil !== null && now >= state.display.focusUntil) {
      return clearFocusedWidget("focus:manual-timeout");
    }

    return false;
  }

  if (state.display.focusSource === "media-auto") {
    if (state.media.status === "playing") {
      if (
        state.display.mediaIdleSince !== null ||
        state.display.focusUntil !== null
      ) {
        state.display = {
          ...state.display,
          mediaIdleSince: null,
          focusUntil: null,
          reason: "focus:media-resumed",
          updatedAt: now,
        };

        return true;
      }

      return false;
    }

    if (state.display.mediaIdleSince === null) {
      const nextFocusUntil = now + getMediaFocusExitDelayMs();

      state.display = {
        ...state.display,
        mediaIdleSince: now,
        focusUntil: nextFocusUntil,
        reason:
          state.media.status === "paused"
            ? "focus:media-paused"
            : "focus:media-idle",
        updatedAt: now,
      };

      return true;
    }

    const elapsedMs = now - state.display.mediaIdleSince;

    if (
      elapsedMs >= getMediaFocusExitDelayMs() ||
      (state.display.focusUntil !== null && now >= state.display.focusUntil)
    ) {
      return clearFocusedWidget("focus:media-timeout");
    }

    return false;
  }

  if (state.display.focusUntil !== null && now >= state.display.focusUntil) {
    return clearFocusedWidget("focus:timeout");
  }

  return false;
}

function getMediaDisplayReason(media) {
  const source = media.source ?? "none";
  const kind = media.kind ?? "unknown";
  const status = media.status ?? "unknown";

  return `media:${source}:${kind}:${status}`;
}

function updateRuntimeMedia(nextMedia) {
  const normalizedMedia = normalizeMediaState(nextMedia);
  const previousLastPlayed = state.media.lastPlayed;
  const statusContextChanged =
    state.media.status !== normalizedMedia.status ||
    state.media.source !== normalizedMedia.source ||
    state.media.kind !== normalizedMedia.kind ||
    state.media.title !== normalizedMedia.title ||
    state.media.subtitle !== normalizedMedia.subtitle ||
    state.media.artworkUrl !== normalizedMedia.artworkUrl;

  normalizedMedia.statusChangedAt = statusContextChanged
    ? (normalizedMedia.lastUpdatedAt ?? Date.now())
    : (state.media.statusChangedAt ??
      state.media.lastUpdatedAt ??
      normalizedMedia.lastUpdatedAt ??
      Date.now());

  if (
    normalizedMedia.status === "playing" ||
    normalizedMedia.status === "paused"
  ) {
    normalizedMedia.lastPlayed = shouldRefreshLastPlayedSnapshot(
      previousLastPlayed,
      normalizedMedia,
    )
      ? createLastPlayedSnapshot(normalizedMedia)
      : previousLastPlayed;
  } else {
    normalizedMedia.lastPlayed = previousLastPlayed;
  }

  const mediaChanged = hasMediaChanged(state.media, normalizedMedia);
  const lastPlayedChanged =
    JSON.stringify(previousLastPlayed) !==
    JSON.stringify(normalizedMedia.lastPlayed);

  if (mediaChanged) {
    state.media = normalizedMedia;
  }

  const mediaReason = getMediaDisplayReason(state.media);

  const jellyfinTriviaChanged = syncMediaJellyfinTriviaSession();
  const mediaDefaultsChanged = applyMediaVisibilityDefaults(mediaReason);
  const focusChanged = reconcileFocusState(mediaReason);
  const spotifyContextChanged = syncSpotifyContextKeepAwakeSession();
  const presenceChanged = syncPresenceFromEnvironment();
  const displayChanged = updateDisplayState(mediaReason);

  if (
    !mediaChanged &&
    !jellyfinTriviaChanged &&
    !spotifyContextChanged &&
    !mediaDefaultsChanged &&
    !focusChanged &&
    !presenceChanged &&
    !displayChanged
  ) {
    return;
  }

  if (
    focusChanged ||
    lastPlayedChanged ||
    jellyfinTriviaChanged ||
    mediaDefaultsChanged ||
    spotifyContextChanged ||
    presenceChanged ||
    displayChanged
  ) {
    saveState(state);
  }

  broadcastState();
}

function buildResolvedMedia({
  jellyfinMedia,
  jellyfinStatus,
  spotifyMedia,
  spotifyStatus,
}) {
  const sourceState = {
    ...defaultState.media.sourceState,
    jellyfin: jellyfinStatus,
    spotify: spotifyStatus,
  };

  const resolvedMedia =
    jellyfinMedia?.status === "playing"
      ? jellyfinMedia
      : spotifyMedia?.status === "playing"
        ? spotifyMedia
        : (jellyfinMedia ?? spotifyMedia);

  if (resolvedMedia) {
    return {
      ...defaultState.media,
      ...resolvedMedia,
      sourceState,
    };
  }

  return {
    ...defaultState.media,
    sourceState,
  };
}

function buildProviderErrorStatus(message) {
  return {
    enabled: true,
    status: "error",
    message,
    lastCheckedAt: Date.now(),
  };
}

function createCurrentMediaFallback(source) {
  if (
    state.media.source !== source ||
    (state.media.status !== "playing" && state.media.status !== "paused")
  ) {
    return null;
  }

  const now = Date.now();
  let progressMs = state.media.progressMs;

  if (
    state.media.status === "playing" &&
    progressMs !== null &&
    state.media.lastUpdatedAt !== null
  ) {
    progressMs += Math.max(0, now - state.media.lastUpdatedAt);

    if (state.media.durationMs !== null) {
      progressMs = Math.min(progressMs, state.media.durationMs);
    }
  }

  return {
    status: state.media.status,
    source: state.media.source,
    kind: state.media.kind,
    title: state.media.title,
    subtitle: state.media.subtitle,
    secondaryText: state.media.secondaryText,
    productionYear: state.media.productionYear,
    genres: [...state.media.genres],
    communityRating: state.media.communityRating,
    artworkUrl: state.media.artworkUrl,
    progressMs,
    durationMs: state.media.durationMs,
    deviceName: state.media.deviceName,
    userName: state.media.userName,
    isLiked: state.media.isLiked,
    lastUpdatedAt: now,
  };
}

function shouldKeepPreviousSpotifyMedia(providerStatus) {
  if (!providerStatus) {
    return false;
  }

  return (
    providerStatus.status === "error" ||
    (typeof providerStatus.message === "string" &&
      providerStatus.message.startsWith("Spotify rate-limited"))
  );
}

function normalizeLyricsQueryValue(value) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

function getLyricsCacheKey({
  trackName,
  artistName,
  albumName,
  durationSeconds,
}) {
  return JSON.stringify({
    trackName: trackName.toLowerCase(),
    artistName: artistName.toLowerCase(),
    albumName: albumName.toLowerCase(),
    durationSeconds,
  });
}

function pruneLyricsCache() {
  const now = Date.now();

  for (const [key, entry] of lyricsCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      lyricsCache.delete(key);
    }
  }
}

async function fetchLyricsFromLrclib({
  trackName,
  artistName,
  albumName,
  durationMs,
}) {
  const normalizedTrackName = normalizeLyricsQueryValue(trackName);
  const normalizedArtistName = normalizeLyricsQueryValue(artistName);
  const normalizedAlbumName = normalizeLyricsQueryValue(albumName);
  const parsedDurationMs = Number(durationMs);
  const durationSeconds =
    Number.isFinite(parsedDurationMs) && parsedDurationMs > 0
      ? Math.round(parsedDurationMs / 1000)
      : null;

  if (!normalizedTrackName || !normalizedArtistName) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "trackName en artistName zijn verplicht.",
      },
    };
  }

  pruneLyricsCache();

  const cacheKey = getLyricsCacheKey({
    trackName: normalizedTrackName,
    artistName: normalizedArtistName,
    albumName: normalizedAlbumName,
    durationSeconds,
  });

  const cachedEntry = lyricsCache.get(cacheKey);
  const cacheHit = Boolean(cachedEntry && cachedEntry.expiresAt > Date.now());

  console.log("[lyrics:cache]", {
    hit: cacheHit,
    trackName: normalizedTrackName,
    artistName: normalizedArtistName,
    albumName: normalizedAlbumName,
    durationSeconds,
    cacheKey,
  });

  if (cacheHit) {
    return {
      status: 200,
      body: cachedEntry.body,
    };
  }

  const pendingRequest = lyricsPendingRequests.get(cacheKey);

  if (pendingRequest) {
    console.log("[lyrics:pending-hit]", {
      trackName: normalizedTrackName,
      artistName: normalizedArtistName,
      albumName: normalizedAlbumName,
      durationSeconds,
      cacheKey,
    });

    return pendingRequest;
  }

  const requestPromise = (async () => {
    const url = new URL(LRCLIB_GET_URL);
    url.searchParams.set("track_name", normalizedTrackName);
    url.searchParams.set("artist_name", normalizedArtistName);

    if (normalizedAlbumName) {
      url.searchParams.set("album_name", normalizedAlbumName);
    }

    if (durationSeconds !== null) {
      url.searchParams.set("duration", String(durationSeconds));
    }

    console.log("[lyrics:pending-store]", {
      trackName: normalizedTrackName,
      artistName: normalizedArtistName,
      albumName: normalizedAlbumName,
      durationSeconds,
      cacheKey,
    });

    console.log("[lyrics:fetch]", {
      trackName: normalizedTrackName,
      artistName: normalizedArtistName,
      albumName: normalizedAlbumName,
      durationSeconds,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Smart-Mirror-OS/0.0.0 (lyrics lookup)",
        },
        signal: controller.signal,
      });

      if (response.status === 404) {
        const body = {
          ok: true,
          lyrics: null,
          message: "Geen lyrics gevonden.",
        };

        lyricsCache.set(cacheKey, {
          body,
          expiresAt: Date.now() + LYRICS_NOT_FOUND_CACHE_TTL_MS,
        });

        return { status: 200, body };
      }

      if (!response.ok) {
        return {
          status: response.status,
          body: {
            ok: false,
            error: `LRCLIB gaf status ${response.status}.`,
          },
        };
      }

      const payload = await response.json();
      const body = {
        ok: true,
        lyrics: {
          trackName:
            typeof payload.trackName === "string"
              ? payload.trackName
              : normalizedTrackName,
          artistName:
            typeof payload.artistName === "string"
              ? payload.artistName
              : normalizedArtistName,
          albumName:
            typeof payload.albumName === "string"
              ? payload.albumName
              : normalizedAlbumName,
          instrumental: payload.instrumental === true,
          plainLyrics:
            typeof payload.plainLyrics === "string"
              ? payload.plainLyrics
              : null,
          syncedLyrics:
            typeof payload.syncedLyrics === "string"
              ? payload.syncedLyrics
              : null,
        },
      };

      lyricsCache.set(cacheKey, {
        body,
        expiresAt: Date.now() + LYRICS_CACHE_TTL_MS,
      });

      return { status: 200, body };
    } catch (error) {
      console.log("[lyrics:error]", {
        trackName: normalizedTrackName,
        artistName: normalizedArtistName,
        albumName: normalizedAlbumName,
        durationSeconds,
        errorName: error?.name,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      return {
        status: error?.name === "AbortError" ? 504 : 500,
        body: {
          ok: false,
          error:
            error?.name === "AbortError"
              ? "Lyrics ophalen duurde langer dan 30 seconden."
              : "Lyrics ophalen mislukt.",
        },
      };
    } finally {
      clearTimeout(timeoutId);
      lyricsPendingRequests.delete(cacheKey);
    }
  })();

  lyricsPendingRequests.set(cacheKey, requestPromise);

  return requestPromise;
}

async function pollNowPlayingProviders() {
  let jellyfinResult;
  let spotifyResult;

  try {
    jellyfinResult = await fetchJellyfinNowPlaying();
  } catch (error) {
    console.error("failed to poll jellyfin now playing", error);

    jellyfinResult = {
      media: null,
      providerStatus: buildProviderErrorStatus("Jellyfin polling mislukt."),
    };
  }

  try {
    spotifyResult = await fetchSpotifyNowPlaying();
  } catch (error) {
    console.error("failed to poll spotify now playing", error);

    spotifyResult = {
      media: null,
      providerStatus: buildProviderErrorStatus("Spotify polling mislukt."),
    };
  }

  if (
    !spotifyResult.media &&
    shouldKeepPreviousSpotifyMedia(spotifyResult.providerStatus)
  ) {
    spotifyResult = {
      ...spotifyResult,
      media: createCurrentMediaFallback("spotify"),
    };
  }

  const nextMedia = buildResolvedMedia({
    jellyfinMedia: jellyfinResult.media,
    jellyfinStatus: jellyfinResult.providerStatus,
    spotifyMedia: spotifyResult.media,
    spotifyStatus: spotifyResult.providerStatus,
  });

  updateRuntimeMedia(nextMedia);
}

let nowPlayingPollInFlight = false;
let nowPlayingPollTimeout = null;

function getNowPlayingPollIntervalMs() {
  const mediaIsActive =
    (state.media.status === "playing" || state.media.status === "paused") &&
    isMediaPlayableSource(state.media);

  return mediaIsActive || state.display.focusedWidgetId === "media"
    ? NOW_PLAYING_ACTIVE_POLL_INTERVAL_MS
    : NOW_PLAYING_IDLE_POLL_INTERVAL_MS;
}

async function runNowPlayingPollTick(trigger = "interval") {
  if (nowPlayingPollInFlight) {
    console.log(
      "[poll] now playing poll skipped, previous tick still running",
      {
        trigger,
      },
    );
    return;
  }

  nowPlayingPollInFlight = true;

  try {
    await pollNowPlayingProviders();
  } catch (error) {
    console.error("[poll] now playing tick failed", {
      trigger,
      error,
    });
  } finally {
    nowPlayingPollInFlight = false;
  }
}

function scheduleNextNowPlayingPoll() {
  if (nowPlayingPollTimeout) {
    clearTimeout(nowPlayingPollTimeout);
  }

  nowPlayingPollTimeout = setTimeout(() => {
    void runNowPlayingPollTick("interval").finally(scheduleNextNowPlayingPoll);
  }, getNowPlayingPollIntervalMs());
}

async function checkForDeploymentUpdate() {
  state.deployment = {
    ...state.deployment,
    status: "checking",
    message: "Controleren op updates...",
  };

  appendLog("info", "deployment", "Update-check gestart");
  broadcastState();

  try {
    await execAsync("git fetch origin main --quiet", {
      cwd: __dirname + "/..",
    });

    const { stdout: currentCommitStdout } = await execAsync(
      "git rev-parse HEAD",
      {
        cwd: __dirname + "/..",
      },
    );

    const { stdout: currentCommitMessageStdout } = await execAsync(
      "git log -1 --pretty=%s HEAD",
      {
        cwd: __dirname + "/..",
      },
    );

    const { stdout: remoteCommitStdout } = await execAsync(
      "git rev-parse origin/main",
      {
        cwd: __dirname + "/..",
      },
    );

    const { stdout: remoteCommitMessageStdout } = await execAsync(
      "git log -1 --pretty=%s origin/main",
      {
        cwd: __dirname + "/..",
      },
    );

    const currentCommit = currentCommitStdout.trim();
    const currentCommitMessage = currentCommitMessageStdout.trim();
    const remoteCommit = remoteCommitStdout.trim() || null;
    const remoteCommitMessage = remoteCommitMessageStdout.trim() || null;
    const hasUpdate = Boolean(remoteCommit) && currentCommit !== remoteCommit;

    state.deployment = {
      ...state.deployment,
      status: hasUpdate ? "update-available" : "up-to-date",
      currentCommit,
      currentCommitMessage,
      remoteCommit,
      remoteCommitMessage,
      hasUpdate,
      lastCheckedAt: Date.now(),
      message: hasUpdate
        ? "Nieuwe update beschikbaar."
        : "Je zit al op de nieuwste versie.",
    };

    appendLog(
      "info",
      "deployment",
      hasUpdate ? "Nieuwe update gevonden" : "Geen update gevonden",
      `local=${currentCommit.slice(0, 7)} · remote=${remoteCommit?.slice(0, 7) ?? "unknown"}`,
    );

    persistAndBroadcast();
  } catch (error) {
    state.deployment = {
      ...state.deployment,
      status: "error",
      lastCheckedAt: Date.now(),
      message: "Controleren op updates mislukt.",
    };

    appendLog(
      "error",
      "deployment",
      "Update-check mislukt",
      error instanceof Error ? error.message : String(error),
    );

    console.error("failed to check deployment update", error);
    persistAndBroadcast();
  }
}

async function deployLatestVersion() {
  if (state.deployment.status === "deploying") {
    return;
  }

  state.deployment = {
    ...state.deployment,
    status: "deploying",
    message: "Update wordt uitgerold...",
  };

  appendLog("info", "deployment", "Deploy gestart");
  broadcastState();

  try {
    await execAsync(
      "git fetch origin main --quiet && git reset --hard origin/main",
      {
        cwd: __dirname + "/..",
      },
    );

    await execAsync("npm ci", {
      cwd: __dirname + "/..",
    });

    await execAsync("npm ci", {
      cwd: path.join(__dirname),
    });

    await execAsync("npm run build", {
      cwd: __dirname + "/..",
    });

    const { stdout: deployedCommitStdout } = await execAsync(
      "git rev-parse HEAD",
      {
        cwd: __dirname + "/..",
      },
    );

    const { stdout: deployedCommitMessageStdout } = await execAsync(
      "git log -1 --pretty=%s HEAD",
      {
        cwd: __dirname + "/..",
      },
    );

    const deployedCommit = deployedCommitStdout.trim();
    const deployedCommitMessage = deployedCommitMessageStdout.trim();

    state.deployment = {
      ...state.deployment,
      status: "success",
      currentCommit: deployedCommit,
      currentCommitMessage: deployedCommitMessage,
      remoteCommit: deployedCommit,
      remoteCommitMessage: deployedCommitMessage,
      hasUpdate: false,
      lastDeployedAt: Date.now(),
      message: "Deploy gelukt. Services worden herstart.",
    };

    appendLog(
      "info",
      "deployment",
      "Deploy gelukt",
      `${deployedCommit.slice(0, 7)} · ${deployedCommitMessage}`,
    );

    persistAndBroadcast();

    setTimeout(() => {
      exec("sudo systemctl restart smart-mirror-backend smart-mirror-frontend");
    }, 1000);
  } catch (error) {
    state.deployment = {
      ...state.deployment,
      status: "error",
      message: "Deploy mislukt. Check server logs.",
    };

    appendLog(
      "error",
      "deployment",
      "Deploy mislukt",
      error instanceof Error ? error.message : String(error),
    );

    console.error("failed to deploy latest version", error);
    persistAndBroadcast();
  }
}

function persistAndBroadcast() {
  saveState(state);
  broadcastState();
}

function markPresenceActive() {
  state.presence = {
    mode: "active",
    lastMotionAt: Date.now(),
  };

  updateDisplayState("motion");
  appendLog("info", "presence", "Beweging gedetecteerd");
  persistAndBroadcast();
}

function isJellyfinVideoPlaying(media) {
  return (
    media.source === "jellyfin" &&
    media.status === "playing" &&
    (media.kind === "movie" || media.kind === "episode")
  );
}

function isSpotifyListeningSession(media) {
  return (
    media.source === "spotify" &&
    media.kind === "track" &&
    (media.status === "playing" || media.status === "paused")
  );
}

function isSameMediaSourceAsContextToggle() {
  return (
    state.display.spotifyContextKeepAwake && state.media.source === "spotify"
  );
}

function isSpotifyContextSessionAlive() {
  if (!state.display.spotifyContextKeepAwake) {
    return false;
  }

  // Als Spotify niet meer de actieve provider/media-source is,
  // is de app/sessie weg en skippen we de timeout.
  if (state.media.source !== "spotify") {
    return false;
  }

  // Playback betekent altijd actieve sessie.
  if (state.media.status === "playing") {
    return true;
  }

  // Paused/idle betekent: alleen actief zolang media-auto focus nog leeft.
  if (
    state.display.focusedWidgetId === "media" &&
    state.display.focusSource === "media-auto" &&
    state.display.mediaIdleSince !== null
  ) {
    return true;
  }

  return false;
}

function isLightSensorReady() {
  return state.settings.lightSensorEnabled && state.light.status === "ok";
}

function getDisplayKeepAwakeReason() {
  if (!state.settings.autoSleepEnabled) {
    return "Auto sleep staat uit";
  }

  if (!state.settings.lightSensorEnabled) {
    return "Lichtsensor staat uit";
  }

  if (state.light.status !== "ok") {
    return "Lichtsensor niet beschikbaar";
  }

  if (state.light.mode === "bright") {
    return "Kamerlicht aan";
  }

  if (state.light.mode === "context" && isJellyfinVideoPlaying(state.media)) {
    if (state.media.kind === "movie") {
      return "Jellyfin film speelt in context-zone";
    }

    if (state.media.kind === "episode") {
      return "Jellyfin aflevering speelt in context-zone";
    }

    return "Jellyfin video speelt in context-zone";
  }

  if (
    (state.light.mode === "context" || state.light.mode === "dark") &&
    isSpotifyContextSessionAlive()
  ) {
    return state.light.mode === "dark"
      ? "Spotify luistersessie actief in donkere kamer"
      : "Spotify luistersessie actief in context-zone";
  }

  return null;
}

function shouldLightKeepDisplayOn() {
  return getDisplayKeepAwakeReason() !== null;
}

function syncPresenceFromEnvironment() {
  if (!state.settings.lightSensorEnabled || state.light.status !== "ok") {
    return false;
  }

  const nextMode = shouldLightKeepDisplayOn() ? "active" : "idle";

  if (state.presence.mode === nextMode) {
    return false;
  }

  state.presence = {
    ...state.presence,
    mode: nextMode,
    lastMotionAt:
      nextMode === "active" ? Date.now() : state.presence.lastMotionAt,
  };

  return true;
}

const PHYSICAL_DISPLAY_SCRIPT = "/usr/local/bin/smart-mirror-display";

let lastPhysicalDisplayMode = null;

function syncPhysicalDisplay(mode) {
  if (process.platform !== "linux") {
    return;
  }

  if (mode !== "on" && mode !== "sleep") {
    return;
  }

  if (lastPhysicalDisplayMode === mode) {
    return;
  }

  const commandMode = mode === "on" ? "on" : "off";

  execFile("sudo", ["-n", PHYSICAL_DISPLAY_SCRIPT, commandMode], (error) => {
    if (error) {
      lastPhysicalDisplayMode = null;

      appendLog(
        "error",
        "display",
        "Fysieke display sync mislukt",
        error.message,
      );

      return;
    }

    lastPhysicalDisplayMode = mode;

    appendLog(
      "info",
      "display",
      "Fysieke display sync uitgevoerd",
      `physical=${commandMode}`,
    );
  });
}

function updateDisplayState(reason = "system") {
  const previousMode = state.display.mode;
  const previousReason = state.display.reason;

  const keepAwakeReason = getDisplayKeepAwakeReason();
  const lightKeepsDisplayOn = keepAwakeReason !== null;

  let nextMode = "on";

  if (!state.settings.autoSleepEnabled) {
    nextMode = "on";
  } else if (!state.settings.lightSensorEnabled) {
    nextMode = "on";
  } else if (state.light.status !== "ok") {
    nextMode = "on";
  } else {
    nextMode = lightKeepsDisplayOn ? "on" : "sleep";
  }

  state.display = {
    ...state.display,
    mode: nextMode,
    reason,
    keepAwakeReason: nextMode === "on" ? keepAwakeReason : null,
    updatedAt: Date.now(),
  };

  syncPhysicalDisplay(nextMode);

  if (previousMode !== nextMode || previousReason !== reason) {
    appendLog(
      "info",
      "display",
      "Display state gewijzigd",
      `mode=${nextMode} · trigger=${reason} · keepAwake=${keepAwakeReason ?? "none"} · light=${state.light.mode} · media=${state.media.source}:${state.media.kind}:${state.media.status}`,
    );
  }

  return previousMode !== nextMode || previousReason !== reason;
}

function startBackgroundJobs() {
  console.log("[boot] starting now playing polling", {
    idleIntervalMs: NOW_PLAYING_IDLE_POLL_INTERVAL_MS,
    activeIntervalMs: NOW_PLAYING_ACTIVE_POLL_INTERVAL_MS,
  });

  void runNowPlayingPollTick("boot").finally(scheduleNextNowPlayingPoll);
}

console.log("[boot] registering presence timeout interval");

setInterval(() => {
  let stateChanged = false;

  if (
    state.presence.mode === "active" &&
    state.presence.lastMotionAt &&
    state.settings.autoSleepEnabled
  ) {
    const timeoutMs = state.settings.sleepTimeoutSeconds * 1000;
    const elapsedMs = Date.now() - state.presence.lastMotionAt;

    if (elapsedMs >= timeoutMs) {
      state.presence = {
        ...state.presence,
        mode: "idle",
      };

      updateDisplayState("timeout");
      stateChanged = true;
    }
  }

  if (reconcileFocusState("interval:tick")) {
    stateChanged = true;
  }

  if (syncSpotifyContextKeepAwakeSession()) {
    updateDisplayState("spotify-context:session-ended");
    stateChanged = true;
  }

  if (stateChanged) {
    persistAndBroadcast();
  }
}, 1000);

function broadcastState() {
  const message = JSON.stringify({
    type: "state:update",
    payload: state,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

function updateSettings(partialSettings = {}) {
  state.settings = normalizeSettings({
    ...state.settings,
    ...partialSettings,
  });

  appendLog(
    "info",
    "settings",
    "Instellingen bijgewerkt",
    JSON.stringify(partialSettings),
  );
  updateDisplayState("settings:update");
  applyMediaVisibilityDefaults("settings:media-defaults");

  if (reconcileFocusState("settings:update")) {
    appendLog(
      "info",
      "focus",
      "Focus state aangepast na settings update",
      null,
    );
  }

  persistAndBroadcast();
}

function reorderLayoutByIds(currentLayout, orderedIds) {
  const itemsById = new Map(currentLayout.map((item) => [item.id, item]));

  const nextLayout = orderedIds.map((id) => itemsById.get(id)).filter(Boolean);

  if (nextLayout.length !== currentLayout.length) {
    return currentLayout;
  }

  return nextLayout;
}

function setLayoutItemPosition(widgetId, nextPosition) {
  if (!isWidgetId(widgetId) || widgetId === "clock") {
    return false;
  }

  if (!isWidgetEdgePosition(nextPosition)) {
    return false;
  }

  const currentItem = state.layout.find((item) => item.id === widgetId);

  if (!currentItem || currentItem.position === nextPosition) {
    return false;
  }

  const nextLayout = state.layout.map((item) => ({ ...item }));
  const selectedItem = nextLayout.find((item) => item.id === widgetId);

  if (!selectedItem) {
    return false;
  }

  const previousPosition = selectedItem.position;
  const occupiedItem = nextLayout.find(
    (item) =>
      item.id !== widgetId &&
      item.id !== "clock" &&
      item.position === nextPosition,
  );

  selectedItem.position = nextPosition;

  if (occupiedItem) {
    occupiedItem.position = previousPosition;
  }

  state.layout = normalizeLayout(nextLayout);

  appendLog(
    "info",
    "layout",
    "Widgetpositie gewijzigd",
    `${widgetId}: ${previousPosition} -> ${nextPosition}`,
  );

  return true;
}

function handleClientMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "widget:toggle") {
    const { widgetId } = message.payload ?? {};

    if (!isWidgetId(widgetId)) {
      return false;
    }

    state.layout = state.layout.map((item) =>
      item.id === widgetId ? { ...item, enabled: !item.enabled } : item,
    );

    persistAndBroadcast();
    return true;
  }

  if (message.type === "layout:reorder") {
    const { orderedIds } = message.payload ?? {};

    state.layout = reorderLayoutByIds(state.layout, orderedIds ?? []);
    persistAndBroadcast();
    return true;
  }

  if (message.type === "layout:position") {
    const { widgetId, position } = message.payload ?? {};

    if (!setLayoutItemPosition(widgetId, position)) {
      return false;
    }

    persistAndBroadcast();
    return true;
  }

  if (message.type === "settings:update") {
    updateSettings(message.payload ?? {});
    return true;
  }

  if (message.type === "display:focus") {
    const { widgetId } = message.payload ?? {};

    if (!isWidgetId(widgetId)) {
      return false;
    }

    setFocusedWidget(widgetId, "manual", "focus:manual");
    persistAndBroadcast();
    return true;
  }

  if (message.type === "display:focus:clear") {
    clearFocusedWidget("focus:manual-clear", {
      suppressMediaAutoFocus: true,
    });
    persistAndBroadcast();
    return true;
  }

  if (message.type === "display:media-lyrics") {
    const { visible } = message.payload ?? {};

    setMediaLyricsVisible(visible === true, "lyrics:remote");
    persistAndBroadcast();
    return true;
  }

  if (message.type === "display:jellyfin-trivia") {
    const { visible } = message.payload ?? {};

    setMediaJellyfinTriviaVisible(visible === true, "jellyfin-trivia:remote");
    persistAndBroadcast();
    return true;
  }

  if (message.type === "display:spotify-context") {
    const { enabled } = message.payload ?? {};

    setSpotifyContextKeepAwake(enabled === true, "spotify-context:remote");
    persistAndBroadcast();
    return true;
  }

  if (message.type === "presence:motion") {
    markPresenceActive();
    return true;
  }

  if (message.type === "presence:reset-idle") {
    markPresenceActive();
    return true;
  }

  if (message.type === "deployment:check") {
    void checkForDeploymentUpdate();
    return true;
  }

  if (message.type === "deployment:deploy") {
    void deployLatestVersion();
    return true;
  }

  return false;
}

console.log("[boot] registering websocket handlers");

wss.on("connection", (ws, req) => {
  const clientId = nextWsClientId++;
  const clientIp = getClientAddress(req);
  const clientUserAgent = getClientUserAgent(req);

  console.log(`client connected #${clientId} ${clientIp}`);

  appendLog(
    "info",
    "ws",
    "Client verbonden",
    `id=${clientId} · ip=${clientIp} · ua=${clientUserAgent}`,
  );

  ws.isAlive = true;
  ws.on("pong", markWebSocketAlive);

  ws.on("error", (error) => {
    appendLog(
      "error",
      "ws",
      "Client socket error",
      `id=${clientId} · ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  ws.send(
    JSON.stringify({
      type: "state:init",
      payload: state,
    }),
  );

  ws.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      const handled = handleClientMessage(message);

      if (!handled) {
        appendLog(
          "warn",
          "ws",
          "Onbekend clientbericht",
          rawMessage.toString(),
        );
      }
    } catch (error) {
      console.error("invalid ws message", error);
      appendLog(
        "error",
        "ws",
        "Ongeldig clientbericht ontvangen",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  ws.on("close", (code, reasonBuffer) => {
    const reason =
      reasonBuffer && reasonBuffer.length > 0
        ? reasonBuffer.toString()
        : "no reason";

    appendLog(
      "warn",
      "ws",
      "Client verbinding verbroken",
      `id=${clientId} · ip=${clientIp} · code=${code} · reason=${reason}`,
    );

    console.log(
      `client disconnected #${clientId} code=${code} reason=${reason}`,
    );
  });
});

app.get("/config/providers/status", (_req, res) => {
  res.json({
    ok: true,
    providers: getRedactedProviderSecrets(),
  });
});

app.get("/config/providers/editable", (_req, res) => {
  res.json({
    ok: true,
    editable: getEditableProviderConfig(),
  });
});

app.post("/config/providers/secrets", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ ok: false, error: "Ongeldige request body." });
    return;
  }

  const jellyfinInput = req.body.jellyfin;
  const spotifyInput = req.body.spotify;
  const weatherInput = req.body.weather;
  const calendarInput = req.body.calendar;

  if (
    jellyfinInput === undefined &&
    spotifyInput === undefined &&
    weatherInput === undefined &&
    calendarInput === undefined
  ) {
    res.status(400).json({
      ok: false,
      error: "Geen provider configuratie ontvangen.",
    });
    return;
  }

  if (
    weatherInput !== undefined &&
    (typeof weatherInput !== "object" ||
      weatherInput === null ||
      Array.isArray(weatherInput))
  ) {
    res.status(400).json({
      ok: false,
      error: "Weather configuratie heeft ongeldig formaat.",
    });
    return;
  }

  if (
    calendarInput !== undefined &&
    (typeof calendarInput !== "object" ||
      calendarInput === null ||
      Array.isArray(calendarInput))
  ) {
    res.status(400).json({
      ok: false,
      error: "Calendar configuratie heeft ongeldig formaat.",
    });
    return;
  }

  if (calendarInput !== undefined) {
    const { addEntry, updateEntry, removeEntryId } = calendarInput;

    if (
      addEntry !== undefined &&
      (typeof addEntry !== "object" ||
        addEntry === null ||
        Array.isArray(addEntry))
    ) {
      res.status(400).json({
        ok: false,
        error: "Calendar addEntry heeft ongeldig formaat.",
      });
      return;
    }

    if (
      updateEntry !== undefined &&
      (typeof updateEntry !== "object" ||
        updateEntry === null ||
        Array.isArray(updateEntry))
    ) {
      res.status(400).json({
        ok: false,
        error: "Calendar updateEntry heeft ongeldig formaat.",
      });
      return;
    }

    if (removeEntryId !== undefined && typeof removeEntryId !== "string") {
      res.status(400).json({
        ok: false,
        error: "Calendar removeEntryId moet een string zijn.",
      });
      return;
    }

    if (
      addEntry === undefined &&
      updateEntry === undefined &&
      removeEntryId === undefined
    ) {
      res.status(400).json({
        ok: false,
        error: "Calendar configuratie bevat geen wijziging.",
      });
      return;
    }

    if (
      addEntry !== undefined &&
      (typeof addEntry.value !== "string" || addEntry.value.trim().length === 0)
    ) {
      res.status(400).json({
        ok: false,
        error: "Calendar addEntry.value moet een niet-lege string zijn.",
      });
      return;
    }

    if (
      updateEntry !== undefined &&
      (typeof updateEntry.id !== "string" || updateEntry.id.trim().length === 0)
    ) {
      res.status(400).json({
        ok: false,
        error: "Calendar updateEntry.id moet een niet-lege string zijn.",
      });
      return;
    }
  }

  if (
    jellyfinInput !== undefined &&
    (typeof jellyfinInput !== "object" ||
      jellyfinInput === null ||
      Array.isArray(jellyfinInput))
  ) {
    res.status(400).json({
      ok: false,
      error: "Jellyfin configuratie heeft ongeldig formaat.",
    });
    return;
  }

  if (jellyfinInput !== undefined) {
    const jellyfinClearableFields = new Set(["userName", "deviceName"]);

    for (const [fieldKey, fieldValue] of Object.entries(jellyfinInput)) {
      if (
        !fieldValue ||
        typeof fieldValue !== "object" ||
        Array.isArray(fieldValue) ||
        !Object.prototype.hasOwnProperty.call(fieldValue, "clear")
      ) {
        continue;
      }

      if (!jellyfinClearableFields.has(fieldKey)) {
        res.status(400).json({
          ok: false,
          error: `Jellyfin veld ${fieldKey} ondersteunt geen clear-operatie.`,
        });
        return;
      }

      if (fieldValue.clear !== true) {
        res.status(400).json({
          ok: false,
          error: `Jellyfin veld ${fieldKey}.clear moet true zijn.`,
        });
        return;
      }
    }
  }

  if (
    spotifyInput !== undefined &&
    (typeof spotifyInput !== "object" ||
      spotifyInput === null ||
      Array.isArray(spotifyInput))
  ) {
    res.status(400).json({
      ok: false,
      error: "Spotify configuratie heeft ongeldig formaat.",
    });
    return;
  }

  if (jellyfinInput) {
    saveJellyfinSecrets(jellyfinInput);
  }

  if (spotifyInput) {
    saveSpotifySecrets(spotifyInput);
    resetSpotifyAccessTokenCache();
  }

  if (weatherInput) {
    saveWeatherConfig(weatherInput);
  }

  if (calendarInput) {
    try {
      saveCalendarConfig(calendarInput);
    } catch (calendarError) {
      res.status(400).json({
        ok: false,
        error:
          calendarError instanceof Error
            ? calendarError.message
            : "Calendar configuratie opslaan mislukt.",
      });
      return;
    }
  }

  appendLog(
    "info",
    "config",
    "Provider secrets bijgewerkt",
    JSON.stringify({
      jellyfinKeys: jellyfinInput ? Object.keys(jellyfinInput) : [],
      spotifyKeys: spotifyInput ? Object.keys(spotifyInput) : [],
      weatherKeys: weatherInput ? Object.keys(weatherInput) : [],
      calendarMutation: calendarInput
        ? {
            hasAdd: Boolean(calendarInput.addEntry),
            hasUpdate: Boolean(calendarInput.updateEntry),
            hasRemove: typeof calendarInput.removeEntryId === "string",
          }
        : null,
    }),
  );

  await pollNowPlayingProviders();

  res.json({
    ok: true,
    providers: getRedactedProviderSecrets(),
  });
});

app.get("/auth/spotify/status", (_req, res) => {
  const providers = getRedactedProviderSecrets();

  res.json({
    ok: true,
    spotify: providers.spotify,
  });
});

app.get("/auth/spotify/login", (_req, res) => {
  const spotifySecrets = getSpotifySecrets();

  if (!spotifySecrets.clientId || !spotifySecrets.clientSecret) {
    res
      .status(400)
      .send(
        "Spotify client ID of client secret ontbreekt. Zet eerst SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET.",
      );
    return;
  }

  res.redirect(buildSpotifyAuthorizeUrl());
});

app.get("/auth/spotify/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const error = typeof req.query.error === "string" ? req.query.error : null;

  if (error) {
    res.status(400).send(`Spotify authorisatie geweigerd of mislukt: ${error}`);
    return;
  }

  cleanupPendingSpotifyStates();

  if (!state || !pendingSpotifyStates.has(state)) {
    res.status(400).send("Spotify state mismatch of verlopen login-poging.");
    return;
  }

  pendingSpotifyStates.delete(state);

  if (!code) {
    res.status(400).send("Spotify callback bevat geen code.");
    return;
  }

  try {
    const spotifySecrets = getSpotifySecrets();
    const tokenPayload = await exchangeSpotifyAuthorizationCode(code);

    saveSpotifySecrets({
      clientId: spotifySecrets.clientId,
      clientSecret: spotifySecrets.clientSecret,
      refreshToken: tokenPayload.refresh_token,
      redirectUri: spotifySecrets.redirectUri,
    });

    resetSpotifyAccessTokenCache();

    appendLog(
      "info",
      "spotify",
      "Spotify refresh token opgeslagen",
      spotifySecrets.redirectUri,
    );

    await pollNowPlayingProviders();

    res.send(`
      <!doctype html>
      <html lang="nl">
        <head>
          <meta charset="utf-8" />
          <title>Spotify gekoppeld</title>
          <style>
            body {
              margin: 0;
              padding: 40px;
              background: #0b0b0b;
              color: white;
              font-family: Arial, sans-serif;
            }
            .card {
              max-width: 720px;
              padding: 24px;
              border-radius: 20px;
              background: rgba(255,255,255,0.04);
              border: 1px solid rgba(255,255,255,0.08);
            }
            code {
              display: inline-block;
              margin-top: 8px;
              padding: 6px 10px;
              border-radius: 10px;
              background: rgba(255,255,255,0.08);
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Spotify is gekoppeld</h1>
            <p>De refresh token is server-side opgeslagen in <code>server/secrets.local.json</code>.</p>
            <p>Je kunt dit venster sluiten en teruggaan naar je mirror/admin.</p>
          </div>
        </body>
      </html>
    `);
  } catch (callbackError) {
    appendLog(
      "error",
      "spotify",
      "Spotify callback mislukt",
      callbackError instanceof Error
        ? callbackError.message
        : String(callbackError),
    );

    res
      .status(500)
      .send(
        callbackError instanceof Error
          ? callbackError.message
          : "Spotify callback mislukt.",
      );
  }
});

app.get("/dashboard", async (_req, res) => {
  try {
    const [weatherResult, agendaResult] = await Promise.all([
      fetchMirrorWeather(),
      fetchMirrorAgenda(),
    ]);

    res.json({
      ok: true,
      weather: weatherResult.weather,
      calendar: agendaResult.calendar,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error("failed to build dashboard data", error);

    res.status(500).json({
      ok: false,
      error:
        error instanceof Error ? error.message : "Dashboard ophalen mislukt.",
    });
  }
});

console.log("[boot] registering health route");
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

console.log("[boot] registering state route");
app.get("/state", (_req, res) => {
  res.json(state);
});

app.get("/media/lyrics", async (req, res) => {
  console.log("[lyrics:req]", {
    ip: req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
    trackName: req.query.trackName,
    artistName: req.query.artistName,
    albumName: req.query.albumName,
    durationMs: req.query.durationMs,
  });

  const result = await fetchLyricsFromLrclib({
    trackName: req.query.trackName,
    artistName: req.query.artistName,
    albumName: req.query.albumName,
    durationMs: req.query.durationMs,
  });

  console.log("[lyrics:res]", {
    ip: req.socket.remoteAddress,
    status: result.status,
    ok: result.body?.ok,
    hasLyrics: Boolean(result.body?.lyrics),
    message: result.body?.message ?? result.body?.error ?? null,
  });

  res.status(result.status).json(result.body);
});

app.get("/media/jellyfin-trivia", async (req, res) => {
  const currentSessionKey = getJellyfinTriviaSessionKey(state.media);
  const requestedSessionKey =
    typeof req.query.sessionKey === "string" ? req.query.sessionKey : null;

  console.log("[jellyfin-trivia:req]", {
    ip: req.socket.remoteAddress,
    itemId: req.query.itemId,
    title: req.query.title,
    requestedSessionKey,
    currentSessionKey,
  });

  if (
    requestedSessionKey !== null &&
    currentSessionKey !== null &&
    requestedSessionKey !== currentSessionKey
  ) {
    res.json({
      ok: true,
      eligible: false,
      mediaKey: null,
      sessionKey: currentSessionKey,
      sourceProvider: null,
      sourceTitleId: null,
      sourceUrls: [],
      errorCode: null,
      items: [],
      message: "Jellyfin sessie is gewijzigd.",
    });
    return;
  }

  const body = await fetchJellyfinTriviaForMedia({
    media: state.media,
    sessionKey: currentSessionKey,
  });

  console.log("[jellyfin-trivia:res]", {
    itemCount: body.items.length,
    eligible: body.eligible,
    sourceProvider: body.sourceProvider,
    sourceTitleId: body.sourceTitleId,
    errorCode: body.errorCode,
    message: body.message,
  });

  res.json(body);
});

console.log("[boot] registering action route");
app.post("/action", (req, res) => {
  const handled = handleClientMessage(req.body);

  if (!handled) {
    res.status(400).json({ ok: false, error: "Unknown action" });
    return;
  }

  res.json({ ok: true });
});

const PORT = 8787;

server.on("error", (error) => {
  console.error("[fatal] http server error", error);
});

wss.on("error", (error) => {
  console.error("[fatal] websocket server error", error);
});

console.log(`[boot] about to listen on port ${PORT}`);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[boot] server running on port ${PORT}`);
  startBackgroundJobs();
});
