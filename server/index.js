const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const STATE_FILE = path.join(__dirname, "state.json");

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { fetchJellyfinNowPlaying } = require("./providers/jellyfinNowPlaying");
const {
  fetchSpotifyNowPlaying,
  resetSpotifyAccessTokenCache,
} = require("./providers/spotifyNowPlaying");
const {
  saveJellyfinSecrets,
  getSpotifySecrets,
  saveSpotifySecrets,
  getRedactedProviderSecrets,
} = require("./secretsStore");

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [
  process.env.ADMIN_ALLOWED_ORIGIN,
  "http://localhost:4173",
  "http://127.0.0.1:4173",
].filter(Boolean);

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

const HEARTBEAT_INTERVAL_MS = 25000;

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-library-read",
];
const SPOTIFY_STATE_TTL_MS = 10 * 60 * 1000;

const pendingSpotifyStates = new Map();

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
    autoSleepEnabled: false,
    sleepTimeoutSeconds: 180,
    showStatusBar: true,
    layoutPaddingPx: 32,
    widgetGapPx: 16,
    zoomPercent: 100,
    focusIdleTimeoutSeconds: 45,
    mediaFocusExitDelaySeconds: 10,
  },
  presence: {
    mode: "idle",
    lastMotionAt: null,
  },
  display: {
    mode: "dimmed",
    reason: "initial",
    updatedAt: Date.now(),
    focusedWidgetId: null,
    focusSource: null,
    focusSetAt: null,
    focusUntil: null,
    mediaIdleSince: null,
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
    widgetGapPx,
    zoomPercent,
    focusIdleTimeoutSeconds,
    mediaFocusExitDelaySeconds,
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
    layoutPaddingPx: clampNumber(
      layoutPaddingPx,
      0,
      96,
      defaultState.settings.layoutPaddingPx,
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
  };

  if (!nextDisplay.focusedWidgetId) {
    nextDisplay.focusSource = null;
    nextDisplay.focusSetAt = null;
    nextDisplay.focusUntil = null;
    nextDisplay.mediaIdleSince = null;
  }

  if (nextDisplay.focusSource === "media-auto") {
    nextDisplay.focusedWidgetId = "media";
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

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return structuredClone(defaultState);
    }

    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsedState = JSON.parse(raw);
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
      display: normalizeDisplay(parsedState.display ?? {}),
      deployment: {
        ...baseState.deployment,
        ...parsedState.deployment,
      },
      media: normalizeMediaState(parsedState.media ?? {}),
    };
  } catch (error) {
    console.error("failed to load state, using default", error);
    return structuredClone(defaultState);
  }
}

function saveState(nextState) {
  try {
    const { logs, ...persistableState } = nextState;

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(persistableState, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("failed to save state", error);
  }
}

const state = loadState();
console.log("[boot] state loaded");

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
    previousSnapshot.artworkUrl !== nextMedia.artworkUrl ||
    previousSnapshot.durationMs !== nextMedia.durationMs ||
    previousSnapshot.isLiked !== nextMedia.isLiked
  );
}

