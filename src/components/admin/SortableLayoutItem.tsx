import { useSortable } from "@dnd-kit/react/sortable";
import type { ReactNode } from "react";
import type { WidgetId } from "../../types/layout";

type SortableLayoutItemProps = {
  id: WidgetId;
  index: number;
  children: ReactNode;
};

export function SortableLayoutItem({
  id,
  index,
  children,
}: SortableLayoutItemProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
  });

  return (
    <div
      ref={ref}
      className={`sortable-item ${isDragging ? "sortable-item--dragging" : ""}`}
    >
      <button
        ref={handleRef}
        type="button"
        className="drag-handle"
        aria-label={`Verplaats ${id}`}
      >
        ⋮⋮
      </button>

      <div className="sortable-item-content">{children}</div>
    </div>
  );
}