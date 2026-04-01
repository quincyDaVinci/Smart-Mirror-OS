import { Link } from "react-router-dom";
import { LayoutControls } from "../components/admin/LayoutControls";
import type { LayoutItem, WidgetId } from "../types/layout";

type AdminPageProps = {
  layout: LayoutItem[];
  onToggleWidget: (widgetId: WidgetId) => void;
  onReorderWidgets: (orderedIds: WidgetId[]) => void;
  isConnected: boolean;
};

export function AdminPage({
  layout,
  onToggleWidget,
  onMoveUp,
  onMoveDown,
  isConnected,
}: AdminPageProps) {
  return (
    <main className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Smart Mirror Admin</h1>
        <p>{isConnected ? "Live verbonden" : "Niet verbonden"}</p>
        <Link to="/" className="admin-link">
          Ga naar mirror
        </Link>
      </div>

      <LayoutControls
  layout={layout}
  onToggleWidget={onToggleWidget}
  onReorderWidgets={onReorderWidgets}
/>
    </main>
  );
}