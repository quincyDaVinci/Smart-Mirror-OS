import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";

type MirrorState = {
  layout: LayoutItem[];
  settings: MirrorSettings;
  presence: PresenceState;
  display: DisplayState;
};

type ServerMessage =
  | { type: "state:init"; payload: MirrorState }
  | { type: "state:update"; payload: MirrorState };

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787";

// Centrale live state voor mirror en admin via WebSocket
export function useMirrorSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [settings, setSettings] = useState<MirrorSettings>({
    showSeconds: false,
    idleTimeoutSeconds: 180,
  });
  const [presence, setPresence] = useState<PresenceState>({
    mode: "idle",
    lastMotionAt: null,
  });

  const [display, setDisplay] = useState<DisplayState>({
    mode: "dimmed",
    reason: "initial",
    updatedAt: Date.now(),
  });


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

      if (message.type === "state:init" || message.type === "state:update") {
        setLayout(message.payload.layout);
        setSettings(message.payload.settings);
        setPresence(message.payload.presence);
        setDisplay(message.payload.display);
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

      reorderLayout(orderedIds: WidgetId[]) {
        socketRef.current?.send(
          JSON.stringify({
            type: "layout:reorder",
            payload: { orderedIds },
          }),
        );
      },
      updateSettings(nextSettings: Partial<MirrorSettings>) {
        socketRef.current?.send(
          JSON.stringify({
            type: "settings:update",
            payload: nextSettings,
          }),
        );
      },
      simulateMotion() {
        socketRef.current?.send(
          JSON.stringify({
            type: "presence:motion",
          }),
        );
      },
    }),
    [],
  );

  return {
    layout,
    settings,
    presence,
    display,
    isConnected,
    ...actions,
  };
}
