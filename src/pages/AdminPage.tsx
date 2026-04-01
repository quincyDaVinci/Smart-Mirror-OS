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
  onReorderWidgets,
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
    </main>
  );
}