import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { SortableLayoutItem } from "./SortableLayoutItem";
import {
  widgetEdgePositionOptions,
  type LayoutItem,
  type WidgetEdgePosition,
  type WidgetId,
} from "../../types/layout";

type LayoutControlsProps = {
  layout: LayoutItem[];
  onToggleWidget: (widgetId: WidgetId) => void;
  onReorderWidgets: (orderedIds: WidgetId[]) => void;
  onUpdateWidgetPosition: (
    widgetId: WidgetId,
    position: WidgetEdgePosition,
  ) => void;
  renderInAccordion?: boolean;
};

export function LayoutControls({
  layout,
  onToggleWidget,
  onReorderWidgets,
  onUpdateWidgetPosition,
  renderInAccordion = false,
}: LayoutControlsProps) {
  const orderedItems = layout;

  const content = (
    <>
      {!renderInAccordion ? (
        <h2 className="admin-card-title">Widgets</h2>
      ) : null}

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

                {item.id !== "clock" ? (
                  <label className="admin-toggle">
                    <span>Positie</span>
                    <select
                      value={item.position}
                      onChange={(event) => {
                        onUpdateWidgetPosition(
                          item.id,
                          event.target.value as WidgetEdgePosition,
                        );
                      }}
                    >
                      {widgetEdgePositionOptions.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="admin-row-hint">
                    Klok blijft vast midden-boven in normal state.
                  </span>
                )}
              </div>
            </div>
          </SortableLayoutItem>
        ))}
      </div>
    </>
  );

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) {
          return;
        }

        const { source } = event.operation;

        if (!isSortable(source)) {
          return;
        }

        const { initialIndex, index } = source;

        if (initialIndex === index) {
          return;
        }

        const nextIds = layout.map((item) => item.id);
        const [movedItem] = nextIds.splice(initialIndex, 1);
        nextIds.splice(index, 0, movedItem);

        onReorderWidgets(nextIds);
      }}
    >
      {renderInAccordion ? (
        content
      ) : (
        <section className="admin-card">{content}</section>
      )}
    </DragDropProvider>
  );
}
