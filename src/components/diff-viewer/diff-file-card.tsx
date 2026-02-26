import { memo, useCallback, useMemo, useState } from "react";
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
 *
 * Accessibility features:
 * - Region role with aria-label
 * - Table semantics for diff content
 * - Keyboard-accessible collapsed regions
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

      {/* Diff content with table semantics */}
      {!isFileCollapsed && (
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
      )}
    </div>
  );
}
