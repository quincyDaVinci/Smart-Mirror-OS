import type { LayoutItem, WidgetId } from "../../types/layout";

type LayoutControlsProps = {
  layout: LayoutItem[];
  onToggleWidget: (widgetId: WidgetId) => void;
};

export function LayoutControls({
  layout,
  onToggleWidget,
}: LayoutControlsProps) {
  return (
    <section className="admin-card">
      <h2 className="admin-card-title">Widgets</h2>

      <div className="admin-list">
        {layout.map((item) => (
          <label key={item.id} className="admin-row">
            <span className="admin-row-label">{item.id}</span>

            <input
              type="checkbox"
              checked={item.enabled}
              onChange={() => onToggleWidget(item.id)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}