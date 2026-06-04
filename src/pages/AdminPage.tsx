import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutControls } from "../components/admin/LayoutControls";
import type { LayoutItem, WidgetEdgePosition, WidgetId } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";
import type { DeploymentState } from "../types/deployment";
import type { DebugLogEntry } from "../types/log";
import { ProviderSecretsPanel } from "../components/admin/ProviderSecretsPanel";
import type {
  ProviderConfigStatus,
  ProviderSecretsInput,
} from "../types/providerConfig";
import { AccordionSection } from "../components/admin/AccordionSection";
import type { LightSensorState } from "../types/light";
import { CommitRange } from "../components/common/CommitRange";
import type { MediaState } from "../types/media";

type AdminPageProps = {
  layout: LayoutItem[];
  settings: MirrorSettings;
  presence: PresenceState;
  light: LightSensorState;
  display: DisplayState;
  onToggleWidget: (widgetId: WidgetId) => void;
  onReorderWidgets: (orderedIds: WidgetId[]) => void;
  onUpdateWidgetPosition: (
    widgetId: WidgetId,
    position: WidgetEdgePosition,
  ) => void;
  onUpdateSettings: (nextSettings: Partial<MirrorSettings>) => void;
  onSimulateMotion: () => void;
  isConnected: boolean;
  connectionStatus:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  connectionError: string | null;
  deployment: DeploymentState;
  logs: DebugLogEntry[];
  clientLogs: DebugLogEntry[];
  onCheckDeploymentUpdate: () => void;
  onDeployLatestVersion: () => void;
  lastHttpSuccessAt: number | null;
  providerConfigStatus: ProviderConfigStatus;
  onRefreshProviderConfigStatus: () => Promise<void>;
  onSaveProviderSecrets: (nextSecrets: ProviderSecretsInput) => Promise<void>;
  apiBaseUrl: string;
  media: MediaState;
};

type AdminTriviaItem = {
  id: string;
  source: "moviemistakes-trivia" | "moviemistakes-goof";
  sourceUrl?: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
  helpfulVotes: number | null;
  totalVotes: number | null;
  score: number;
  spoilerLevel: "none" | "mild" | "high";
  kind: string;
};

type AdminTriviaResponse = {
  ok: boolean;
  eligible: boolean;
  mediaKey: string | null;
  sessionKey: string | null;
  sourceProvider: "moviemistakes" | null;
  sourceTitleId: string | null;
  sourceUrls: string[];
  errorCode: string | null;
  items: AdminTriviaItem[];
  message: string | null;
};

type AdminTriviaState =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: AdminTriviaResponse | null; error: null }
  | { status: "ready"; data: AdminTriviaResponse; error: null }
  | { status: "error"; data: AdminTriviaResponse | null; error: string };

