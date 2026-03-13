import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { parseDiff } from "@/lib/diff-parser";
import { sanitizeTestId } from "@/lib/utils/index";
import { AnnotatedLineRow } from "../diff-viewer/annotated-line-row";
import { CollapsedRegionPlaceholder } from "../diff-viewer/collapsed-region-placeholder";
import {
  useCollapsedRegions,
  buildRenderItems,
} from "../diff-viewer/use-collapsed-regions";
import { InlineDiffHeader } from "./inline-diff-header";

import { CollapsibleOutputBlock } from "../ui/collapsible-output-block";
import { useDiffHighlight } from "@/hooks/use-diff-highlight";
import { useIsSticky } from "@/hooks/use-is-sticky";
import { useOptionalDiffCommentStore, useDiffCommentStore } from "@/contexts/diff-comment-context";
import { useCommentStore } from "@/entities/comments/store";
import { commentService } from "@/entities/comments/service";
import { InlineCommentForm } from "../diff-viewer/inline-comment-form";
import { InlineCommentDisplay } from "../diff-viewer/inline-comment-display";
import type { AnnotatedLine, ParsedDiffFile } from "../diff-viewer/types";
import type { InlineComment } from "@core/types/comments.js";

interface InlineDiffBlockProps {
  /** Absolute file path */
  filePath: string;
  /** Raw unified diff string OR pre-computed annotated lines */
  diff?: string;
  /** Pre-computed annotated lines (alternative to diff string) */
  lines?: AnnotatedLine[];
  /** Pre-computed stats (required if using lines instead of diff) */
  stats?: { additions: number; deletions: number };
  /** File operation type for determining collapse behavior */
  fileType?: ParsedDiffFile["type"];
  /** Full old-side file content for syntax highlighting */
  oldContent?: string;
  /** Full new-side file content for syntax highlighting */
  newContent?: string;
  /** Callback when user wants to open full diff viewer */
  onExpand?: () => void;
  /** Whether this edit is pending user approval */
  isPending?: boolean;
  /** Whether to start collapsed for large diffs (auto-detected if not set) */
  defaultCollapsed?: boolean;
  /** Controlled file-level collapse state (overrides internal state) */
  isFileCollapsed?: boolean;
  /** Controlled file-level collapse toggle (overrides internal state) */
  onToggleFileCollapse?: () => void;
}

/** Threshold: diffs with more lines than this start collapsed */
const LARGE_DIFF_LINE_THRESHOLD = 40;
/** Max height in pixels when collapsed */
const COLLAPSED_MAX_HEIGHT = 200;

/**
 * Inline diff display for Edit/Write tool results.
 * Shows file changes in a compact format within the thread.
 * Auto-collapses large diffs (>40 lines) when pending approval.
 */

