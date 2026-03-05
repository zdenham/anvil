/**
 * SplitResizeHandle
 *
 * Draggable divider between split children.
 * Supports both horizontal (vertical bar) and vertical (horizontal bar) splits.
 *
 * - Drag to resize adjacent children
 * - Double-click to reset all children to equal sizes
 * - Enforces minimum 15% per child
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { paneLayoutService } from "@/stores/pane-layout/service";
import type { SplitResizeHandleProps } from "./types";

/** Minimum percentage each child can occupy. */
const MIN_CHILD_PERCENT = 15;

export function SplitResizeHandle({
  direction,
  path,
  index,
  sizes,
}: SplitResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef(0);
  const dragStartSizes = useRef<number[]>([]);

  const isHorizontal = direction === "horizontal";

  const handleDoubleClick = useCallback(() => {
    const equalSize = 100 / sizes.length;
    const equalSizes = sizes.map(() => equalSize);
    paneLayoutService.updateSplitSizes(path, equalSizes);
  }, [path, sizes]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragStartPos.current = isHorizontal ? e.clientX : e.clientY;
      dragStartSizes.current = [...sizes];
      setIsDragging(true);
      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isHorizontal, sizes],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return;

      const parentEl = containerRef.current.parentElement;
      if (!parentEl) return;

      const parentSize = isHorizontal
        ? parentEl.getBoundingClientRect().width
        : parentEl.getBoundingClientRect().height;

      if (parentSize === 0) return;

      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const deltaPx = currentPos - dragStartPos.current;
      const deltaPercent = (deltaPx / parentSize) * 100;

      const newSizes = [...dragStartSizes.current];
      const leftIdx = index - 1;
      const rightIdx = index;

      let newLeft = newSizes[leftIdx] + deltaPercent;
      let newRight = newSizes[rightIdx] - deltaPercent;

      // Enforce minimum size constraints
      if (newLeft < MIN_CHILD_PERCENT) {
        newRight += newLeft - MIN_CHILD_PERCENT;
        newLeft = MIN_CHILD_PERCENT;
      }
      if (newRight < MIN_CHILD_PERCENT) {
        newLeft += newRight - MIN_CHILD_PERCENT;
        newRight = MIN_CHILD_PERCENT;
      }

      newSizes[leftIdx] = newLeft;
      newSizes[rightIdx] = newRight;

      // Optimistic update directly to store (no persist until drag end)
      paneLayoutService.updateSplitSizes(path, newSizes);
    },
    [isHorizontal, index, path],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Global mouse listeners during drag
  useEffect(() => {
    if (!isDragging) return;

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      data-testid="split-resize-handle"
      data-direction={direction}
      className={cn(
        "relative flex-shrink-0 z-10",
        isHorizontal
          ? "w-px cursor-col-resize"
          : "h-px cursor-row-resize",
      )}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label="Drag to resize"
    >
      {/* Visual divider line */}
      <div
        className={cn(
          "absolute transition-colors",
          isHorizontal
            ? "top-0 bottom-0 left-1/2 -translate-x-1/2 w-px"
            : "left-0 right-0 top-1/2 -translate-y-1/2 h-px",
          isDragging
            ? "bg-accent-400"
            : "bg-surface-700/50 hover:bg-accent-500",
        )}
      />

      {/* Expanded hit area for easier grabbing */}
      <div
        className={cn(
          "absolute",
          isHorizontal
            ? "top-0 bottom-0 -left-1 -right-1"
            : "left-0 right-0 -top-1 -bottom-1",
        )}
      />
    </div>
  );
}
