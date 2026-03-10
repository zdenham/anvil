import type { ActiveDragState } from "./use-tree-dnd";

interface TreeDndOverlayProps {
  activeDrag: ActiveDragState;
}

/**
 * Semi-transparent preview of the dragged item, rendered inside <DragOverlay>.
 */
export function TreeDndOverlay({ activeDrag }: TreeDndOverlayProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface-800 border border-surface-600 rounded text-[13px] text-surface-200 opacity-80 shadow-lg pointer-events-none max-w-[240px]">
      <span className="truncate">{activeDrag.item.title}</span>
    </div>
  );
}
