import { Link } from "react-router-dom";
import { LayoutControls } from "../components/admin/LayoutControls";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";

type AdminPageProps = {
  layout: LayoutItem[];
  settings: MirrorSettings;
  presence: PresenceState;
  display: DisplayState;
  onToggleWidget: (widgetId: WidgetId) => void;
  onReorderWidgets: (orderedIds: WidgetId[]) => void;
  onUpdateSettings: (nextSettings: Partial<MirrorSettings>) => void;
  onSimulateMotion: () => void;
  isConnected: boolean;
};

export function AdminPage({
  layout,
  settings,
  presence,
  display,
  onToggleWidget,
  onReorderWidgets,
  onUpdateSettings,
  onSimulateMotion,
  isConnected,
}: AdminPageProps) {
  return (
    <main className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Smart Mirror Admin</h1>
        <Link to="/" className="admin-link">
          Ga naar mirror
        </Link>
      </div>

      <p className="admin-status">
        {isConnected ? "Live verbonden" : "Niet verbonden"}
      </p>

      <LayoutControls
        layout={layout}
        onToggleWidget={onToggleWidget}
        onReorderWidgets={onReorderWidgets}
      />
      <section className="admin-card">
  <h2>Mirror instellingen</h2>

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

  <label style={{ display: "block" }}>
    Idle timeout (seconden)
    <input
      type="number"
      min={10}
      step={10}
      value={settings.idleTimeoutSeconds}
      onChange={(event) => {
        onUpdateSettings({
          idleTimeoutSeconds: Number(event.target.value),
        });
      }}
      style={{
        display: "block",
        marginTop: "0.5rem",
        width: "100%",
      }}
    />
  </label>
</section>

<section className="admin-card">
  <h2>Presence debug</h2>

  <p>Presence mode: {presence.mode}</p>
  <p>Display mode: {display.mode}</p>
  <p>Display reason: {display.reason}</p>
  <p>
    Laatste beweging:{" "}
    {presence.lastMotionAt
      ? new Date(presence.lastMotionAt).toLocaleTimeString("nl-NL")
      : "nog geen beweging"}
  </p>

  <button type="button" onClick={onSimulateMotion}>
    Simuleer beweging
  </button>
</section>
    </main>
  );
}