async function fetchAdminJellyfinTrivia(apiBaseUrl: string) {
  const response = await fetch(`${apiBaseUrl}/media/jellyfin-trivia`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as Partial<AdminTriviaResponse> & {
    error?: unknown;
  };

  if (!response.ok || payload.ok !== true) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`,
    );
  }

  return {
    ok: true,
    eligible: payload.eligible === true,
    mediaKey: typeof payload.mediaKey === "string" ? payload.mediaKey : null,
    sessionKey:
      typeof payload.sessionKey === "string" ? payload.sessionKey : null,
    sourceProvider:
      payload.sourceProvider === "moviemistakes"
        ? payload.sourceProvider
        : null,
    sourceTitleId:
      typeof payload.sourceTitleId === "string" ? payload.sourceTitleId : null,
    sourceUrls: Array.isArray(payload.sourceUrls)
      ? payload.sourceUrls.filter(
          (sourceUrl): sourceUrl is string => typeof sourceUrl === "string",
        )
      : [],
    errorCode: typeof payload.errorCode === "string" ? payload.errorCode : null,
    items: Array.isArray(payload.items)
      ? payload.items.filter(
          (item): item is AdminTriviaItem =>
            item !== null &&
            typeof item === "object" &&
            typeof (item as AdminTriviaItem).id === "string" &&
            typeof (item as AdminTriviaItem).text === "string",
        )
      : [],
    message: typeof payload.message === "string" ? payload.message : null,
  } satisfies AdminTriviaResponse;
}

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

function formatLogTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("nl-NL");
}

function formatOptionalTime(timestamp: number | null) {
  return timestamp
    ? new Date(timestamp).toLocaleTimeString("nl-NL")
    : "nog niet";
}

function formatLux(lux: number | null) {
  return lux === null ? "geen meting" : `${lux.toFixed(1)} lux`;
}

const TRIVIA_TIMED_EARLY_WINDOW_MS = 10000;
const TRIVIA_UNTIMED_EDGE_MARGIN_MS = 3 * 60 * 1000;

type AdminTriviaSlot = {
  itemId: string;
  startMs: number;
};

function getTriviaBudget(
  kind: MediaState["kind"],
  durationMs: number | null,
  strongUntimedItemCount: number,
) {
  if (durationMs === null || durationMs <= 0) {
    return kind === "movie" ? 5 : 1;
  }

  const durationMinutes = durationMs / 60000;

  if (kind === "episode") {
    if (durationMinutes <= 25) {
      return strongUntimedItemCount >= 2 && durationMinutes >= 22 ? 2 : 1;
    }

    if (durationMinutes <= 44) return 2;
    if (durationMinutes <= 64) return 3;
    return 4;
  }

  if (durationMinutes <= 99) return 5;
  if (durationMinutes <= 129) return 6;
  if (durationMinutes <= 159) return 7;
  return 8;
}

function getDeterministicJitterMs(value: string, maxJitterMs: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return Math.round((hash / 0xffffffff - 0.5) * maxJitterMs * 2);
}

function getUntimedTriviaWindow(durationMs: number | null) {
  if (durationMs === null || durationMs <= TRIVIA_UNTIMED_EDGE_MARGIN_MS * 2) {
    return null;
  }

  const startMs = Math.max(durationMs * 0.1, TRIVIA_UNTIMED_EDGE_MARGIN_MS);
  const endMs = Math.min(
    durationMs * 0.9,
    durationMs - TRIVIA_UNTIMED_EDGE_MARGIN_MS,
  );

  return endMs > startMs ? { startMs, endMs } : null;
}

function buildAdminUntimedTriviaSlots(
  items: AdminTriviaItem[],
  durationMs: number | null,
  kind: MediaState["kind"],
): AdminTriviaSlot[] {
  const window = getUntimedTriviaWindow(durationMs);

  if (!window) {
    return [];
  }

  const untimedItems = items
    .filter((item) => item.startMs === null)
    .sort((a, b) => b.score - a.score);

  const budget = getTriviaBudget(kind, durationMs, untimedItems.length);
  const selectedItems = untimedItems.slice(0, budget);

  if (selectedItems.length === 0) {
    return [];
  }

  const spacing = (window.endMs - window.startMs) / (selectedItems.length + 1);

  return selectedItems.map((item, index) => {
    const baseStartMs = window.startMs + spacing * (index + 1);
    const jitterMs = getDeterministicJitterMs(
      item.id,
      Math.min(45000, spacing * 0.28),
    );
    const startMs = Math.min(
      window.endMs,
      Math.max(window.startMs, Math.round(baseStartMs + jitterMs)),
    );

    return { itemId: item.id, startMs };
  });
}

function getTriviaAdminTimingLabel(
  item: AdminTriviaItem,
  scheduledSlots: AdminTriviaSlot[],
) {
  if (item.startMs !== null) {
    return `Timestamp ${formatTriviaTime(item.startMs)} · popup vanaf ${formatTriviaTime(
      Math.max(0, item.startMs - TRIVIA_TIMED_EARLY_WINDOW_MS),
    )}`;
  }

  const slot = scheduledSlots.find((candidate) => candidate.itemId === item.id);

  if (!slot) {
    return "Geen timestamp · niet ingepland";
  }

  return `Geen timestamp · gepland rond ${formatTriviaTime(slot.startMs)}`;
}

function formatTriviaTime(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) {
    return "Geen timestamp";
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getTriviaSourceLabel(source: AdminTriviaItem["source"]) {
  switch (source) {
    case "moviemistakes-trivia":
      return "MovieMistakes trivia";
    case "moviemistakes-goof":
      return "MovieMistakes mistake";
    default:
      return "MovieMistakes trivia";
  }
}

function getTriviaProviderLabel(
  provider: AdminTriviaResponse["sourceProvider"],
) {
  switch (provider) {
    case "moviemistakes":
      return "MovieMistakes";
    default:
      return "geen bron";
  }
}

function getTriviaTitleUrl(data: AdminTriviaResponse) {
  if (!data.sourceTitleId) {
    return null;
  }

  if (data.sourceProvider === "moviemistakes") {
    return `https://www.moviemistakes.com/${data.sourceTitleId}`;
  }

  return data.sourceUrls[0] ?? null;
}

