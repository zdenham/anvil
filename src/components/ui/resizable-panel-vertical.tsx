/**
 * ResizablePanelVertical
 *
 * A panel with a draggable top edge for vertical resizing.
 * Same pattern as ResizablePanel but for height instead of width.
 *
 * Usage:
 * <ResizablePanelVertical
 *   minHeight={150}
 *   maxHeight={600}
 *   height={300}
 *   onHeightChange={setHeight}
 *   onClose={handleClose}
 * >
 *   <DebugPanel />
 * </ResizablePanelVertical>
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface ResizablePanelVerticalProps {
  /** Current height in pixels */
  height: number;
  /** Callback when height changes (during drag) */
  onHeightChange: (height: number) => void;
  /** Callback when drag ends (for persistence) */
  onDragEnd?: (height: number) => void;
  /** Minimum height in pixels */
  minHeight: number;
  /** Maximum height in pixels */
  maxHeight?: number;
  /** Threshold below which panel snaps closed */
  closeThreshold?: number;
  /** Called when panel is closed via snap */
  onClose?: () => void;
  /** Panel content */
  children: ReactNode;
  /** Optional className for the container */
  className?: string;
  /** When true, height is controlled by flex layout instead of inline style */
  fillContainer?: boolean;
}

function getMaxHeight(): number {
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  return Math.floor(windowHeight * 0.7);
}

export function ResizablePanelVertical({
  height,
  onHeightChange,
  onDragEnd,
  minHeight,
  maxHeight,
  closeThreshold = 100,
  onClose,
  children,
  className,
  fillContainer,
}: ResizablePanelVerticalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      // Dragging upward increases height (clientY decreases)
      const deltaY = dragStartY.current - e.clientY;
      let newHeight = dragStartHeight.current + deltaY;

      if (newHeight < closeThreshold) {
        onClose?.();
        return;
      }

      const effectiveMax = maxHeight ?? getMaxHeight();
      newHeight = Math.max(minHeight, Math.min(effectiveMax, newHeight));
      onHeightChange(newHeight);
    },
    [minHeight, maxHeight, closeThreshold, onClose, onHeightChange]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onDragEnd?.(height);
  }, [height, onDragEnd]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartHeight.current = panelRef.current?.offsetHeight ?? height;
      setIsDragging(true);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => handleDrag(e);
    const handleMouseUp = () => handleDragEnd();

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleDrag, handleDragEnd]);

  return (
    <div
      ref={panelRef}
      className={`relative flex-shrink-0 ${className ?? ""}`}
      style={fillContainer ? undefined : { height }}
    >
      {/* Drag handle - top edge */}
      <div
        data-testid="resize-handle-vertical"
        className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize z-10 -translate-y-1/2"
        onMouseDown={handleDragStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize"
      >
        {/* Visual indicator - thin line */}
        <div
          className={`
            absolute left-0 right-0 h-px top-1/2 -translate-y-1/2
            transition-colors
            ${isDragging ? "bg-accent-500/50" : "bg-surface-700 hover:bg-accent-500/30"}
          `}
        />
      </div>

      {children}
    </div>
  );
}
