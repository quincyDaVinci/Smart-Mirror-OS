const fs = require("fs");
const path = require("path");

const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const STATE_FILE = path.join(__dirname, "state.json");

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { fetchJellyfinNowPlaying } = require("./providers/jellyfinNowPlaying");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const HEARTBEAT_INTERVAL_MS = 25000;

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

async function pollJellyfinNowPlaying() {
  try {
    const { media, providerStatus } = await fetchJellyfinNowPlaying();

    const nextMedia = media
      ? {
          ...state.media,
          ...media,
          sourceState: {
            ...state.media.sourceState,
            jellyfin: providerStatus,
          },
        }
      : {
          ...defaultState.media,
          sourceState: {
            ...state.media.sourceState,
            jellyfin: providerStatus,
          },
        };

    updateRuntimeMedia(nextMedia);
  } catch (error) {
    console.error("failed to poll jellyfin now playing", error);

    updateRuntimeMedia({
      ...defaultState.media,
      sourceState: {
        ...state.media.sourceState,
        jellyfin: {
          enabled: true,
          status: "error",
          message: "Jellyfin polling mislukt.",
          lastCheckedAt: Date.now(),
        },
      },
    });
  }
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

pollJellyfinNowPlaying();
setInterval(pollJellyfinNowPlaying, 2000);

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
  appendLog("info", "ws", "Client verbonden");

  ws.isAlive = true;
  ws.on("pong", markWebSocketAlive);

  ws.on("error", (error) => {
    appendLog(
      "error",
      "ws",
      "Client socket error",
      `id=${clientId} · ${error instanceof Error ? error.message : String(error)}`,
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

      if (message.type === "widget:toggle") {
        const { widgetId } = message.payload;

        state.layout = state.layout.map((item) =>
          item.id === widgetId ? { ...item, enabled: !item.enabled } : item,
        );

        persistAndBroadcast();
        return;
      }

      if (message.type === "layout:reorder") {
        const { orderedIds } = message.payload;

        state.layout = reorderLayoutByIds(state.layout, orderedIds);
        persistAndBroadcast();
        return;
      }

      if (message.type === "settings:update") {
        updateSettings(message.payload);
        return;
      }

      if (message.type === "presence:motion") {
        markPresenceActive();
        return;
      }

      if (message.type === "deployment:check") {
        checkForDeploymentUpdate();
        return;
      }

      if (message.type === "deployment:deploy") {
        deployLatestVersion();
        return;
      }
    } catch (error) {
      console.error("invalid ws message", error);
      appendLog("error", "ws", "Ongeldig ws bericht ontvangen");
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

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const PORT = 8787;

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`server running on port ${PORT}`);
  });
});
