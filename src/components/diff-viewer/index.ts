/**
 * Diff Viewer Components
 *
 * Shared building blocks for diff rendering (used by InlineDiffBlock, ChangesView, etc.).
 */

// Types
export type {
  AnnotatedFile,
  AnnotatedLine,
  CollapsedRegion,
  DiffHunk,
  DiffLine,
  ParsedDiff,
  ParsedDiffFile,
} from "./types";

// Line rendering
export { AnnotatedLineRow } from "./annotated-line-row";

// Collapsed region components and hooks
export {
  CollapsedRegionPlaceholder,
  CollapsibleContent,
  collapsibleAnimationStyles,
} from "./collapsed-region-placeholder";

export {
  buildRenderItems,
  findCollapsibleRegions,
  findCollapsibleRegionsForFile,
  findDeletedFileCollapsibleRegions,
  findNewFileCollapsibleRegions,
  LARGE_DELETED_FILE_CONTEXT,
  LARGE_DELETED_FILE_THRESHOLD,
  LARGE_NEW_FILE_CONTEXT,
  LARGE_NEW_FILE_THRESHOLD,
  MIN_COLLAPSE_LINES,
  useCollapsedRegions,
} from "./use-collapsed-regions";
export type { RenderItem, UseCollapsedRegionsResult } from "./use-collapsed-regions";

// Inline commenting
export { InlineCommentForm } from "./inline-comment-form";
export { InlineCommentDisplay } from "./inline-comment-display";

// Floating address button
export { FloatingAddressButton } from "./floating-address-button";
