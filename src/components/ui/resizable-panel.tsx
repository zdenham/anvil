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
 * - Persist width to ~/.mort/ui/layout.json with Zod validation
 * - Snap-to-close behavior when dragged below threshold
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { z } from "zod";
import { persistence } from "@/lib/persistence";

/**
 * Schema for ~/.mort/ui/layout.json
 * Per Zod at Boundaries pattern - validate all disk reads.
 */
export const LayoutStateSchema = z.object({
  panelWidths: z.record(z.string(), z.number()),
});

export type LayoutState = z.infer<typeof LayoutStateSchema>;

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

const LAYOUT_PATH = "ui/layout.json";

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
  const [width, setWidth] = useState(() => getInitialWidth(defaultWidth, minWidth));
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  // Load persisted width on mount with Zod validation
  useEffect(() => {
    async function loadWidth() {
      try {
        const raw = await persistence.readJson(LAYOUT_PATH);
        const result = LayoutStateSchema.safeParse(raw);
        if (result.success && result.data.panelWidths[persistKey]) {
          setWidth(result.data.panelWidths[persistKey]);
        }
        // If validation fails, use defaultWidth (already set in useState)
      } catch {
        // Silently use default on error
      }
    }
    loadWidth();
  }, [persistKey, defaultWidth]);

  // Persist width changes (debounced via drag end)
  const persistWidth = useCallback(
    async (newWidth: number) => {
      try {
        const raw = await persistence.readJson(LAYOUT_PATH);
        const result = LayoutStateSchema.safeParse(raw);
        const layout: LayoutState = result.success
          ? result.data
          : { panelWidths: {} };
        layout.panelWidths[persistKey] = newWidth;
        await persistence.writeJson(LAYOUT_PATH, layout);
      } catch {
        // Silently fail on persist error
      }
    },
    [persistKey]
  );

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
    persistWidth(width);
  }, [width, persistWidth]);

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
        className={`
          absolute top-0 bottom-0 w-3 cursor-ew-resize z-10
          ${position === "left" ? "-right-1" : "-left-1"}
        `}
        onMouseDown={handleDragStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize"
      >
        {/* Visual indicator - thin line centered in the hit area */}
        <div
          className={`
            absolute top-0 bottom-0 w-[2px] left-1/2 -translate-x-1/2
            transition-colors
            ${isDragging ? "bg-accent-500/50" : "hover:bg-accent-500/30"}
          `}
        />
        {/* Hover pill indicator */}
        <div
          className={`
            absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            w-1 h-8 rounded-full bg-surface-500 opacity-0 hover:opacity-100 transition-opacity
          `}
        />
      </div>
    </div>
  );
}
