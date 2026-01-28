import { useCallback, useEffect, useRef } from "react";

interface DragHandleProps {
  position: "top" | "bottom";
  onHeightChange: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  minHeight?: number;
  maxHeight?: number;
}

/**
 * Draggable handle for resizing panels.
 * Positioned at top or bottom edge.
 */
export function DragHandle({
  position,
  onHeightChange,
  onDragStart,
  onDragEnd,
}: DragHandleProps) {
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    onDragStart?.();
  }, [onDragStart]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const delta = startYRef.current - e.clientY;
      startYRef.current = e.clientY;

      // For top handle, moving up increases height
      // For bottom handle, moving down increases height
      const adjustedDelta = position === "top" ? delta : -delta;
      onHeightChange(adjustedDelta);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onDragEnd?.();
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [position, onHeightChange, onDragEnd]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        absolute left-0 right-0 h-3 cursor-ns-resize z-20
        ${position === "top" ? "-top-1" : "-bottom-1"}
      `}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Drag to resize"
    >
      {/* Visual indicator - thin line centered in the hit area */}
      <div className="absolute left-0 right-0 h-[2px] top-1/2 -translate-y-1/2 hover:bg-surface-500/30 transition-colors" />
      {/* Hover pill indicator */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1 rounded-full bg-surface-600 opacity-0 hover:opacity-100 transition-opacity" />
    </div>
  );
}