function isMediaPlayableSource(mediaState) {
  return mediaState.source === "jellyfin" || mediaState.source === "spotify";
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
  const nextFocusUntil = now + getFocusIdleTimeoutMs();

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

function clearFocusedWidget(reason = "focus:clear") {
  if (!state.display.focusedWidgetId && !state.display.focusSource) {
    return false;
  }

  const previousWidgetId = state.display.focusedWidgetId;

  state.display = {
    ...state.display,
    focusedWidgetId: null,
    focusSource: null,
    focusSetAt: null,
    focusUntil: null,
    mediaIdleSince: null,
    reason,
    updatedAt: Date.now(),
  };

  appendLog(
    "info",
    "focus",
    "Focus widget gewist",
    `${previousWidgetId ?? "none"} · reason=${reason}`,
  );

  return true;
}

function reconcileFocusState(trigger = "focus:tick") {
  const now = Date.now();
  const focusedWidgetId = state.display.focusedWidgetId;
  const mediaIsPlaying =
    state.media.status === "playing" && isMediaPlayableSource(state.media);

  if (!focusedWidgetId) {
    if (mediaIsPlaying) {
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
      if (state.display.mediaIdleSince !== null) {
        state.display = {
          ...state.display,
          mediaIdleSince: null,
          reason: "focus:media-resumed",
          updatedAt: now,
        };

        return true;
      }

      return false;
    }

    if (state.media.status === "paused") {
      return false;
    }

    if (state.display.mediaIdleSince === null) {
      state.display = {
        ...state.display,
        mediaIdleSince: now,
        reason: "focus:media-idle",
        updatedAt: now,
      };

      return true;
    }

    const elapsedMs = now - state.display.mediaIdleSince;

    if (elapsedMs >= getMediaFocusExitDelayMs()) {
      return clearFocusedWidget("focus:media-idle-timeout");
    }

    return false;
  }

  if (state.display.focusUntil !== null && now >= state.display.focusUntil) {
    return clearFocusedWidget("focus:timeout");
  }

  return false;
}

function updateRuntimeMedia(nextMedia) {
  const normalizedMedia = normalizeMediaState(nextMedia);
  const previousLastPlayed = state.media.lastPlayed;

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

  const focusChanged = reconcileFocusState("media:update");

  if (!mediaChanged && !focusChanged) {
    return;
  }

  if (focusChanged || lastPlayedChanged) {
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

  if (jellyfinMedia) {
    return {
      ...defaultState.media,
      ...jellyfinMedia,
      sourceState,
    };
  }

  if (spotifyMedia) {
    return {
      ...defaultState.media,
      ...spotifyMedia,
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

  const nextMedia = buildResolvedMedia({
    jellyfinMedia: jellyfinResult.media,
    jellyfinStatus: jellyfinResult.providerStatus,
    spotifyMedia: spotifyResult.media,
    spotifyStatus: spotifyResult.providerStatus,
  });

  updateRuntimeMedia(nextMedia);
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

function updateDisplayState(reason = "system") {
  const previousMode = state.display.mode;
  const previousReason = state.display.reason;

  let nextMode = "on";

  if (!state.settings.autoSleepEnabled) {
    nextMode = "on";
  } else if (state.presence.mode === "active") {
    nextMode = "on";
  } else {
    nextMode = "sleep";
  }

  state.display = {
    ...state.display,
    mode: nextMode,
    reason,
    updatedAt: Date.now(),
  };

  if (previousMode !== nextMode || previousReason !== reason) {
    appendLog(
      "info",
      "display",
      "Display state gewijzigd",
      `mode=${nextMode} · reason=${reason} · autoSleep=${state.settings.autoSleepEnabled} · presence=${state.presence.mode}`,
    );
  }
}

function startBackgroundJobs() {
  console.log("[boot] starting now playing polling");
  void pollNowPlayingProviders();

  setInterval(() => {
    void pollNowPlayingProviders();
  }, 2000);
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
    clearFocusedWidget("focus:manual-clear");
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

app.post("/config/providers/secrets", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ ok: false, error: "Ongeldige request body." });
    return;
  }

  const jellyfinInput = req.body.jellyfin;
  const spotifyInput = req.body.spotify;

  if (jellyfinInput === undefined && spotifyInput === undefined) {
    res.status(400).json({
      ok: false,
      error: "Geen jellyfin of spotify configuratie ontvangen.",
    });
    return;
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

  appendLog(
    "info",
    "config",
    "Provider secrets bijgewerkt",
    JSON.stringify({
      jellyfinKeys: jellyfinInput ? Object.keys(jellyfinInput) : [],
      spotifyKeys: spotifyInput ? Object.keys(spotifyInput) : [],
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

console.log("[boot] registering health route");

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

console.log("[boot] registering state route");

app.get("/state", (_req, res) => {
  res.json(state);
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
