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

const defaultState = {
  layout: [
    { id: "clock", enabled: true },
    { id: "weather", enabled: true },
    { id: "media", enabled: true },
    { id: "calendar", enabled: true },
  ],
  settings: {
    showSeconds: true,
    mirrorMode: "normal",
    autoSleepEnabled: false,
    sleepTimeoutSeconds: 180,
  },
  presence: {
    mode: "idle",
    lastMotionAt: null,
  },
  display: {
    mode: "dimmed",
    reason: "initial",
    updatedAt: Date.now(),
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
    lastUpdatedAt: null,
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

function normalizeSettings(input = {}) {
  const { idleTimeoutSeconds, sleepTimeoutSeconds, ...restSettings } = input;

  return {
    ...defaultState.settings,
    ...restSettings,
    sleepTimeoutSeconds:
      sleepTimeoutSeconds ??
      idleTimeoutSeconds ??
      defaultState.settings.sleepTimeoutSeconds,
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
      settings: normalizeSettings(parsedState.settings ?? {}),
      presence: {
        ...baseState.presence,
        ...parsedState.presence,
      },
      display: {
        ...baseState.display,
        ...parsedState.display,
      },
      deployment: {
        ...baseState.deployment,
        ...parsedState.deployment,
      },
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

function updateRuntimeMedia(nextMedia) {
  if (!hasMediaChanged(state.media, nextMedia)) {
    return;
  }

  state.media = nextMedia;
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
  if (state.presence.mode !== "active") {
    return;
  }

  if (!state.presence.lastMotionAt) {
    return;
  }

  if (!state.settings.autoSleepEnabled) {
    return;
  }

  const timeoutMs = state.settings.sleepTimeoutSeconds * 1000;
  const elapsedMs = Date.now() - state.presence.lastMotionAt;

  if (elapsedMs >= timeoutMs) {
    state.presence = {
      ...state.presence,
      mode: "idle",
    };

    updateDisplayState("timeout");
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

function handleClientMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "widget:toggle") {
    const { widgetId } = message.payload ?? {};

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

  if (message.type === "settings:update") {
    updateSettings(message.payload ?? {});
    return true;
  }

  if (message.type === "presence:motion") {
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
