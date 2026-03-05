/**
 * DropZoneOverlay — visual overlay for split drop targets during tab drag.
 *
 * Purely visual component. Edge zone detection is handled by useTabDnd
 * via onDragMove (since dnd-kit captures pointer events during drag).
 * This component reads the activeEdgeZone from the DndBridge context
 * and renders the appropriate highlight indicator.
 */

import { cn } from "@/lib/utils";
import type { ActiveEdgeZone } from "./use-tab-dnd";

/** Which edge zone the cursor is hovering over. */
export type EdgeZone = "top" | "bottom" | "left" | "right" | null;

interface DropZoneOverlayProps {
  groupId: string;
  activeEdgeZone: ActiveEdgeZone | null;
}

export function DropZoneOverlay({ groupId, activeEdgeZone }: DropZoneOverlayProps) {
  // Only show indicators for this group
  const isTarget = activeEdgeZone?.groupId === groupId;
  const activeZone = isTarget ? activeEdgeZone.zone : null;

  if (!activeZone) return null;

  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none"
      data-testid={`drop-zone-overlay-${groupId}`}
    >
      <ZoneIndicator zone={activeZone} />
    </div>
  );
}

interface ZoneIndicatorProps {
  zone: "top" | "bottom" | "left" | "right";
}

/** Visual indicator for the active edge zone. */
function ZoneIndicator({ zone }: ZoneIndicatorProps) {
  const positionClasses: Record<string, string> = {
    top: "top-0 left-0 right-0 h-[30%]",
    bottom: "bottom-0 left-0 right-0 h-[30%]",
    left: "top-0 left-0 bottom-0 w-[30%]",
    right: "top-0 right-0 bottom-0 w-[30%]",
  };

  return (
    <div
      data-testid={`drop-zone-${zone}`}
      className={cn(
        "absolute transition-colors duration-150",
        positionClasses[zone],
        "bg-accent-500/20 border-accent-500/40",
        (zone === "top" || zone === "bottom") && "border-b-2",
        (zone === "left" || zone === "right") && "border-r-2",
      )}
    />
  );
}
