import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AnnotatedFile, CollapsedRegion } from "./types";
import { buildRenderItems, type RenderItem } from "./use-collapsed-regions";
import { AnnotatedLineRow } from "./annotated-line-row";
import { CollapsedRegionPlaceholder } from "./collapsed-region-placeholder";

interface VirtualizedFileContentProps {
  /** The annotated file to display */
  file: AnnotatedFile;
  /** Regions that can be collapsed */
  regions: CollapsedRegion[];
  /** Set of region indices that are expanded */
  expandedRegions: Set<number>;
  /** Toggle a region's expanded state */
  onToggleRegion: (regionIndex: number) => void;
  /** Check if a region is expanded */
  isExpanded: (regionIndex: number) => boolean;
  /** File ID for generating unique element IDs */
  fileId: string;
  /** Maximum height of the virtualized container */
  maxHeight?: number;
  /** Callback when a line is clicked */
  onLineClick?: (lineNumber: number) => void;
}

/** Line height in pixels */
const LINE_HEIGHT = 24;

/** Number of extra items to render above/below viewport */
const OVERSCAN = 20;

/** Threshold for when to use virtualization */
export const VIRTUALIZATION_THRESHOLD = 1000;

/**
 * Virtualized file content using windowed rendering.
 * Used for large files (>1000 lines) to maintain performance.
 *
 * Uses @tanstack/react-virtual for efficient rendering of only visible lines.
 */
export function VirtualizedFileContent({
  file,
  regions,
  expandedRegions,
  onToggleRegion,
  isExpanded,
  fileId,
  maxHeight = 600,
  onLineClick,
}: VirtualizedFileContentProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Build render items
  const renderItems = useMemo(
    () => buildRenderItems(file.lines, regions, expandedRegions),
    [file.lines, regions, expandedRegions]
  );

  // Set up virtualizer
  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: OVERSCAN,
  });

  return (
    <div
      ref={parentRef}
      className="overflow-auto bg-surface-900/50"
      style={{ maxHeight }}
      role="table"
      aria-label="Diff content (virtualized)"
    >
      <div
        role="rowgroup"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = renderItems[virtualRow.index];

          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <RenderItemComponent
                item={item}
                fileId={fileId}
                isExpanded={isExpanded}
                onToggleRegion={onToggleRegion}
                onLineClick={onLineClick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RenderItemComponentProps {
  item: RenderItem;
  fileId: string;
  isExpanded: (regionIndex: number) => boolean;
  onToggleRegion: (regionIndex: number) => void;
  onLineClick?: (lineNumber: number) => void;
}

/**
 * Renders a single item (line or collapsed region placeholder).
 */
function RenderItemComponent({
  item,
  fileId,
  isExpanded,
  onToggleRegion,
  onLineClick,
}: RenderItemComponentProps) {
  if (item.type === "collapsed") {
    const regionId = `${fileId}-region-${item.regionIndex}`;
    return (
      <CollapsedRegionPlaceholder
        region={item.region}
        regionId={regionId}
        isExpanded={isExpanded(item.regionIndex)}
        onToggle={() => onToggleRegion(item.regionIndex)}
      />
    );
  }

  return <AnnotatedLineRow line={item.line} onLineClick={onLineClick} />;
}

/**
 * Determines if a file should use virtualized rendering.
 */
export function shouldVirtualize(lineCount: number): boolean {
  return lineCount > VIRTUALIZATION_THRESHOLD;
}