export const InlineDiffBlock = memo(function InlineDiffBlock({
  filePath,
  diff,
  lines: precomputedLines,
  stats: precomputedStats,
  fileType = "modified",
  oldContent,
  newContent,
  onExpand,
  isPending,
  defaultCollapsed,
  isFileCollapsed: controlledFileCollapsed,
  onToggleFileCollapse: controlledToggleFileCollapse,
}: InlineDiffBlockProps) {
  // Parse diff and build annotated lines
  const { lines, stats, error } = useMemo(() => {
    // Use precomputed lines if provided
    if (precomputedLines) {
      return {
        lines: precomputedLines,
        stats: precomputedStats ?? { additions: 0, deletions: 0 },
        error: null,
      };
    }

    // Parse diff string
    if (!diff || !diff.trim()) {
      return { lines: [], stats: { additions: 0, deletions: 0 }, error: null };
    }

    try {
      const parsed = parseDiff(diff);
      if (parsed.files.length === 0) {
        return { lines: [], stats: { additions: 0, deletions: 0 }, error: null };
      }

      const file = parsed.files[0];

      // For inline display, we only have the diff lines (no full file content)
      // Build simplified annotated lines from hunk data
      const annotatedLines: AnnotatedLine[] = [];
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          annotatedLines.push({
            type: line.type === "context" ? "unchanged" : line.type,
            content: line.content,
            oldLineNumber: line.oldLineNumber,
            newLineNumber: line.newLineNumber,
          });
        }
      }

      return {
        lines: annotatedLines,
        stats: file.stats,
        error: null,
      };
    } catch (e) {
      return {
        lines: [],
        stats: { additions: 0, deletions: 0 },
        error: e instanceof Error ? e.message : "Failed to parse diff",
      };
    }
  }, [diff, precomputedLines, precomputedStats]);

  // Add syntax highlighting tokens
  const highlightedLines = useDiffHighlight(lines, filePath, oldContent, newContent);

  // Manage collapsed regions
  const collapsedRegions = useCollapsedRegions(highlightedLines, fileType);
  const renderItems = buildRenderItems(
    highlightedLines,
    collapsedRegions.regions,
    collapsedRegions.expanded
  );

  // Auto-collapse large diffs
  const isLargeDiff = lines.length > LARGE_DIFF_LINE_THRESHOLD;
  const shouldStartCollapsed = defaultCollapsed ?? (isPending && isLargeDiff);
  const [isDiffExpanded, setIsDiffExpanded] = useState(!shouldStartCollapsed);

  // Sticky detection for removing rounded corners when stuck
  const [sentinelRef, isSticky] = useIsSticky();

  // File-level collapse — use controlled props when provided, else internal state
  const [internalFileCollapsed, setInternalFileCollapsed] = useState(false);
  const isFileCollapsed = controlledFileCollapsed ?? internalFileCollapsed;
  const handleToggleFileCollapse = controlledToggleFileCollapse ?? (() => setInternalFileCollapsed((v) => !v));

  // Extract filename for display
  const fileName = filePath.split("/").pop() ?? filePath;
  const testId = `inline-diff-${sanitizeTestId(filePath)}`;

  // Handle empty or error states
  if (error) {
    return (
      <div
        data-testid={testId}
        className="rounded-lg border border-red-500/30 bg-red-950/20 p-4"
        role="region"
        aria-label={`Error parsing changes to ${fileName}`}
      >
        <p className="text-sm text-red-400">Unable to parse diff: {error}</p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div
        data-testid={testId}
        className="rounded-lg border border-surface-700 bg-surface-800/50 p-4"
        role="region"
        aria-label={`No changes to ${fileName}`}
      >
        <p className="text-sm text-surface-400">No changes</p>
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-surface-700 overflow-clip"
      role="region"
      aria-label={`Changes to ${fileName}`}
    >
      {/* Sentinel for sticky detection */}
      <div ref={sentinelRef} className="h-0" />

      {/* Header */}
      <InlineDiffHeader
        filePath={filePath}
        stats={stats}
        onExpand={onExpand}
        isFileCollapsed={isFileCollapsed}
        onToggleFileCollapse={handleToggleFileCollapse}
        hasCollapsedRegions={collapsedRegions.regions.length > 0}
        allExpanded={collapsedRegions.expanded.size === collapsedRegions.regions.length}
        onExpandAll={collapsedRegions.expandAll}
        onCollapseAll={collapsedRegions.collapseAll}
        isSticky={isSticky}
      />

      {/* Diff content -- hidden when file is collapsed */}
      {!isFileCollapsed && (
        <>
          {/* Wrapped in collapsible container for large diffs */}
          {shouldStartCollapsed ? (
            <CollapsibleOutputBlock
              isExpanded={isDiffExpanded}
              onToggle={() => setIsDiffExpanded((v) => !v)}
              isLongContent={isLargeDiff}
              maxCollapsedHeight={COLLAPSED_MAX_HEIGHT}
              className="border-0 rounded-none rounded-b-lg"
            >
              <DiffContent renderItems={renderItems} testId={testId} collapsedRegions={collapsedRegions} filePath={filePath} />
            </CollapsibleOutputBlock>
          ) : (
            <DiffContent renderItems={renderItems} testId={testId} collapsedRegions={collapsedRegions} filePath={filePath} />
          )}
        </>
      )}

    </div>
  );
});

/** Extracted diff content to avoid duplication between collapsed and non-collapsed paths */
function DiffContent({
  renderItems,
  testId,
  collapsedRegions,
  filePath,
}: {
  renderItems: ReturnType<typeof buildRenderItems>;
  testId: string;
  collapsedRegions: ReturnType<typeof useCollapsedRegions>;
  filePath: string;
}) {
  const commentStore = useOptionalDiffCommentStore();
  const isCommentable = commentStore !== null;

  if (!isCommentable) {
    return <DiffContentPlain renderItems={renderItems} testId={testId} collapsedRegions={collapsedRegions} />;
  }

  return (
    <DiffContentWithComments
      renderItems={renderItems}
      testId={testId}
      collapsedRegions={collapsedRegions}
      filePath={filePath}
    />
  );
}