function formatTriviaSourceUrl(sourceUrl: string) {
  return sourceUrl.replace("https://www.moviemistakes.com", "MovieMistakes");
}

function getAdminTriviaStatusLabel(
  state: AdminTriviaState,
  data: AdminTriviaResponse | null,
) {
  if (state.status === "loading") {
    return "Ophalen...";
  }

  if (state.status === "error") {
    return "Fout";
  }

  if (!data) {
    return "Nog niet opgehaald";
  }

  if (data.errorCode === "moviemistakes-title-not-found") {
    return "Niet gevonden";
  }

  if (data.errorCode) {
    return "Fout";
  }

  return data.eligible ? "Beschikbaar" : "Niet beschikbaar";
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

function getPresenceModeLabel(mode: PresenceState["mode"]) {
  return mode === "active" ? "Actief" : "Idle";
}

function getLightModeLabel(mode: LightSensorState["mode"]) {
  switch (mode) {
    case "dark":
      return "Donker";
    case "context":
      return "Twijfelzone";
    case "bright":
      return "Licht";
    case "unknown":
    default:
      return "Onbekend";
  }
}

function getAdminTriviaMediaRefreshKey(media: MediaState) {
  return [
    media.source,
    media.kind,
    media.status,
    media.sourceItemId ?? "",
    media.playSessionId ?? "",
    media.title,
    media.subtitle,
    media.seriesTitle ?? "",
    media.seasonNumber ?? "",
    media.episodeNumber ?? "",
    media.durationMs ?? "",
  ].join("\n");
}

export function AdminPage({
  layout,
  settings,
  presence,
  light,
  display,
  media,
  onToggleWidget,
  onReorderWidgets,
  onUpdateWidgetPosition,
  onUpdateSettings,
  onSimulateMotion,
  isConnected,
  connectionStatus,
  connectionError,
  deployment,
  logs,
  clientLogs,
  onCheckDeploymentUpdate,
  onDeployLatestVersion,
  lastHttpSuccessAt,
  providerConfigStatus,
  onRefreshProviderConfigStatus,
  onSaveProviderSecrets,
  apiBaseUrl,
}: AdminPageProps) {
  const isExpectedReconnect =
    (deployment.status === "deploying" || deployment.status === "success") &&
    connectionStatus !== "connected";

  const triviaMediaRefreshKey = getAdminTriviaMediaRefreshKey(media);

  const hasRecoveredAfterDeploy =
    deployment.status === "success" && connectionStatus === "connected";

  const deploymentMessage = isExpectedReconnect
    ? "Services herstarten. De pagina verbindt zo opnieuw."
    : hasRecoveredAfterDeploy
      ? "Deploy afgerond. Verbinding hersteld."
      : (deployment.message ?? "Nog geen update-check uitgevoerd.");

  const connectionTone = isConnected
    ? "ok"
    : lastHttpSuccessAt
      ? "warn"
      : "error";

  const lightLuxLabel = formatLux(light.lux);
  const lastMotionLabel = formatOptionalTime(presence.lastMotionAt);
  const lightUpdatedLabel = formatOptionalTime(light.updatedAt);
  const [triviaState, setTriviaState] = useState<AdminTriviaState>({
    status: "idle",
    data: null,
    error: null,
  });

  useEffect(() => {
    let isActive = true;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTriviaState((currentState) => ({
      status: "loading",
      data: currentState.data,
      error: null,
    }));

    fetchAdminJellyfinTrivia(apiBaseUrl)
      .then((data) => {
        if (!isActive) {
          return;
        }

        setTriviaState({ status: "ready", data, error: null });
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setTriviaState((currentState) => ({
          status: "error",
          data: currentState.data,
          error:
            error instanceof Error
              ? error.message
              : "Jellyfin trivia ophalen mislukt.",
        }));
      });

    return () => {
      isActive = false;
    };
  }, [apiBaseUrl, triviaMediaRefreshKey]);

  function refreshJellyfinTrivia() {
    setTriviaState((currentState) => ({
      status: "loading",
      data: currentState.data,
      error: null,
    }));

    void fetchAdminJellyfinTrivia(apiBaseUrl)
      .then((data) => {
        setTriviaState({ status: "ready", data, error: null });
      })
      .catch((error) => {
        setTriviaState((currentState) => ({
          status: "error",
          data: currentState.data,
          error:
            error instanceof Error
              ? error.message
              : "Jellyfin trivia ophalen mislukt.",
        }));
      });
  }

  const triviaData = triviaState.data;
  const triviaItems = triviaData?.items ?? [];
  const triviaTitleUrl = triviaData ? getTriviaTitleUrl(triviaData) : null;
  const adminTriviaSlots = buildAdminUntimedTriviaSlots(
    triviaItems,
    media.durationMs,
    media.kind,
  );

  return (
    <main className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Smart Mirror Admin</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link to="/" className="admin-link">
            Ga naar mirror
          </Link>
          <Link to="/remote" className="admin-link">
            Open remote
          </Link>
        </div>
      </div>

      <p className="admin-status">
        Status: <strong>{getConnectionStatusLabel(connectionStatus)}</strong>
      </p>

      {!isConnected && lastHttpSuccessAt ? (
        <p
          className="admin-status"
          style={{ marginTop: "-8px", color: "#cfcfcf" }}
        >
          Transport: HTTP fallback actief
        </p>
      ) : null}

      {connectionError &&
      !isExpectedReconnect &&
      connectionStatus !== "connected" ? (
        <p
          className="admin-status"
          style={{ color: "#ffb3b3", marginTop: "-8px" }}
        >
          {connectionError}
        </p>
      ) : null}

      {isExpectedReconnect ? (
        <p
          className="admin-status"
          style={{ color: "#cfcfcf", marginTop: "-8px" }}
        >
          Services herstarten. Even wachten...
        </p>
      ) : null}

      <div className="admin-overview-grid" aria-label="Mirror status overzicht">
        <section
          className={`admin-overview-card admin-overview-card--${connectionTone}`}
        >
          <p className="admin-overview-card__label">Verbinding</p>
          <h2 className="admin-overview-card__value">
            {getConnectionStatusLabel(connectionStatus)}
          </h2>
          <p className="admin-overview-card__meta">
            {lastHttpSuccessAt
              ? `Laatste HTTP succes: ${formatOptionalTime(lastHttpSuccessAt)}`
              : "Nog geen HTTP fallback gebruikt"}
          </p>
        </section>

        <section className="admin-overview-card">
          <p className="admin-overview-card__label">Display</p>
          <h2 className="admin-overview-card__value">
            {getDisplayModeLabel(display.mode)}
          </h2>
          <p className="admin-overview-card__meta">
            {display.keepAwakeReason ?? display.reason}
          </p>
        </section>

        <section className="admin-overview-card">
          <p className="admin-overview-card__label">Lichtsensor</p>
          <h2 className="admin-overview-card__value">
            {settings.lightSensorEnabled ? lightLuxLabel : "Uitgeschakeld"}
          </h2>
          <p className="admin-overview-card__meta">
            {getLightModeLabel(light.mode)} · bijgewerkt: {lightUpdatedLabel}
          </p>
        </section>

        <section className="admin-overview-card">
          <p className="admin-overview-card__label">Sleep context</p>
          <h2 className="admin-overview-card__value">
            {getPresenceModeLabel(presence.mode)}
          </h2>
          <p className="admin-overview-card__meta">
            Laatste beweging: {lastMotionLabel}
          </p>
        </section>
      </div>

      <div className="admin-sections">
        <AccordionSection
          title="Widgets"
          subtitle="Widgets aanzetten, uitzetten en herschikken"
          defaultOpen
        >
          <LayoutControls
            layout={layout}
            onToggleWidget={onToggleWidget}
            onReorderWidgets={onReorderWidgets}
            onUpdateWidgetPosition={onUpdateWidgetPosition}
            renderInAccordion
          />
        </AccordionSection>

        <AccordionSection
          title="Gebruik & sleep"
          subtitle="Klok, auto-sleep en focus timing"
          defaultOpen
        >
          <label style={{ display: "block", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={settings.showSeconds}
              onChange={(event) => {
                onUpdateSettings({ showSeconds: event.target.checked });
              }}
            />{" "}
            Toon seconden in klok
          </label>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={settings.autoSleepEnabled}
              onChange={(event) => {
                onUpdateSettings({
                  autoSleepEnabled: event.target.checked,
                });
              }}
            />{" "}
            Auto sleep inschakelen
          </label>

          <label style={{ display: "block" }}>
            Sleep timeout (seconden)
            <input
              type="number"
              min={10}
              step={10}
              value={settings.sleepTimeoutSeconds}
              onChange={(event) => {
                onUpdateSettings({
                  sleepTimeoutSeconds: Number(event.target.value),
                });
              }}
              style={{
                display: "block",
                marginTop: "0.5rem",
                width: "100%",
              }}
            />
          </label>

          <label style={{ display: "block", marginTop: "1rem" }}>
            Focus timeout (seconden)
            <input
              type="number"
              min={10}
              step={5}
              value={settings.focusIdleTimeoutSeconds}
              onChange={(event) => {
                onUpdateSettings({
                  focusIdleTimeoutSeconds: Number(event.target.value),
                });
              }}
              style={{
                display: "block",
                marginTop: "0.5rem",
                width: "100%",
              }}
            />
          </label>

          <label style={{ display: "block", marginTop: "1rem" }}>
            Media focus exit delay (seconden)
            <input
              type="number"
              min={3}
              step={1}
              value={settings.mediaFocusExitDelaySeconds}
              onChange={(event) => {
                onUpdateSettings({
                  mediaFocusExitDelaySeconds: Number(event.target.value),
                });
              }}
              style={{
                display: "block",
                marginTop: "0.5rem",
                width: "100%",
              }}
            />
          </label>
        </AccordionSection>

        <AccordionSection
          title="Display & kalibratie"
          subtitle="Rotatie, zoom, safe-area en spacing"
          defaultOpen
        >
          <div style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              onClick={() => {
                onUpdateSettings({
                  calibrationModeEnabled: !settings.calibrationModeEnabled,
                });
              }}
            >
              {settings.calibrationModeEnabled
                ? "Stop calibration"
                : "Start calibration"}
            </button>

            {settings.calibrationModeEnabled ? (
              <p style={{ marginTop: "0.75rem", color: "#cfcfcf" }}>
                Calibration staat aan op de mirror. Gebruik de padding waardes
                hieronder om de witte binnenrand perfect binnen het frame te
                zetten.
              </p>
            ) : null}
          </div>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            Rotatie
            <select
              value={settings.mirrorMode}
              onChange={(event) => {
                onUpdateSettings({
                  mirrorMode: event.target
                    .value as MirrorSettings["mirrorMode"],
                });
              }}
              style={{
                display: "block",
                marginTop: "0.5rem",
                width: "100%",
              }}
            >
              <option value="normal">Landscape / normaal</option>
              <option value="portrait-left">Portrait linksom</option>
              <option value="portrait-right">Portrait rechtsom</option>
            </select>
          </label>

          <CommitRange
            label="Zoom"
            value={settings.zoomPercent}
            min={50}
            max={150}
            step={5}
            suffix="%"
            onCommit={(zoomPercent) => {
              onUpdateSettings({ zoomPercent });
            }}
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            {(
              [
                {
                  label: "Boven",
                  key: "layoutPaddingTopPx",
                  value: settings.layoutPaddingTopPx,
                },
                {
                  label: "Rechts",
                  key: "layoutPaddingRightPx",
                  value: settings.layoutPaddingRightPx,
                },
                {
                  label: "Onder",
                  key: "layoutPaddingBottomPx",
                  value: settings.layoutPaddingBottomPx,
                },
                {
                  label: "Links",
                  key: "layoutPaddingLeftPx",
                  value: settings.layoutPaddingLeftPx,
                },
              ] as const
            ).map(({ label, key, value }) => (
              <CommitRange
                key={key}
                label={`${label} padding`}
                value={Number(value)}
                min={0}
                max={160}
                step={1}
                suffix="px"
                onCommit={(nextValue) => {
                  onUpdateSettings({
                    [key]: nextValue,
                  } as Partial<MirrorSettings>);
                }}
              />
            ))}
          </div>

          <CommitRange
            label="Widget spacing"
            value={settings.widgetGapPx}
            min={0}
            max={64}
            step={4}
            suffix="px"
            onCommit={(widgetGapPx) => {
              onUpdateSettings({ widgetGapPx });
            }}
          />
        </AccordionSection>

        <AccordionSection
          title="Sensor & sleep instellingen"
          subtitle="VEML thresholds en auto-sleep gedrag"
        >
          <label className="admin-checkbox-row">
            <input
              type="checkbox"
              checked={settings.lightSensorEnabled}
              onChange={(event) =>
                onUpdateSettings({ lightSensorEnabled: event.target.checked })
              }
            />
            <span>
              <strong>Lichtsensor gebruiken</strong>
              <small>Laat de mirror reageren op kamerlicht.</small>
            </span>
          </label>

          <div className="admin-field-grid">
            <label className="admin-field">
              Donker vanaf
              <input
                type="number"
                step="0.1"
                value={settings.lightOffLuxThreshold}
                onChange={(event) =>
                  onUpdateSettings({
                    lightOffLuxThreshold: Number(event.target.value),
                  })
                }
              />
              <small>Onder deze lux-waarde mag de mirror naar sleep.</small>
            </label>

            <label className="admin-field">
              Aan vanaf
              <input
                type="number"
                step="0.1"
                value={settings.lightOnLuxThreshold}
                onChange={(event) =>
                  onUpdateSettings({
                    lightOnLuxThreshold: Number(event.target.value),
                  })
                }
              />
              <small>Boven deze lux-waarde blijft de mirror actief.</small>
            </label>
          </div>

          <p className="admin-muted">
            Tussen {settings.lightOffLuxThreshold} en{" "}
            {settings.lightOnLuxThreshold} lux zit de twijfelzone. Daar gebruikt
            de mirror extra context in plaats van blind aan/uit te schakelen.
          </p>
        </AccordionSection>

        <AccordionSection
          title="Live sensorstatus & test"
          subtitle="Debug gescheiden van de normale instellingen"
        >
          <div className="admin-debug-grid">
            <p>
              Presence mode:{" "}
              <strong>{getPresenceModeLabel(presence.mode)}</strong>
            </p>
            <p>
              Display mode: <strong>{getDisplayModeLabel(display.mode)}</strong>
            </p>
            <p>
              Keep awake:{" "}
              <strong>{display.keepAwakeReason ?? "geen actieve reden"}</strong>
            </p>
            <p>
              Laatste trigger: <strong>{display.reason}</strong>
            </p>
            <p>
              Laatste beweging: <strong>{lastMotionLabel}</strong>
            </p>
            <p>
              Light status: <strong>{light.status}</strong>
            </p>
            <p>
              Lux: <strong>{lightLuxLabel}</strong>
            </p>
            <p>
              Raw: <strong>{light.raw ?? "geen meting"}</strong>
            </p>
            <p>
              Light mode: <strong>{getLightModeLabel(light.mode)}</strong>
            </p>
            <p>
              Room light: <strong>{light.roomLightOn ? "aan" : "uit"}</strong>
            </p>
          </div>

          {light.error ? (
            <p className="admin-status admin-status--error">
              Light error: {light.error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onSimulateMotion}
            disabled={!isConnected}
          >
            Simuleer beweging
          </button>
        </AccordionSection>

        <AccordionSection
          title="Deployment"
          subtitle="Update check en live uitrollen"
        >
          <p>Status: {deployment.status}</p>
          <p>Huidige commit: {deployment.currentCommit ?? "onbekend"}</p>
          <p>
            Huidige commit message:{" "}
            {deployment.currentCommitMessage ?? "onbekend"}
          </p>
          <p>
            Remote commit: {deployment.remoteCommit ?? "nog niet gecontroleerd"}
          </p>
          <p>
            Remote commit message:{" "}
            {deployment.remoteCommitMessage ?? "nog niet gecontroleerd"}
          </p>
          <p>Update beschikbaar: {deployment.hasUpdate ? "ja" : "nee"}</p>
          <p>{deploymentMessage}</p>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onCheckDeploymentUpdate}
              disabled={
                !isConnected ||
                deployment.status === "checking" ||
                deployment.status === "deploying"
              }
            >
              Check for updates
            </button>

            <button
              type="button"
              onClick={onDeployLatestVersion}
              disabled={
                !isConnected ||
                !deployment.hasUpdate ||
                deployment.status === "checking" ||
                deployment.status === "deploying"
              }
            >
              Deploy update
            </button>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Provider secrets"
          subtitle="Jellyfin, Spotify, Weather en Calendar configuratie"
        >
          <ProviderSecretsPanel
            configStatus={providerConfigStatus}
            apiBaseUrl={apiBaseUrl}
            onRefreshStatus={onRefreshProviderConfigStatus}
            onSaveSecrets={onSaveProviderSecrets}
          />
        </AccordionSection>

        <AccordionSection
          title="Jellyfin Trivia"
          subtitle="Laatste opgehaalde MovieMistakes trivia voor de huidige Jellyfin media"
        >
          <div className="admin-trivia-toolbar">
            <div>
              <p className="admin-trivia-status">
                Status:{" "}
                <strong>
                  {getAdminTriviaStatusLabel(triviaState, triviaData)}
                </strong>
              </p>
              <p className="admin-muted">
                Items: {triviaItems.length} Â· Sessie:{" "}
                {triviaData?.sessionKey ?? "geen actieve sessie"}
              </p>
            </div>

            <button
              type="button"
              onClick={refreshJellyfinTrivia}
              disabled={triviaState.status === "loading"}
            >
              Trivia opnieuw ophalen
            </button>
          </div>

          {triviaState.status === "error" ? (
            <p className="admin-status admin-status--error">
              {triviaState.error}
            </p>
          ) : null}

          {triviaData?.errorCode ? (
            <p className="admin-status admin-status--error">
              Foutcode: {triviaData.errorCode}
            </p>
          ) : null}

          {triviaData?.message ? (
            <p className="admin-muted">{triviaData.message}</p>
          ) : null}

          {triviaData?.sourceTitleId ? (
            <p className="admin-muted">
              Bron: {getTriviaProviderLabel(triviaData.sourceProvider)}{" "}
              {triviaTitleUrl ? (
                <a
                  className="admin-trivia-item__link"
                  href={triviaTitleUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {triviaData.sourceTitleId}
                </a>
              ) : (
                triviaData.sourceTitleId
              )}
            </p>
          ) : null}

          {triviaData?.sourceUrls.length ? (
            <div className="admin-trivia-source-list">
              <span>Geprobeerde bronnen:</span>
              {triviaData.sourceUrls.map((sourceUrl) => (
                <a
                  key={sourceUrl}
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {formatTriviaSourceUrl(sourceUrl)}
                </a>
              ))}
            </div>
          ) : null}

          {!triviaData && triviaState.status !== "loading" ? (
            <p className="admin-muted">Trivia is nog niet opgehaald.</p>
          ) : null}

          {triviaData && triviaItems.length === 0 ? (
            <p className="admin-muted">
              Geen trivia gevonden voor de huidige Jellyfin media.
            </p>
          ) : null}

          {triviaItems.length > 0 ? (
            <div className="admin-trivia-list">
              {triviaItems.map((item) => (
                <article className="admin-trivia-item" key={item.id}>
                  <div className="admin-trivia-item__meta">
                    <span>{getTriviaSourceLabel(item.source)}</span>
                    <span>Score {item.score}</span>
                    <span>{item.kind}</span>
                    <span>{getTriviaAdminTimingLabel(item, adminTriviaSlots)}</span>
                    {item.helpfulVotes !== null ? (
                      <span>
                        {item.helpfulVotes}
                        {item.totalVotes !== null
                          ? `/${item.totalVotes}`
                          : ""}{" "}
                        helpful
                      </span>
                    ) : null}
                  </div>

                  <p className="admin-trivia-item__text">{item.text}</p>

                  {item.sourceUrl ? (
                    <a
                      className="admin-trivia-item__link"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open bron
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </AccordionSection>

        <AccordionSection
          title="Server logs"
          subtitle="Backend events en errors"
        >
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {logs.length === 0 ? (
              <p>Nog geen serverlogs.</p>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div>
                    [{formatLogTime(log.timestamp)}] {log.level.toUpperCase()} ·{" "}
                    {log.source}
                  </div>
                  <div>{log.message}</div>
                  {log.meta ? (
                    <div style={{ opacity: 0.7 }}>{log.meta}</div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </AccordionSection>

        <AccordionSection
          title="Browser / socket logs"
          subtitle="Frontend reconnect en fallback gedrag"
        >
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {clientLogs.length === 0 ? (
              <p>Nog geen browserlogs.</p>
            ) : (
              clientLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div>
                    [{formatLogTime(log.timestamp)}] {log.level.toUpperCase()} ·{" "}
                    {log.source}
                  </div>
                  <div>{log.message}</div>
                  {log.meta ? (
                    <div style={{ opacity: 0.7 }}>{log.meta}</div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </AccordionSection>
      </div>
    </main>
  );
}
