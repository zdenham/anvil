import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { AnnotatedFile } from "./types";
import {
  useCollapsedRegions,
  buildRenderItems,
} from "./use-collapsed-regions";
import { useDiffHighlight } from "@/hooks/use-diff-highlight";
import { FileHeader } from "./file-header";
import { AnnotatedLineRow } from "./annotated-line-row";
import { CollapsedRegionPlaceholder } from "./collapsed-region-placeholder";
import { BinaryFilePlaceholder } from "./binary-file-placeholder";
import { useOptionalDiffCommentStore, useDiffCommentStore } from "@/contexts/diff-comment-context";
import { useCommentStore } from "@/entities/comments/store";
import { commentService } from "@/entities/comments/service";
import { InlineCommentForm } from "./inline-comment-form";
import { InlineCommentDisplay } from "./inline-comment-display";
import type { InlineComment } from "@core/types/comments.js";

interface DiffFileCardProps {
  /** The annotated file to display */
  file: AnnotatedFile;
  /** Index for generating unique IDs */
  fileIndex: number;
  /** Whether all regions should be expanded (from parent) */
  allExpanded?: boolean;
  /** Full file contents keyed by path (new-side content) */
  fullFileContents?: Record<string, string[]>;
  /** Callback when a line is clicked */
  onLineClick?: (filePath: string, lineNumber: number) => void;
}

/**
 * Single file card in the diff viewer.
 * Displays file header and content with collapsible unchanged regions.
 */
