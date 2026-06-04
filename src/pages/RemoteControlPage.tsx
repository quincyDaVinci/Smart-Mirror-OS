import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DisplayState } from "../types/display";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { PresenceState } from "../types/presence";
import type { MediaState } from "../types/media";
import type { MirrorSettings } from "../types/settings";
import { CommitRange } from "../components/common/CommitRange";
import "./RemoteControlPage.css";

type RemoteControlPageProps = {
  layout: LayoutItem[];
  display: DisplayState;
  presence: PresenceState;
  media: MediaState;
  apiBaseUrl: string;
  isConnected: boolean;
  connectionStatus:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  connectionError: string | null;
  settings: MirrorSettings;
  onUpdateSettings: (nextSettings: Partial<MirrorSettings>) => void;
  onFocusWidget: (widgetId: WidgetId) => void;
  onClearFocus: () => void;
  onSetMediaLyricsVisible: (visible: boolean) => void;
  onSetMediaJellyfinTriviaVisible: (visible: boolean) => void;
  onSetSpotifyContextKeepAwake: (enabled: boolean) => void;
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

function getDisplayModeLabel(mode: DisplayState["mode"]) {
  switch (mode) {
    case "on":
      return "Aan";
    case "dimmed":
      return "Gedimd";
    case "sleep":
      return "Sleep";
    default:
      return mode;
  }
}

function getFocusLabel(widgetId: WidgetId | null) {
  switch (widgetId) {
    case "clock":
      return "Klok";
    case "weather":
      return "Weer";
    case "media":
      return "Media";
    case "calendar":
      return "Agenda";
    case null:
      return "Geen focus";
    default:
      return widgetId;
  }
}

function getPresenceLabel(mode: PresenceState["mode"]) {
  return mode === "active" ? "Actief" : "Idle";
}

function getFocusSourceLabel(source: DisplayState["focusSource"]) {
  if (source === "manual") return "Handmatig";
  if (source === "media-auto") return "Media automatisch";
  return "Geen";
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
      <path d="M10 8.5v7l5-3.5-5-3.5Z" fill="currentColor" stroke="none" />
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

type RemoteTriviaAvailability =
  | { status: "idle"; available: false }
  | { status: "loading"; available: false }
  | { status: "available"; available: true }
  | { status: "unavailable"; available: false }
  | { status: "error"; available: false };

function getRemoteTriviaLookupKey(media: MediaState) {
  return [
    media.source,
    media.kind,
    media.status,
    media.sourceItemId ?? "",
    media.title,
    media.subtitle,
    media.seriesTitle ?? "",
    media.seasonNumber ?? "",
    media.episodeNumber ?? "",
    media.durationMs ?? "",
  ].join("\n");
}

function getRemoteTriviaAvailabilityLabel(state: RemoteTriviaAvailability) {
  switch (state.status) {
    case "loading":
      return "Trivia: controleren...";
    case "available":
      return "Trivia: beschikbaar";
    case "unavailable":
      return "Trivia: niet beschikbaar";
    case "error":
      return "Trivia: fout bij check";
    case "idle":
    default:
      return "Trivia: onbekend";
  }
}

export function RemoteControlPage({
  layout,
  display,
  presence,
  media,
  isConnected,
  connectionStatus,
  connectionError,
  settings,
  apiBaseUrl,
  onUpdateSettings,
  onFocusWidget,
  onClearFocus,
  onSetMediaLyricsVisible,
  onSetMediaJellyfinTriviaVisible,
  onSetSpotifyContextKeepAwake,
  onResetIdleTimer,
}: RemoteControlPageProps) {
  const [now, setNow] = useState(0);

  const [remoteTriviaAvailability, setRemoteTriviaAvailability] =
    useState<RemoteTriviaAvailability>({ status: "idle", available: false });

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

  const activeFocusLabel = getFocusLabel(display.focusedWidgetId);

  const mirrorStateTitle =
    display.mode === "sleep"
      ? "Mirror staat in sleep mode"
      : display.focusedWidgetId
        ? `${activeFocusLabel} staat in focus`
        : "Normale mirror weergave";

  const mirrorStateSubtitle =
    display.keepAwakeReason ??
    (display.mode === "sleep"
      ? "Geen actieve wake reason."
      : "Geen speciale wake reason actief.");

  const canToggleLyrics =
    display.focusedWidgetId === "media" &&
    media.kind === "track" &&
    (media.status === "playing" || media.status === "paused");

  const canToggleJellyfinTrivia =
    display.focusedWidgetId === "media" &&
    media.source === "jellyfin" &&
    (media.kind === "movie" || media.kind === "episode") &&
    (media.status === "playing" || media.status === "paused");

  const remoteTriviaLookupKey = getRemoteTriviaLookupKey(media);

  const canToggleSpotifyContext =
    media.source === "spotify" &&
    media.kind === "track" &&
    (media.status === "playing" || media.status === "paused");

  useEffect(() => {
    if (!canToggleJellyfinTrivia) {
      setRemoteTriviaAvailability({ status: "idle", available: false });
      return;
    }

    let isActive = true;

    setRemoteTriviaAvailability({ status: "loading", available: false });

    fetch(`${apiBaseUrl}/media/jellyfin-trivia`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: unknown;
          items?: unknown;
        };

        if (!response.ok || payload.ok !== true) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (!isActive) {
          return;
        }

        setRemoteTriviaAvailability(
          Array.isArray(payload.items) && payload.items.length > 0
            ? { status: "available", available: true }
            : { status: "unavailable", available: false },
        );
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setRemoteTriviaAvailability({ status: "error", available: false });
      });

    return () => {
      isActive = false;
    };
  }, [apiBaseUrl, canToggleJellyfinTrivia, remoteTriviaLookupKey]);

  return (
    <main className="remote-page">
      <div className="remote-header">
        <h1 className="remote-title">Smart Mirror Remote</h1>

        <div className="remote-links">
          <Link to="/" className="remote-link">
            Mirror
          </Link>
          <Link to="/admin" className="remote-link">
            Admin
          </Link>
        </div>
      </div>

      <p className="remote-status">
        Status: <strong>{getConnectionStatusLabel(connectionStatus)}</strong>
      </p>

      {connectionError ? (
        <p className="remote-status remote-status--error">
          {connectionError}
        </p>
      ) : null}

      <section className="remote-hero-card">
        <div>
          <p className="remote-eyebrow">Huidige status</p>
          <h2>{mirrorStateTitle}</h2>
          <p>{mirrorStateSubtitle}</p>
        </div>

        <div className="remote-status-pills">
          <span className="remote-status-pill">
            Display: {getDisplayModeLabel(display.mode)}
          </span>
          <span className="remote-status-pill">
            Presence: {getPresenceLabel(presence.mode)}
          </span>
          <span className="remote-status-pill">
            Focus bron: {getFocusSourceLabel(display.focusSource)}
          </span>
          <span className="remote-status-pill">
            Timeout: {focusSecondsLeft ?? "-"}s
          </span>
        </div>
      </section>

      <section className="remote-section">
        <div className="remote-section-heading">
          <div>
            <p className="remote-eyebrow">Focus</p>
            <h2>Open snel een mirror-widget</h2>
          </div>
        </div>

        <div className="remote-focus-grid">
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
        </div>
      </section>

      <section className="remote-section">
        <div className="remote-section-heading">
          <div>
            <p className="remote-eyebrow">Bediening</p>
            <h2>Mirror acties</h2>
          </div>
        </div>

        <div className="remote-action-grid">
          <button
            type="button"
            className="remote-action-button"
            onClick={onClearFocus}
            disabled={!isConnected || display.focusedWidgetId === null}
          >
            Reset naar normale weergave
          </button>

          <button
            type="button"
            className="remote-action-button"
            onClick={onResetIdleTimer}
            disabled={!isConnected}
          >
            Houd mirror wakker
          </button>

          <div className="remote-range-card">
            <CommitRange
              label="Media sessie timeout"
              value={settings.mediaFocusExitDelaySeconds}
              min={5}
              max={180}
              step={5}
              suffix="s"
              disabled={!isConnected}
              onCommit={(mediaFocusExitDelaySeconds) => {
                onUpdateSettings({ mediaFocusExitDelaySeconds });
              }}
            />
          </div>
        </div>
      </section>

      <section className="remote-section">
        <div className="remote-section-heading">
          <div>
            <p className="remote-eyebrow">Media</p>
            <h2>{remoteMediaTitle || "Geen actieve media"}</h2>
          </div>
          <span className="remote-status-pill">{media.status}</span>
        </div>

        <div className="remote-action-grid">
          <button
            type="button"
            className="remote-action-button"
            onClick={() => {
              onSetMediaLyricsVisible(!display.mediaLyricsVisible);
            }}
            disabled={!isConnected || !canToggleLyrics}
          >
            Lyrics {display.mediaLyricsVisible ? "uitzetten" : "aanzetten"}
          </button>

          <button
            type="button"
            className="remote-action-button remote-action-button--stacked"
            onClick={() => {
              onSetMediaJellyfinTriviaVisible(
                !display.mediaJellyfinTriviaVisible,
              );
            }}
            disabled={
              !isConnected ||
              !canToggleJellyfinTrivia ||
              (!display.mediaJellyfinTriviaVisible &&
                !remoteTriviaAvailability.available)
            }
          >
            <span>
              Jellyfin Trivia{" "}
              {display.mediaJellyfinTriviaVisible ? "uitzetten" : "aanzetten"}
            </span>
            <small className="remote-action-button__hint">
              {getRemoteTriviaAvailabilityLabel(
                remoteTriviaAvailability,
              ).replace("Trivia: ", "")}
            </small>
          </button>

          <button
            type="button"
            className="remote-action-button"
            onClick={() => {
              onSetSpotifyContextKeepAwake(!display.spotifyContextKeepAwake);
            }}
            disabled={!isConnected || !canToggleSpotifyContext}
          >
            Spotify context{" "}
            {display.spotifyContextKeepAwake ? "uitzetten" : "aanhouden"}
          </button>
        </div>
      </section>
    </main>
  );
}
