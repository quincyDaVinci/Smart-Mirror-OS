import { Link } from "react-router-dom";
import { LayoutControls } from "../components/debug/LayoutControls";
import type { LayoutItem, WidgetId } from "../types/layout";

type AdminPageProps = {
  layout: LayoutItem[];
  onToggleWidget: (widgetId: WidgetId) => void;
};

export function AdminPage({ layout, onToggleWidget }: AdminPageProps) {
  return (
    <main className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Smart Mirror Admin</h1>
        <Link to="/" className="admin-link">
          Ga naar mirror
        </Link>
      </div>

      <LayoutControls layout={layout} onToggleWidget={onToggleWidget} />
    </main>
  );
}