export const DiffFileCard = memo(function DiffFileCard({
  file,
  fileIndex,
  allExpanded = false,
  fullFileContents,
  onLineClick,
}: DiffFileCardProps) {
  const filePath = file.file.newPath ?? file.file.oldPath ?? `file-${fileIndex}`;
  const fileId = `diff-file-${fileIndex}`;
  const [isFileCollapsed, setIsFileCollapsed] = useState(false);
  const handleToggleCollapse = useCallback(() => setIsFileCollapsed(prev => !prev), []);

  // Handle binary files
  if (file.file.isBinary || file.file.type === "binary") {
    return (
      <div
        id={fileId}
        className="rounded-lg overflow-hidden border border-surface-700"
        role="region"
        aria-label={`Binary file: ${filePath}`}
        tabIndex={-1}
      >
        <FileHeader
          file={file.file}
          isCollapsed={isFileCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
        {!isFileCollapsed && <BinaryFilePlaceholder file={file.file} />}
      </div>
    );
  }

  // Handle empty files
  if (file.lines.length === 0) {
    return (
      <div
        id={fileId}
        className="rounded-lg overflow-hidden border border-surface-700"
        role="region"
        aria-label={`Empty file: ${filePath}`}
        tabIndex={-1}
      >
        <FileHeader
          file={file.file}
          isCollapsed={isFileCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
        {!isFileCollapsed && (
          <div className="py-6 text-center text-surface-500 text-sm">
            {file.file.type === "added"
              ? "Empty file added"
              : file.file.type === "deleted"
                ? "Empty file deleted"
                : "No content"}
          </div>
        )}
      </div>
    );
  }

  return (
    <DiffFileCardContent
      file={file}
      fileId={fileId}
      fileIndex={fileIndex}
      filePath={filePath}
      allExpanded={allExpanded}
      fullFileContents={fullFileContents}
      onLineClick={onLineClick}
      isFileCollapsed={isFileCollapsed}
      onToggleCollapse={handleToggleCollapse}
    />
  );
});

interface DiffFileCardContentProps {
  file: AnnotatedFile;
  fileId: string;
  fileIndex: number;
  filePath: string;
  allExpanded: boolean;
  fullFileContents?: Record<string, string[]>;
  onLineClick?: (filePath: string, lineNumber: number) => void;
  isFileCollapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * Inner content component with collapsed regions logic.
 */
function DiffFileCardContent({
  file,
  fileId,
  fileIndex: _fileIndex,
  filePath,
  allExpanded,
  fullFileContents,
  onLineClick,
  isFileCollapsed,
  onToggleCollapse,
}: DiffFileCardContentProps) {
  // New-side content from fullFileContents
  const newContent = useMemo(() => {
    const newPath = file.file.newPath;
    if (!newPath || !fullFileContents?.[newPath]) return undefined;
    return fullFileContents[newPath].join("\n");
  }, [file.file.newPath, fullFileContents]);

  // Reconstruct old-side content from annotated lines (deletions + unchanged)
  const oldContent = useMemo(() => {
    if (!fullFileContents) return undefined;
    const oldLines: { num: number; content: string }[] = [];
    for (const line of file.lines) {
      if (line.oldLineNumber != null && (line.type === "deletion" || line.type === "unchanged")) {
        oldLines.push({ num: line.oldLineNumber, content: line.content });
      }
    }
    if (oldLines.length === 0) return undefined;
    oldLines.sort((a, b) => a.num - b.num);
    const maxLine = oldLines[oldLines.length - 1].num;
    const result = new Array(maxLine).fill("");
    for (const { num, content } of oldLines) {
      result[num - 1] = content;
    }
    return result.join("\n");
  }, [file.lines, fullFileContents]);

  const highlightedLines = useDiffHighlight(
    file.lines,
    file.file.newPath ?? file.file.oldPath ?? "",
    oldContent,
    newContent,
  );

  const { regions, expanded, toggle, expandAll, collapseAll, isExpanded } =
    useCollapsedRegions(highlightedLines, file.file.type);

  // Sync with parent's allExpanded state
  useMemo(() => {
    if (allExpanded) {
      expandAll();
    } else {
      collapseAll();
    }
  }, [allExpanded, expandAll, collapseAll]);

  const isFullFile = regions.length > 0 && expanded.size === regions.length;

  const handleToggleFullFile = useCallback(() => {
    if (isFullFile) {
      collapseAll();
    } else {
      expandAll();
    }
  }, [isFullFile, expandAll, collapseAll]);

  const renderItems = useMemo(
    () => buildRenderItems(highlightedLines, regions, expanded),
    [highlightedLines, regions, expanded]
  );

  const commentStore = useOptionalDiffCommentStore();
  const isCommentable = commentStore !== null;

  const handleLineClick = onLineClick
    ? (lineNumber: number) => onLineClick(filePath, lineNumber)
    : undefined;

  return (
    <div
      id={fileId}
      className="rounded-lg overflow-hidden border border-surface-700"
      role="region"
      aria-label={`Changes to ${filePath}`}
      tabIndex={-1}
    >
      <FileHeader
        file={file.file}
        isCollapsed={isFileCollapsed}
        onToggleCollapse={onToggleCollapse}
        isFullFile={isFullFile}
        onToggleFullFile={regions.length > 0 ? handleToggleFullFile : undefined}
      />

      {/* Diff content */}
      {!isFileCollapsed && (
        isCommentable ? (
          <DiffLinesWithComments
            renderItems={renderItems}
            fileId={fileId}
            filePath={filePath}
            isExpanded={isExpanded}
            toggle={toggle}
            onLineClick={handleLineClick}
          />
        ) : (
          <div
            role="table"
            aria-label="Diff content"
            className="bg-surface-900/50 overflow-x-auto"
          >
            <div role="rowgroup">
              {renderItems.map((item) => {
                if (item.type === "collapsed") {
                  const regionId = `${fileId}-region-${item.regionIndex}`;
                  return (
                    <CollapsedRegionPlaceholder
                      key={`collapsed-${item.regionIndex}`}
                      region={item.region}
                      regionId={regionId}
                      isExpanded={isExpanded(item.regionIndex)}
                      onToggle={() => toggle(item.regionIndex)}
                    />
                  );
                }

                return (
                  <AnnotatedLineRow
                    key={`line-${item.lineIndex}`}
                    line={item.line}
                    onLineClick={handleLineClick}
                  />
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** Diff lines with comment support (inside DiffCommentProvider) */
function DiffLinesWithComments({
  renderItems,
  fileId,
  filePath,
  isExpanded,
  toggle,
  onLineClick: _existingLineClick,
}: {
  renderItems: ReturnType<typeof buildRenderItems>;
  fileId: string;
  filePath: string;
  isExpanded: (index: number) => boolean;
  toggle: (index: number) => void;
  onLineClick?: (lineNumber: number) => void;
}) {
  const worktreeId = useDiffCommentStore((s) => s.worktreeId);
  const threadId = useDiffCommentStore((s) => s.threadId);
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);

  // Lazy-load comments for this worktree
  useEffect(() => {
    commentService.loadForWorktree(worktreeId);
  }, [worktreeId]);

  // Subscribe to comments for this file
  const comments = useCommentStore(
    useCallback(
      (s) => s.getByFile(worktreeId, filePath, threadId),
      [worktreeId, filePath, threadId],
    ),
  );

  // Pre-compute comments by line number
  const commentsByLine = useMemo(() => {
    const map = new Map<number, InlineComment[]>();
    for (const c of comments) {
      const existing = map.get(c.lineNumber) ?? [];
      existing.push(c);
      map.set(c.lineNumber, existing);
    }
    return map;
  }, [comments]);

  const handleCommentClick = useCallback((lineNumber: number) => {
    setActiveCommentLine((prev) => (prev === lineNumber ? null : lineNumber));
  }, []);

  return (
    <div className="bg-surface-900/50 overflow-x-auto">
      {renderItems.map((item) => {
        if (item.type === "collapsed") {
          const regionId = `${fileId}-region-${item.regionIndex}`;
          return (
            <CollapsedRegionPlaceholder
              key={`collapsed-${item.regionIndex}`}
              region={item.region}
              regionId={regionId}
              isExpanded={isExpanded(item.regionIndex)}
              onToggle={() => toggle(item.regionIndex)}
            />
          );
        }

        const lineNumber = item.line.newLineNumber ?? item.line.oldLineNumber ?? 0;
        const lineComments = commentsByLine.get(lineNumber) ?? [];

        return (
          <div key={`line-${item.lineIndex}`}>
            <AnnotatedLineRow
              line={item.line}
              onLineClick={handleCommentClick}
              hasComments={lineComments.length > 0}
            />
            {activeCommentLine === lineNumber && (
              <InlineCommentForm
                filePath={filePath}
                lineNumber={lineNumber}
                lineType={item.line.type === "unchanged" ? "unchanged" : item.line.type}
                onClose={() => setActiveCommentLine(null)}
              />
            )}
            <InlineCommentDisplay comments={lineComments} />
          </div>
        );
      })}
    </div>
  );
}
