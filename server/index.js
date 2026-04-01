const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const state = {
  layout: [
    { id: "clock", enabled: true },
    { id: "weather", enabled: true },
    { id: "media", enabled: true },
    { id: "calendar", enabled: true },
  ],
};

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

function reorderLayoutByIds(currentLayout, orderedIds) {
  const itemsById = new Map(currentLayout.map((item) => [item.id, item]));

  const nextLayout = orderedIds
    .map((id) => itemsById.get(id))
    .filter(Boolean);

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
          item.id === widgetId
            ? { ...item, enabled: !item.enabled }
            : item,
        );

        broadcastState();
        return;
      }

      if (message.type === "layout:reorder") {
        const { orderedIds } = message.payload;

        state.layout = reorderLayoutByIds(state.layout, orderedIds);
        broadcastState();
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
server.listen(PORT, () => {
  console.log(`server running on http://localhost:${PORT}`);
});