import { useEffect, useRef, useState } from "react";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";
import { getWebSocketUrl } from "../utils/getWebSocketUrl";
import type { DeploymentState } from "../types/deployment";

type MirrorState = {
  layout: LayoutItem[];
  settings: MirrorSettings;
  presence: PresenceState;
  display: DisplayState;
  deployment: DeploymentState;
};

type ServerMessage =
  | { type: "state:init"; payload: MirrorState }
  | { type: "state:update"; payload: MirrorState };

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const WS_URL = getWebSocketUrl();

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

function getReconnectDelayMs(attempt: number) {
  return Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
    RECONNECT_MAX_DELAY_MS,
  );
}

function isMirrorState(value: unknown): value is MirrorState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MirrorState>;

  return (
    Array.isArray(candidate.layout) &&
    typeof candidate.settings === "object" &&
    candidate.settings !== null &&
    typeof candidate.presence === "object" &&
    candidate.presence !== null &&
    typeof candidate.display === "object" &&
    candidate.display !== null
  );
}

function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { type?: unknown; payload?: unknown };

  return (
    (candidate.type === "state:init" || candidate.type === "state:update") &&
    isMirrorState(candidate.payload)
  );
}

// Centrale live state voor mirror en admin via WebSocket
export function useMirrorSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const lastHandledDeployAtRef = useRef<number | null>(null);

  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [settings, setSettings] = useState<MirrorSettings>({
    showSeconds: true,
    mirrorMode: "normal",
    autoSleepEnabled: false,
    sleepTimeoutSeconds: 180,
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
  const [deployment, setDeployment] = useState<DeploymentState>({
    status: "idle",
    currentCommit: null,
    remoteCommit: null,
    hasUpdate: false,
    lastCheckedAt: null,
    lastDeployedAt: null,
    message: null,
  });

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    isUnmountedRef.current = false;

    function clearReconnectTimeout() {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (isUnmountedRef.current) {
        return;
      }

      clearReconnectTimeout();

      const nextAttempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = nextAttempt;

      const delayMs = getReconnectDelayMs(nextAttempt);

      setConnectionStatus("reconnecting");
      setConnectionError(
        `Verbinding verloren. Nieuwe poging over ${Math.ceil(delayMs / 1000)}s.`,
      );

      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectSocket();
      }, delayMs);
    }

    function connectSocket() {
      clearReconnectTimeout();

      setConnectionStatus(
        reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
      );

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (socket !== socketRef.current) {
          return;
        }

        reconnectAttemptsRef.current = 0;
        setIsConnected(true);
        setConnectionStatus("connected");
        setConnectionError(null);
      });

      socket.addEventListener("close", () => {
        if (socket !== socketRef.current) {
          return;
        }

        setIsConnected(false);

        if (isUnmountedRef.current) {
          return;
        }

        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (socket !== socketRef.current) {
          return;
        }

        setConnectionError("Er ging iets mis met de WebSocket-verbinding.");

        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
      });

      socket.addEventListener("message", (event) => {
        if (socket !== socketRef.current) {
          return;
        }

        try {
          const parsedMessage: unknown = JSON.parse(event.data);

          if (!isServerMessage(parsedMessage)) {
            setConnectionError("Ongeldig serverbericht ontvangen.");
            return;
          }

          setLayout(parsedMessage.payload.layout);
          setSettings(parsedMessage.payload.settings);
          setPresence(parsedMessage.payload.presence);
          setDisplay(parsedMessage.payload.display);
          setDeployment(parsedMessage.payload.deployment);
        } catch (error) {
          console.error("failed to parse ws message", error);
          setConnectionError("Kon serverbericht niet verwerken.");
        }
      });
    }

    connectSocket();

    return () => {
      isUnmountedRef.current = true;
      clearReconnectTimeout();

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/") {
      return;
    }

    if (!deployment.lastDeployedAt) {
      return;
    }

    if (lastHandledDeployAtRef.current === null) {
      lastHandledDeployAtRef.current = deployment.lastDeployedAt;
      return;
    }

    if (deployment.lastDeployedAt !== lastHandledDeployAtRef.current) {
      lastHandledDeployAtRef.current = deployment.lastDeployedAt;
      window.location.reload();
    }
  }, [deployment.lastDeployedAt]);

  function sendMessage(message: unknown) {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setConnectionError("Actie niet verstuurd: er is geen live verbinding.");
      return;
    }

    socket.send(JSON.stringify(message));
  }

  function toggleWidget(widgetId: WidgetId) {
    sendMessage({
      type: "widget:toggle",
      payload: { widgetId },
    });
  }

  function reorderLayout(orderedIds: WidgetId[]) {
    sendMessage({
      type: "layout:reorder",
      payload: { orderedIds },
    });
  }

  function updateSettings(nextSettings: Partial<MirrorSettings>) {
    sendMessage({
      type: "settings:update",
      payload: nextSettings,
    });
  }

  function simulateMotion() {
    sendMessage({
      type: "presence:motion",
    });
  }

  function checkDeploymentUpdate() {
    sendMessage({
      type: "deployment:check",
    });
  }

  function deployLatestVersion() {
    sendMessage({
      type: "deployment:deploy",
    });
  }

  return {
    layout,
    settings,
    presence,
    display,
    isConnected,
    connectionStatus,
    connectionError,
    deployment,
    toggleWidget,
    reorderLayout,
    updateSettings,
    simulateMotion,
    checkDeploymentUpdate,
    deployLatestVersion,
  };
}
