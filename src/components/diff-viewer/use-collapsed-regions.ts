import { useCallback, useMemo, useState } from "react";
import type { AnnotatedLine, CollapsedRegion, ParsedDiffFile } from "./types";

/** Minimum consecutive unchanged lines to create a collapsible region */
export const MIN_COLLAPSE_LINES = 8;

/** Threshold for collapsing interior of large new files */
export const LARGE_NEW_FILE_THRESHOLD = 100;

/** Lines to show at start/end of large new files */
export const LARGE_NEW_FILE_CONTEXT = 10;

/** Threshold for collapsing interior of large deleted files */
export const LARGE_DELETED_FILE_THRESHOLD = 50;

/** Lines to show at start/end of large deleted files */
export const LARGE_DELETED_FILE_CONTEXT = 5;

/**
 * Scans annotated lines and identifies collapsible regions.
 * Returns indices into the lines array, not line numbers.
 */
export function findCollapsibleRegions(
  lines: AnnotatedLine[]
): CollapsedRegion[] {
  const regions: CollapsedRegion[] = [];
  let regionStart: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const isUnchanged = lines[i].type === "unchanged";

    if (isUnchanged && regionStart === null) {
      regionStart = i;
    } else if (!isUnchanged && regionStart !== null) {
      const length = i - regionStart;
      if (length >= MIN_COLLAPSE_LINES) {
        regions.push({
          startIndex: regionStart,
          endIndex: i - 1,
          lineCount: length,
        });
      }
      regionStart = null;
    }
  }

  // Handle trailing unchanged region
  if (regionStart !== null) {
    const length = lines.length - regionStart;
    if (length >= MIN_COLLAPSE_LINES) {
      regions.push({
        startIndex: regionStart,
        endIndex: lines.length - 1,
        lineCount: length,
      });
    }
  }

  return regions;
}

/**
 * Finds collapsible regions for new files (all additions).
 * For very large new files (>100 lines), collapses the interior
 * showing first 10 and last 10 lines.
 */
export function findNewFileCollapsibleRegions(
  lines: AnnotatedLine[]
): CollapsedRegion[] {
  if (lines.length <= LARGE_NEW_FILE_THRESHOLD) {
    return [];
  }

  // For large new files, collapse the middle section
  const startIndex = LARGE_NEW_FILE_CONTEXT;
  const endIndex = lines.length - LARGE_NEW_FILE_CONTEXT - 1;

  if (endIndex <= startIndex) {
    return [];
  }

  return [
    {
      startIndex,
      endIndex,
      lineCount: endIndex - startIndex + 1,
    },
  ];
}

/**
 * Finds collapsible regions for deleted files (all deletions).
 * For large deleted files (>50 lines), collapses the interior
 * showing first 5 and last 5 lines.
 */
export function findDeletedFileCollapsibleRegions(
  lines: AnnotatedLine[]
): CollapsedRegion[] {
  if (lines.length <= LARGE_DELETED_FILE_THRESHOLD) {
    return [];
  }

  // For large deleted files, collapse the middle section
  const startIndex = LARGE_DELETED_FILE_CONTEXT;
  const endIndex = lines.length - LARGE_DELETED_FILE_CONTEXT - 1;

  if (endIndex <= startIndex) {
    return [];
  }

  return [
    {
      startIndex,
      endIndex,
      lineCount: endIndex - startIndex + 1,
    },
  ];
}

/**
 * Determines the appropriate collapsible regions based on file type.
 */
export function findCollapsibleRegionsForFile(
  lines: AnnotatedLine[],
  fileType: ParsedDiffFile["type"]
): CollapsedRegion[] {
  switch (fileType) {
    case "added":
      return findNewFileCollapsibleRegions(lines);
    case "deleted":
      return findDeletedFileCollapsibleRegions(lines);
    default:
      return findCollapsibleRegions(lines);
  }
}

export interface UseCollapsedRegionsResult {
  /** All collapsible regions in the file */
  regions: CollapsedRegion[];
  /** Set of region indices that are currently expanded */
  expanded: Set<number>;
  /** Toggle a specific region's expanded state */
  toggle: (regionIndex: number) => void;
  /** Expand all regions */
  expandAll: () => void;
  /** Collapse all regions */
  collapseAll: () => void;
  /** Check if a specific region is expanded */
  isExpanded: (regionIndex: number) => boolean;
}

/**
 * Hook to manage collapsed regions state for a file.
 *
 * @param lines - The annotated lines for the file
 * @param fileType - The type of file operation (added, deleted, modified, etc.)
 * @returns Object with regions, expanded state, and control functions
 */
export function useCollapsedRegions(
  lines: AnnotatedLine[],
  fileType: ParsedDiffFile["type"] = "modified"
): UseCollapsedRegionsResult {
  // Compute collapsible regions (memoized)
  const regions = useMemo(
    () => findCollapsibleRegionsForFile(lines, fileType),
    [lines, fileType]
  );

  // Track which regions are expanded (by region index)
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = useCallback((regionIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(regionIndex)) {
        next.delete(regionIndex);
      } else {
        next.add(regionIndex);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(regions.map((_, i) => i)));
  }, [regions]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const isExpanded = useCallback(
    (regionIndex: number) => expanded.has(regionIndex),
    [expanded]
  );

  return { regions, expanded, toggle, expandAll, collapseAll, isExpanded };
}

// ============================================================================
// Render helpers
// ============================================================================

export type RenderItem =
  | { type: "line"; line: AnnotatedLine; lineIndex: number }
  | { type: "collapsed"; region: CollapsedRegion; regionIndex: number };

/**
 * Build render items from annotated lines and collapsed regions.
 * This determines what to render: individual lines or collapsed placeholders.
 */
export function buildRenderItems(
  lines: AnnotatedLine[],
  regions: CollapsedRegion[],
  expanded: Set<number>
): RenderItem[] {
  if (regions.length === 0) {
    // No collapsible regions, render all lines
    return lines.map((line, lineIndex) => ({
      type: "line" as const,
      line,
      lineIndex,
    }));
  }

  const items: RenderItem[] = [];
  let lineIndex = 0;

  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex];

    // Add lines before this region
    while (lineIndex < region.startIndex) {
      items.push({
        type: "line",
        line: lines[lineIndex],
        lineIndex,
      });
      lineIndex++;
    }

    // Always render the placeholder/header for this region
    items.push({
      type: "collapsed",
      region,
      regionIndex,
    });

    if (expanded.has(regionIndex)) {
      // Region is expanded, render all lines AFTER the placeholder
      while (lineIndex <= region.endIndex) {
        items.push({
          type: "line",
          line: lines[lineIndex],
          lineIndex,
        });
        lineIndex++;
      }
    } else {
      // Skip lines, they're hidden
      lineIndex = region.endIndex + 1;
    }
  }

  // Add remaining lines after the last region
  while (lineIndex < lines.length) {
    items.push({
      type: "line",
      line: lines[lineIndex],
      lineIndex,
    });
    lineIndex++;
  }

  return items;
}
