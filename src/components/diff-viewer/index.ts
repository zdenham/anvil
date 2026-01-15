/**
 * Diff Viewer Component
 *
 * A fully accessible diff viewer with:
 * - Collapsible unchanged regions
 * - Syntax highlighting support
 * - File priority ordering
 * - Loading, empty, and error states
 * - Full keyboard navigation
 * - Screen reader support with live announcements
 * - Skip links for file navigation
 */

// Types
export type {
  AnnotatedFile,
  AnnotatedLine,
  CollapsedRegion,
  DiffHunk,
  DiffLine,
  DiffViewerProps,
  FileChangeData,
  ParsedDiff,
  ParsedDiffFile,
} from "./types";

// Main diff viewer component
export { DiffViewer } from "./diff-viewer";
export type { DiffViewerState } from "./diff-viewer";

// State components (Phase 7: Polish & Accessibility)
export { DiffViewerSkeleton, DiffFileCardSkeleton } from "./diff-viewer-skeleton";
export { DiffEmptyState } from "./diff-empty-state";
export { DiffErrorState, FileErrorState } from "./diff-error-state";

// Header component
export { DiffHeader } from "./diff-header";

// File card and related components
export { DiffFileCard } from "./diff-file-card";
export { FileHeader } from "./file-header";
export { AnnotatedLineRow } from "./annotated-line-row";
export { BinaryFilePlaceholder } from "./binary-file-placeholder";
export { FileCardErrorBoundary } from "./file-card-error-boundary";

// Accessibility components (Phase 7)
export { SkipLinks, srOnlyStyles } from "./skip-links";
export { useLiveAnnouncer, LiveAnnouncerRegion } from "./use-live-announcer";

// Collapsed region components
export {
  CollapsedRegionPlaceholder,
  CollapsibleContent,
  collapsibleAnimationStyles,
} from "./collapsed-region-placeholder";

// Collapsed regions hook and utilities
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

// Annotated file helpers
export {
  buildAnnotatedDeletedFile,
  buildAnnotatedNewFile,
  buildAnnotatedRenamedFileNoChanges,
  formatFilePath,
  getFileDisplayInfo,
  isRenamedWithNoChanges,
} from "./annotated-file-helpers";

// Navigation hooks
export { useDiffNavigation } from "./use-diff-navigation";
export { useDiffKeyboard } from "./use-diff-keyboard";

// Navigation components
export { FileJumpDropdown, type FileJumpItem } from "./file-jump-dropdown";
export { FilePositionIndicator } from "./file-position-indicator";
export { KeyboardShortcutsModal } from "./keyboard-shortcuts-modal";

// Virtualization
export {
  VirtualizedFileContent,
  shouldVirtualize,
  VIRTUALIZATION_THRESHOLD,
} from "./virtualized-file-content";
