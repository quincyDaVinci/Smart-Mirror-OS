import type { LayoutItem, WidgetId } from "../../types/layout";

type LayoutControlsProps = {
  layout: LayoutItem[];
  onToggleWidget: (widgetId: WidgetId) => void;
  onMoveUp: (widgetId: WidgetId) => void;
  onMoveDown: (widgetId: WidgetId) => void;
};

export function LayoutControls({
  layout,
  onToggleWidget,
  onMoveUp,
  onMoveDown,
}: LayoutControlsProps) {
  return (
    <section className="admin-card">
      <h2 className="admin-card-title">Widgets</h2>

      <div className="admin-list">
        {layout.map((item, index) => {
          const isFirst = index === 0;
          const isLast = index === layout.length - 1;

          return (
            <div key={item.id} className="admin-row">
              <div className="admin-row-left">
                <span className="admin-row-label">{item.id}</span>

                <label className="admin-toggle">
                  <span>Actief</span>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={() => onToggleWidget(item.id)}
                  />
                </label>
              </div>

              <div className="admin-actions">
                <button
                  type="button"
                  onClick={() => onMoveUp(item.id)}
                  disabled={isFirst}
                  className="admin-button"
                >
                  Omhoog
                </button>

                <button
                  type="button"
                  onClick={() => onMoveDown(item.id)}
                  disabled={isLast}
                  className="admin-button"
                >
                  Omlaag
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}