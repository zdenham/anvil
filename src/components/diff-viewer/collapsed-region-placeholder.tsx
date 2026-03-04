import { ChevronRight } from "lucide-react";
import type { CollapsedRegion } from "./types";

interface CollapsedRegionPlaceholderProps {
  /** The collapsed region data */
  region: CollapsedRegion;
  /** Unique ID for this region (used for ARIA) */
  regionId: string;
  /** Whether the region is currently expanded */
  isExpanded: boolean;
  /** Callback when toggle is clicked */
  onToggle: () => void;
}

/**
 * Placeholder component for collapsed regions.
 * Shows the number of hidden lines and expands on click.
 *
 * Accessibility features:
 * - Button role with aria-expanded
 * - aria-controls linking to expandable content
 * - Clear label describing the action
 */
function regionLabel(region: CollapsedRegion): string {
  const plural = region.lineCount !== 1 ? "s" : "";
  switch (region.kind) {
    case "deleted":
      return `${region.lineCount} deleted line${plural}`;
    case "added":
      return `${region.lineCount} added line${plural}`;
    default:
      return `${region.lineCount} unchanged line${plural}`;
  }
}

export function CollapsedRegionPlaceholder({
  region,
  regionId,
  isExpanded,
  onToggle,
}: CollapsedRegionPlaceholderProps) {
  const label = regionLabel(region);
  const action = isExpanded ? "collapse" : "expand";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="
        w-full py-1.5 px-4
        flex items-center justify-center gap-2
        text-xs text-surface-400
        bg-surface-800/30
        border-y border-dashed border-surface-700
        hover:bg-surface-800/50 hover:text-surface-300
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset
        group
      "
      aria-expanded={isExpanded}
      aria-controls={regionId}
      aria-label={`${label}, click to ${action}`}
    >
      <ChevronRight
        className={`
          w-4 h-4 transition-transform duration-150
          ${isExpanded ? "rotate-90" : ""}
          group-hover:text-surface-300
        `}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}

/**
 * CSS for smooth expand/collapse animations using CSS Grid.
 * Import this in your global styles or use as a reference.
 */
export const collapsibleAnimationStyles = `
/* Expand/collapse animation using grid */
.collapsible-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 150ms ease-out;
}

.collapsible-wrapper[data-expanded="true"] {
  grid-template-rows: 1fr;
}

.collapsible-content {
  overflow: hidden;
}
`;

interface CollapsibleContentProps {
  /** Whether the content is expanded */
  isExpanded: boolean;
  /** Content to show when expanded */
  children: React.ReactNode;
  /** ID for ARIA linking */
  id: string;
}

/**
 * Wrapper for collapsible content with smooth CSS Grid animation.
 */
export function CollapsibleContent({
  isExpanded,
  children,
  id,
}: CollapsibleContentProps) {
  return (
    <div
      id={id}
      className="grid transition-[grid-template-rows] duration-150 ease-out"
      style={{
        gridTemplateRows: isExpanded ? "1fr" : "0fr",
      }}
      aria-hidden={!isExpanded}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
