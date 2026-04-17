import { useEffect, useRef, useState } from "react";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";
import { getWebSocketUrl } from "../utils/getWebSocketUrl";
import type { DeploymentState } from "../types/deployment";
import type { MediaState } from "../types/media";
import type { DebugLogEntry } from "../types/log";

type MirrorState = {
  layout: LayoutItem[];
  settings: MirrorSettings;
  presence: PresenceState;
  display: DisplayState;
  deployment: DeploymentState;
  media: MediaState;
  logs: DebugLogEntry[];
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

function getApiBaseUrl() {
  const url = new URL(WS_URL);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
const CONNECT_TIMEOUT_MS = 5000;

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
  const connectTimeoutRef = useRef<number | null>(null);
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
    currentCommitMessage: null,
    remoteCommit: null,
    remoteCommitMessage: null,
    hasUpdate: false,
    lastCheckedAt: null,
    lastDeployedAt: null,
    message: null,
  });
  const [media, setMedia] = useState<MediaState>({
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
  });
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [clientLogs, setClientLogs] = useState<DebugLogEntry[]>([]);

  function applyState(nextState: MirrorState) {
    setLayout(nextState.layout);
    setSettings(nextState.settings);
    setPresence(nextState.presence);
    setDisplay(nextState.display);
    setDeployment(nextState.deployment);
    setMedia(nextState.media);
    setLogs(nextState.logs ?? []);
  }

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  function appendClientLog(
    level: "info" | "warn" | "error",
    source: string,
    message: string,
    meta: string | null = null,
  ) {
    setClientLogs((previousLogs) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          level,
          source,
          message,
          meta,
        },
        ...previousLogs,
      ].slice(0, 100),
    );
  }

  async function fetchStateSnapshot(reason: string) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/state`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const nextState: unknown = await response.json();

      if (!isMirrorState(nextState)) {
        throw new Error("Snapshot heeft ongeldig formaat");
      }

      applyState(nextState);
      appendClientLog("info", "http", "State snapshot opgehaald", reason);
    } catch (error) {
      appendClientLog(
        "error",
        "http",
        "State snapshot ophalen mislukt",
        `${reason} · ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  useEffect(() => {
    isUnmountedRef.current = false;

    function clearReconnectTimeout() {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function clearConnectTimeout() {
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (isUnmountedRef.current) {
        return;
      }

      clearReconnectTimeout();
      clearConnectTimeout();

      const nextAttempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = nextAttempt;

      const delayMs = getReconnectDelayMs(nextAttempt);

      setConnectionStatus("reconnecting");
      setConnectionError(
        `Verbinding verloren. Nieuwe poging over ${Math.ceil(delayMs / 1000)}s.`,
      );
      appendClientLog(
        "warn",
        "ws",
        "Reconnect ingepland",
        `delay=${delayMs}ms`,
      );

      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectSocket();
      }, delayMs);
    }

    function connectSocket() {
      clearReconnectTimeout();
      clearConnectTimeout();

      const previousSocket = socketRef.current;

      if (
        previousSocket &&
        (previousSocket.readyState === WebSocket.OPEN ||
          previousSocket.readyState === WebSocket.CONNECTING)
      ) {
        previousSocket.close();
      }

      setConnectionStatus(
        reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
      );

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      connectTimeoutRef.current = window.setTimeout(() => {
        if (socket !== socketRef.current) {
          return;
        }

        if (socket.readyState === WebSocket.CONNECTING) {
          setConnectionError(
            "Server reageert te traag. Nieuwe verbindingspoging...",
          );
          socket.close();
        }
      }, CONNECT_TIMEOUT_MS);

      socket.addEventListener("open", () => {
        if (socket !== socketRef.current) {
          return;
        }

        clearConnectTimeout();
        reconnectAttemptsRef.current = 0;
        setIsConnected(true);
        setConnectionStatus("connected");
        setConnectionError(null);
        appendClientLog("info", "ws", "Verbonden met server", WS_URL);
      });

      socket.addEventListener("close", (event) => {
        if (socket !== socketRef.current) {
          return;
        }

        clearConnectTimeout();
        setIsConnected(false);

        appendClientLog(
          event.wasClean ? "warn" : "error",
          "ws",
          "Socket gesloten",
          `code=${event.code} · clean=${event.wasClean} · reason=${event.reason || "none"} · online=${navigator.onLine} · visibility=${document.visibilityState}`,
        );

        if (isUnmountedRef.current) {
          return;
        }

        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (socket !== socketRef.current) {
          return;
        }

        clearConnectTimeout();
        setConnectionError("Er ging iets mis met de WebSocket-verbinding.");
        appendClientLog(
          "error",
          "ws",
          "WebSocket error ontvangen",
          `online=${navigator.onLine} · visibility=${document.visibilityState}`,
        );

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
            appendClientLog("error", "ws", "Ongeldig serverbericht ontvangen");
            return;
          }

          applyState(parsedMessage.payload);
        } catch (error) {
          console.error("failed to parse ws message", error);
          setConnectionError("Kon serverbericht niet verwerken.");
          appendClientLog(
            "error",
            "ws",
            "Kon serverbericht niet verwerken",
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    }

    void fetchStateSnapshot("initial load");
    connectSocket();

    return () => {
      isUnmountedRef.current = true;
      clearReconnectTimeout();
      clearConnectTimeout();

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function handlePageShow() {
      appendClientLog(
        "info",
        "page",
        "pageshow",
        `visibility=${document.visibilityState}`,
      );
      void fetchStateSnapshot("pageshow");
    }

    function handleVisibilityChange() {
      appendClientLog(
        "info",
        "page",
        "visibilitychange",
        `visibility=${document.visibilityState}`,
      );

      if (document.visibilityState === "visible") {
        void fetchStateSnapshot("visibilitychange:visible");
      }
    }

    function handleOnline() {
      appendClientLog("info", "page", "online", String(navigator.onLine));
      void fetchStateSnapshot("online");
    }

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
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

  async function sendAction(message: unknown) {
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }

    appendClientLog(
      "warn",
      "http",
      "WebSocket niet open, HTTP fallback gebruikt",
      JSON.stringify(message),
    );

    try {
      const response = await fetch(`${getApiBaseUrl()}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchStateSnapshot("after http action fallback");
      setConnectionError(
        "Live verbinding tijdelijk weg. HTTP fallback gebruikt.",
      );
    } catch (error) {
      setConnectionError(
        "Actie mislukt: geen live verbinding en HTTP fallback faalde.",
      );
      appendClientLog(
        "error",
        "http",
        "HTTP action fallback mislukt",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function toggleWidget(widgetId: WidgetId) {
    void sendAction({
      type: "widget:toggle",
      payload: { widgetId },
    });
  }

  function reorderLayout(orderedIds: WidgetId[]) {
    void sendAction({
      type: "layout:reorder",
      payload: { orderedIds },
    });
  }

  function updateSettings(nextSettings: Partial<MirrorSettings>) {
    void sendAction({
      type: "settings:update",
      payload: nextSettings,
    });
  }

  function simulateMotion() {
    void sendAction({
      type: "presence:motion",
    });
  }

  function checkDeploymentUpdate() {
    void sendAction({
      type: "deployment:check",
    });
  }

  function deployLatestVersion() {
    void sendAction({
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
    media,
    logs,
    clientLogs,
  };
}
