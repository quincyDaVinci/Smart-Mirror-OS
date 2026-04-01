import { useEffect, useMemo, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { SortableLayoutItem } from "./SortableLayoutItem";
import type { LayoutItem, WidgetId } from "../../types/layout";

type LayoutControlsProps = {
  layout: LayoutItem[];
  onToggleWidget: (widgetId: WidgetId) => void;
  onReorderWidgets: (orderedIds: WidgetId[]) => void;
};

export function LayoutControls({
  layout,
  onToggleWidget,
  onReorderWidgets,
}: LayoutControlsProps) {
  const [orderedIds, setOrderedIds] = useState<WidgetId[]>(
    layout.map((item) => item.id),
  );

  useEffect(() => {
    setOrderedIds(layout.map((item) => item.id));
  }, [layout]);

  const orderedItems = useMemo(
    () =>
      orderedIds
        .map((id) => layout.find((item) => item.id === id))
        .filter((item): item is LayoutItem => Boolean(item)),
    [orderedIds, layout],
  );

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) {
          return;
        }

        setOrderedIds((currentIds) => {
          const nextIds = move(currentIds, event) as WidgetId[];
          onReorderWidgets(nextIds);
          return nextIds;
        });
      }}
    >
      <section className="admin-card">
        <h2 className="admin-card-title">Widgets</h2>

        <div className="admin-list">
          {orderedItems.map((item, index) => (
            <SortableLayoutItem key={item.id} id={item.id} index={index}>
              <div className="admin-row">
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
              </div>
            </SortableLayoutItem>
          ))}
        </div>
      </section>
    </DragDropProvider>
  );
}