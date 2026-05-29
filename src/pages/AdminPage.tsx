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
};

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

export function AdminPage({
  layout,
  settings,
  presence,
  light,
  display,
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