/** Plain rendering (no comment provider present) */
function DiffContentPlain({
  renderItems,
  testId,
  collapsedRegions,
}: {
  renderItems: ReturnType<typeof buildRenderItems>;
  testId: string;
  collapsedRegions: ReturnType<typeof useCollapsedRegions>;
}) {
  return (
    <div
      role="table"
      aria-label="Diff content"
      className="bg-surface-900/50 overflow-x-auto rounded-b-lg"
    >
      <div role="rowgroup">
        {renderItems.map((item) => {
          if (item.type === "line") {
            return (
              <AnnotatedLineRow
                key={`line-${item.lineIndex}`}
                line={item.line}
              />
            );
          }

          const regionId = `${testId}-region-${item.regionIndex}`;
          const isExpanded = collapsedRegions.isExpanded(item.regionIndex);

          return (
            <CollapsedRegionPlaceholder
              key={`region-${item.regionIndex}`}
              region={item.region}
              regionId={regionId}
              isExpanded={isExpanded}
              onToggle={() => collapsedRegions.toggle(item.regionIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Rendering with comment support (inside DiffCommentProvider) */
function DiffContentWithComments({
  renderItems,
  testId,
  collapsedRegions,
  filePath,
}: {
  renderItems: ReturnType<typeof buildRenderItems>;
  testId: string;
  collapsedRegions: ReturnType<typeof useCollapsedRegions>;
  filePath: string;
}) {
  const worktreeId = useDiffCommentStore((s) => s.worktreeId);
  const threadId = useDiffCommentStore((s) => s.threadId);
  const [activeCommentLine, setActiveCommentLine] = useState<string | null>(null);

  // Lazy-load comments for this worktree
  useEffect(() => {
    commentService.loadForWorktree(worktreeId);
  }, [worktreeId]);

  // Select raw record (stable reference), derive filtered list in useMemo
  // to avoid new-array-every-call selectors that cause infinite re-renders
  // with useSyncExternalStore.
  const allComments = useCommentStore((s) => s.comments);
  const comments = useMemo(
    () =>
      Object.values(allComments).filter((c) => {
        if (c.worktreeId !== worktreeId || c.filePath !== filePath) return false;
        if (threadId !== undefined) return c.threadId === threadId;
        return true;
      }),
    [allComments, worktreeId, filePath, threadId],
  );

  // Pre-compute comments by composite key (lineNumber:lineType)
  const commentsByLine = useMemo(() => {
    const map = new Map<string, InlineComment[]>();
    for (const c of comments) {
      const key = `${c.lineNumber}:${c.lineType}`;
      const existing = map.get(key) ?? [];
      existing.push(c);
      map.set(key, existing);
    }
    return map;
  }, [comments]);

  return (
    <div className="bg-surface-900/50 overflow-x-auto rounded-b-lg">
      {renderItems.map((item) => {
        if (item.type === "collapsed") {
          const regionId = `${testId}-region-${item.regionIndex}`;
          const isExpanded = collapsedRegions.isExpanded(item.regionIndex);

          return (
            <CollapsedRegionPlaceholder
              key={`region-${item.regionIndex}`}
              region={item.region}
              regionId={regionId}
              isExpanded={isExpanded}
              onToggle={() => collapsedRegions.toggle(item.regionIndex)}
            />
          );
        }

        const key = `${(item.line.newLineNumber ?? item.line.oldLineNumber ?? 0)}:${item.line.type}`;
        const lineNumber = item.line.newLineNumber ?? item.line.oldLineNumber ?? 0;
        const lineComments = commentsByLine.get(key) ?? [];

        return (
          <div key={`line-${item.lineIndex}`}>
            <AnnotatedLineRow
              line={item.line}
              hasComments={lineComments.length > 0}
            />
            {activeCommentLine === key && (
              <InlineCommentForm
                filePath={filePath}
                lineNumber={lineNumber}
                lineType={item.line.type === "unchanged" ? "unchanged" : item.line.type}
                onClose={() => setActiveCommentLine(null)}
              />
            )}
            {lineComments.length > 0 && <InlineCommentDisplay comments={lineComments} />}
          </div>
        );
      })}
    </div>
  );
}
