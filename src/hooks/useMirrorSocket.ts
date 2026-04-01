import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutItem, WidgetId } from "../types/layout";

type MirrorState = {
  layout: LayoutItem[];
};

type ServerMessage =
  | { type: "state:init"; payload: MirrorState }
  | { type: "state:update"; payload: MirrorState };

const WS_URL = "ws://localhost:8787";

export function useMirrorSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setIsConnected(true);
    });

    socket.addEventListener("close", () => {
      setIsConnected(false);
    });

    socket.addEventListener("message", (event) => {
      const message: ServerMessage = JSON.parse(event.data);

      if (
        message.type === "state:init" ||
        message.type === "state:update"
      ) {
        setLayout(message.payload.layout);
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  const actions = useMemo(
    () => ({
      toggleWidget(widgetId: WidgetId) {
        socketRef.current?.send(
          JSON.stringify({
            type: "widget:toggle",
            payload: { widgetId },
          }),
        );
      },

      moveWidget(widgetId: WidgetId, direction: "up" | "down") {
        socketRef.current?.send(
          JSON.stringify({
            type: "widget:move",
            payload: { widgetId, direction },
          }),
        );
      },
    }),
    [],
  );

  return {
    layout,
    isConnected,
    ...actions,
  };
}