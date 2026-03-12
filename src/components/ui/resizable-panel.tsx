/**
 * ResizablePanel
 *
 * A panel with a draggable edge for resizing.
 * Persists width to disk following ~/.mort/ conventions.
 *
 * Usage:
 * <ResizablePanel
 *   position="left"
 *   minWidth={200}
 *   maxWidth={400}
 *   defaultWidth={280}
 *   persistKey="tree-panel-width"
 *   onClose={handleClose}
 * >
 *   <TreeMenu />
 * </ResizablePanel>
 *
 * Features:
 * - Horizontal resizing (width)
 * - Min/max width constraints
 * - Drag handle with visual indicator
 * - Persist width via layoutService (backed by ~/.mort/ui/layout.json)
 * - Snap-to-close behavior when dragged below threshold
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useLayoutStore } from "@/stores/layout/store";
import { layoutService } from "@/stores/layout/service";

export interface ResizablePanelProps {
  /** Which side the resize handle appears on */
  position: "left" | "right";
  /** Minimum width in pixels */
  minWidth: number;
  /** Maximum width in pixels (optional - no limit if not set) */
  maxWidth?: number;
  /** Default width if no persisted value (can be number or "1/3" for window fraction) */
  defaultWidth: number | "1/3";
  /** Key for persisting width (stored in ~/.mort/ui/layout.json) */
  persistKey: string;
  /** Threshold below which panel snaps closed */
  closeThreshold?: number;
  /** Called when panel is closed via snap */
  onClose?: () => void;
  /** Panel content */
  children: ReactNode;
  /** Optional className for the container */
  className?: string;
}

function getInitialWidth(defaultWidth: number | "1/3", minWidth: number): number {
  if (defaultWidth === "1/3") {
    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
    return Math.max(minWidth, Math.floor(windowWidth / 3));
  }
  return defaultWidth;
}

function getMaxWidth(): number {
  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  return Math.floor(windowWidth * 0.8);
}

export function ResizablePanel({
  position,
  minWidth,
  maxWidth,
  defaultWidth,
  persistKey,
  closeThreshold = 100,
  onClose,
  children,
  className,
}: ResizablePanelProps) {
  // Read from already-hydrated store — no flash
  const persistedWidth = useLayoutStore((s) => s.panelWidths[persistKey]);
  const [width, setWidth] = useState(() =>
    persistedWidth ?? getInitialWidth(defaultWidth, minWidth)
  );
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!panelRef.current) return;

      // Calculate new width based on drag delta
      const deltaX = e.clientX - dragStartX.current;
      let newWidth: number;

      if (position === "left") {
        // Handle on right side - moving right increases width
        newWidth = dragStartWidth.current + deltaX;
      } else {
        // Handle on left side - moving left increases width
        newWidth = dragStartWidth.current - deltaX;
      }

      // Snap to close
      if (newWidth < closeThreshold) {
        onClose?.();
        return;
      }

      // Clamp to min and max (use 80% of window if no explicit max)
      const effectiveMax = maxWidth ?? getMaxWidth();
      newWidth = Math.max(minWidth, Math.min(effectiveMax, newWidth));
      setWidth(newWidth);
    },
    [position, minWidth, maxWidth, closeThreshold, onClose]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    layoutService.setPanelWidth(persistKey, width);
  }, [width, persistKey]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
      setIsDragging(true);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  // Global mouse listeners for drag
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
      style={{ width }}
    >
      {children}

      {/* Drag handle - larger hit area for easier dragging */}
      <div
        data-testid="resize-handle-horizontal"
        className={`
          absolute top-0 bottom-0 w-3 cursor-ew-resize z-10
          ${position === "left" ? "-right-1.5" : "-left-1.5"}
        `}
        onMouseDown={handleDragStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize"
      >
        {/* Visual indicator - thin line at panel edge */}
        <div
          className={`
            absolute top-0 bottom-0 w-px
            ${position === "left" ? "right-1.5" : "left-1.5"}
            transition-colors bg-surface-700
            ${isDragging ? "bg-accent-500/50" : "hover:bg-accent-500/30"}
          `}
        />
      </div>
    </div>
  );
}
