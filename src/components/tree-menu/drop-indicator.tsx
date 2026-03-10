import { getTreeIndentPx } from "@/lib/tree-indent";
import type { DropTargetState } from "./use-tree-dnd";

interface DropIndicatorProps {
  dropTarget: DropTargetState;
}

/**
 * Visual drop feedback overlaid on the tree.
 * Positioned absolutely within the scroll container.
 *
 * States:
 * - Valid reorder (above/below): 2px accent horizontal line at the edge
 * - Valid nest (inside): Accent highlight with left accent bar
 * - Invalid drop: No overlay (cursor-not-allowed set on container)
 */
export function DropIndicator({ dropTarget }: DropIndicatorProps) {
  const { item, position, validation } = dropTarget;

  const targetEl = document.querySelector(
    `[data-tree-item-id="${item.id}"]`,
  ) as HTMLElement | null;
  if (!targetEl) return null;

  const containerEl = targetEl.closest("[data-testid='tree-menu']");
  if (!containerEl) return null;

  const rect = targetEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const scrollTop = containerEl.scrollTop;

  // Position relative to scroll container (accounts for scroll offset)
  const top = rect.top - containerRect.top + scrollTop;
  const indent = getTreeIndentPx(item.depth);

  // Invalid drops show no overlay -- cursor-not-allowed is set on the container
  if (!validation.valid) return null;

  if (position === "inside") {
    return (
      <div
        className="absolute pointer-events-none bg-accent-500/20 border border-accent-500/30 border-l-[3px] border-l-accent-400 rounded z-10"
        style={{
          top: `${top}px`,
          left: `${indent}px`,
          width: `calc(100% - ${indent}px)`,
          height: `${rect.height}px`,
        }}
      />
    );
  }

  // Reorder line (above or below)
  const lineTop = position === "above" ? top : top + rect.height;
  return (
    <div
      className="absolute pointer-events-none h-[2px] bg-accent-400 rounded-full z-10"
      style={{
        top: `${lineTop}px`,
        left: `${indent}px`,
        width: `calc(100% - ${indent}px)`,
      }}
    />
  );
}
