/**
 * TabDragPreview — minimal tab preview shown inside DragOverlay during drag.
 *
 * Renders a semi-transparent tab label. Uses the useTabLabel hook for
 * consistent naming with the tab bar.
 */

import { useTabLabel } from "./use-tab-label";
import type { ActiveDragState } from "./use-tab-dnd";

interface TabDragPreviewProps {
  activeDrag: ActiveDragState;
}

export function TabDragPreview({ activeDrag }: TabDragPreviewProps) {
  const label = useTabLabel(activeDrag.view);

  return (
    <div
      data-testid="tab-drag-preview"
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-surface-800 text-surface-200 rounded-md shadow-lg max-w-[200px] backdrop-blur-sm"
    >
      <span className="truncate">{label}</span>
    </div>
  );
}
