import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DisplayState } from "../types/display";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { PresenceState } from "../types/presence";
import type { MediaState } from "../types/media";

type RemoteControlPageProps = {
  layout: LayoutItem[];
  display: DisplayState;
  presence: PresenceState;
  media: MediaState;
  isConnected: boolean;
  connectionStatus:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  connectionError: string | null;
  onFocusWidget: (widgetId: WidgetId) => void;
  onClearFocus: () => void;
  onSetMediaLyricsVisible: (visible: boolean) => void;
  onResetIdleTimer: () => void;
};

type FocusButtonDefinition = {
  id: WidgetId;
  label: string;
  subtitle: string;
};

const focusButtons: FocusButtonDefinition[] = [
  { id: "clock", label: "Klok", subtitle: "Tijd en datum" },
  { id: "weather", label: "Weer", subtitle: "Temperatuur en locatie" },
  { id: "media", label: "Media", subtitle: "Jellyfin en Spotify" },
  { id: "calendar", label: "Agenda", subtitle: "Volgende afspraak" },
];

function getConnectionStatusLabel(
  status: "connecting" | "connected" | "reconnecting" | "disconnected",
) {
  switch (status) {
    case "connecting":
      return "Verbinden...";
    case "connected":
      return "Live verbonden";
    case "reconnecting":
      return "Opnieuw verbinden...";
    case "disconnected":
      return "Verbinding verbroken";
    default:
      return status;
  }
}

function FocusButtonIcon({ widgetId }: { widgetId: WidgetId }) {
  if (widgetId === "clock") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }

  if (widgetId === "weather") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <path
          d="M7 18h9.2a3.8 3.8 0 0 0 .7-7.53A5.6 5.6 0 0 0 6.24 9a3.6 3.6 0 0 0 .76 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.5 4.5v2.2M3.8 6.2 5.4 7.8M2.8 10h2.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (widgetId === "calendar") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <rect
          x="3"
          y="5"
          width="18"
          height="16"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M8 3v4M16 3v4M3 10h18"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 8.5v7l5-3.5-5-3.5Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function getRemoteMediaTitle(media: MediaState) {
  if (media.kind === "episode" && media.subtitle.trim().length > 0) {
    const [seriesTitle] = media.subtitle.split(/\s+(?:·|Â·)\s+/);

    if (seriesTitle?.trim()) {
      return seriesTitle.trim();
    }
  }

  return media.title;
}

export function RemoteControlPage({
  layout,
  display,
  presence,
  media,
  isConnected,
  connectionStatus,
  connectionError,
  onFocusWidget,
  onClearFocus,
  onSetMediaLyricsVisible,
  onResetIdleTimer,
}: RemoteControlPageProps) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const enabledWidgets = useMemo(
    () => new Set(layout.filter((item) => item.enabled).map((item) => item.id)),
    [layout],
  );

  const focusSecondsLeft =
    display.focusUntil !== null && now > 0
      ? Math.max(0, Math.ceil((display.focusUntil - now) / 1000))
      : null;
  const remoteMediaTitle = getRemoteMediaTitle(media);
  const canToggleLyrics =
    display.focusedWidgetId === "media" &&
    media.kind === "track" &&
    (media.status === "playing" || media.status === "paused");

  return (
    <main className="remote-page">
      <div className="remote-header">
        <h1 className="remote-title">Smart Mirror Remote</h1>

        <div className="remote-links">
          <Link to="/" className="admin-link">
            Mirror
          </Link>
          <Link to="/admin" className="admin-link">
            Admin
          </Link>
        </div>
      </div>

      <p className="admin-status">
        Status: <strong>{getConnectionStatusLabel(connectionStatus)}</strong>
      </p>

      {connectionError ? (
        <p className="admin-status" style={{ color: "#ffb3b3" }}>
          {connectionError}
        </p>
      ) : null}

      <section className="remote-summary-card">
        <p>
          Focus: <strong>{display.focusedWidgetId ?? "normal state"}</strong>
        </p>
        <p>
          Focus source: <strong>{display.focusSource ?? "none"}</strong>
        </p>
        <p>
          Presence: <strong>{presence.mode}</strong>
        </p>
        <p>
          Display: <strong>{display.mode}</strong>
        </p>
        <p>
          Media: <strong>{media.status}</strong>
          {remoteMediaTitle ? ` - ${remoteMediaTitle}` : ""}
        </p>
        <p>
          Focus timeout: <strong>{focusSecondsLeft ?? "-"}</strong>
        </p>
      </section>

      <section className="remote-focus-grid">
        {focusButtons.map((button) => (
          <button
            key={button.id}
            type="button"
            className="remote-focus-button"
            onClick={() => {
              onFocusWidget(button.id);
            }}
            disabled={!isConnected}
          >
            <span className="remote-focus-button__icon" aria-hidden>
              <FocusButtonIcon widgetId={button.id} />
            </span>
            <span className="remote-focus-button__text">
              <strong>{button.label}</strong>
              <span>{button.subtitle}</span>
              {!enabledWidgets.has(button.id) ? (
                <em>Widget staat uit in layout</em>
              ) : null}
            </span>
          </button>
        ))}
      </section>

      <div className="remote-action-row">
        <button
          type="button"
          onClick={onClearFocus}
          disabled={!isConnected || display.focusedWidgetId === null}
        >
          Reset naar normal state
        </button>

        <button type="button" onClick={onResetIdleTimer} disabled={!isConnected}>
          Reset idle timer
        </button>

        <button
          type="button"
          onClick={() => {
            onSetMediaLyricsVisible(!display.mediaLyricsVisible);
          }}
          disabled={!isConnected || !canToggleLyrics}
        >
          Lyrics {display.mediaLyricsVisible ? "uit" : "aan"}
        </button>
      </div>
    </main>
  );
}
