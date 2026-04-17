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
    remoteCommit: null,
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
    fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), "utf-8");
  } catch (error) {
    console.error("failed to save state", error);
  }
}

const state = loadState();

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
  broadcastState();

  try {
    const { stdout: localStdout } = await execAsync("git rev-parse HEAD", {
      cwd: __dirname + "/..",
    });

    const { stdout: remoteStdout } = await execAsync(
      "git ls-remote origin refs/heads/main",
      {
        cwd: __dirname + "/..",
      },
    );

    const currentCommit = localStdout.trim();
    const remoteCommit = remoteStdout.trim().split(/\s+/)[0] ?? null;
    const hasUpdate = Boolean(remoteCommit) && currentCommit !== remoteCommit;

    state.deployment = {
      ...state.deployment,
      status: hasUpdate ? "update-available" : "up-to-date",
      currentCommit,
      remoteCommit,
      hasUpdate,
      lastCheckedAt: Date.now(),
      message: hasUpdate
        ? "Nieuwe update beschikbaar."
        : "Je zit al op de nieuwste versie.",
    };

    persistAndBroadcast();
  } catch (error) {
    state.deployment = {
      ...state.deployment,
      status: "error",
      lastCheckedAt: Date.now(),
      message: "Controleren op updates mislukt.",
    };

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
  broadcastState();

  try {
    await execAsync("git fetch origin && git reset --hard origin/main", {
      cwd: __dirname + "/..",
    });

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

    const deployedCommit = deployedCommitStdout.trim();

    state.deployment = {
      ...state.deployment,
      status: "success",
      currentCommit: deployedCommit,
      remoteCommit: deployedCommit,
      hasUpdate: false,
      lastDeployedAt: Date.now(),
      message: "Deploy gelukt. Services worden herstart.",
    };

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
  persistAndBroadcast();
}

function updateDisplayState(reason = "system") {
  let nextMode = "on";

  if (state.presence.mode === "active") {
    nextMode = "on";
  } else if (state.settings.autoSleepEnabled) {
    nextMode = "sleep";
  } else {
    nextMode = "dimmed";
  }

  state.display = {
    mode: nextMode,
    reason,
    updatedAt: Date.now(),
  };
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

wss.on("connection", (ws) => {
  console.log("client connected");

  ws.isAlive = true;
  ws.on("pong", markWebSocketAlive);

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
    }
  });

  ws.on("close", () => {
    console.log("client disconnected");
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const PORT = 8787;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});
