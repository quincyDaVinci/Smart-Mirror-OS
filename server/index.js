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

function moveItem(array, fromIndex, toIndex) {
  const updated = [...array];
  const [item] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, item);
  return updated;
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
      }

      if (message.type === "widget:move") {
        const { widgetId, direction } = message.payload;
        const currentIndex = state.layout.findIndex(
          (item) => item.id === widgetId,
        );

        if (currentIndex === -1) {
          return;
        }

        const targetIndex =
          direction === "up" ? currentIndex - 1 : currentIndex + 1;

        if (
          targetIndex < 0 ||
          targetIndex >= state.layout.length
        ) {
          return;
        }

        state.layout = moveItem(state.layout, currentIndex, targetIndex);
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