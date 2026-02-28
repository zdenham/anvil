import { useRef, useMemo, useCallback } from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
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

/** Extra pixels to render above/below viewport */
const OVERSCAN = 480; // ~20 rows

/** Threshold for when to use virtualization */
export const VIRTUALIZATION_THRESHOLD = 1000;

/**
 * Virtualized file content using windowed rendering.
 * Used for large files (>1000 lines) to maintain performance.
 *
 * Uses a custom VirtualList engine for efficient rendering of only visible lines.
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

  const getScrollElement = useCallback(() => parentRef.current, []);

  const { items, totalHeight } = useVirtualList({
    count: renderItems.length,
    getScrollElement,
    itemHeight: LINE_HEIGHT,
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
          height: totalHeight,
          width: "100%",
          position: "relative",
        }}
      >
        {items.map((vItem) => {
          const item = renderItems[vItem.index];

          return (
            <div
              key={vItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: vItem.size,
                transform: `translateY(${vItem.start}px)`,
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
