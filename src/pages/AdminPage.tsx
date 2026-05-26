import { useEffect, useRef } from "react";
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

type CommitRangeProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
};

function CommitRange({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  disabled = false,
  onCommit,
}: CommitRangeProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelValueRef = useRef<HTMLSpanElement | null>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;

    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = String(value);
    }

    if (labelValueRef.current) {
      labelValueRef.current.textContent = `${value}${suffix}`;
    }
  }, [value, suffix]);

  function updateLabel(nextValue: number) {
    if (labelValueRef.current) {
      labelValueRef.current.textContent = `${nextValue}${suffix}`;
    }
  }

  function commitValue() {
    const nextValue = Number(inputRef.current?.value ?? value);

    updateLabel(nextValue);

    if (nextValue !== latestValueRef.current) {
      onCommit(nextValue);
    }
  }

  return (
    <label style={{ display: "block" }}>
      {label} (
      <span ref={labelValueRef}>
        {value}
        {suffix}
      </span>
      )
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onInput={(event) => {
          updateLabel(Number(event.currentTarget.value));
        }}
        onPointerUp={commitValue}
        onTouchEnd={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
        disabled={disabled}
        style={{
          display: "block",
          marginTop: "0.5rem",
          width: "100%",
        }}
      />
    </label>
  );
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
          title="Mirror instellingen"
          subtitle="Klok en sleep gedrag"
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
          title="Display settings"
          subtitle="Rotatie, zoom, padding en spacing"
          defaultOpen
        >
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
                step={5}
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
          title="Presence debug"
          subtitle="Live presence en display state"
        >
          <p>Presence mode: {presence.mode}</p>
          <p>Display mode: {display.mode}</p>
          <p>
            Waarom blijft display aan:{" "}
            {display.keepAwakeReason ?? "geen actieve reden"}
          </p>
          <p>Laatste display trigger: {display.reason}</p>
          <p>
            Laatste beweging:{" "}
            {presence.lastMotionAt
              ? new Date(presence.lastMotionAt).toLocaleTimeString("nl-NL")
              : "nog geen beweging"}
          </p>
          <hr style={{ borderColor: "rgba(255,255,255,0.12)" }} />

          <p>Light status: {light.status}</p>
          <p>Lux: {light.lux ?? "geen meting"}</p>
          <p>Raw: {light.raw ?? "geen meting"}</p>
          <p>Light mode: {light.mode}</p>
          <p>Room light on: {light.roomLightOn ? "ja" : "nee"}</p>
          <p>Light off threshold: {settings.lightOffLuxThreshold} lux</p>
          <p>Light on threshold: {settings.lightOnLuxThreshold} lux</p>
          <p>
            Light updated:{" "}
            {light.updatedAt
              ? new Date(light.updatedAt).toLocaleTimeString("nl-NL")
              : "nog niet"}
          </p>
          {light.error ? <p>Light error: {light.error}</p> : null}

          <button
            type="button"
            onClick={onSimulateMotion}
            disabled={!isConnected}
          >
            Simuleer beweging
          </button>
        </AccordionSection>

        <AccordionSection
          title="Light sensor settings"
          subtitle="Lux thresholds voor kamerlicht detectie"
        >
          <label style={{ display: "block", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={settings.lightSensorEnabled}
              onChange={(event) =>
                onUpdateSettings({ lightSensorEnabled: event.target.checked })
              }
            />{" "}
            Light sensor enabled
          </label>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            Light off threshold lux
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
          </label>

          <label style={{ display: "block" }}>
            Light on threshold lux
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
          </label>
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
