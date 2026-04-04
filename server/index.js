const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "state.json");

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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
