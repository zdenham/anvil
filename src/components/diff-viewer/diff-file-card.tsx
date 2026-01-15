import { memo, useMemo } from "react";
import type { AnnotatedFile } from "./types";
import {
  useCollapsedRegions,
  buildRenderItems,
} from "./use-collapsed-regions";
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
  onLineClick,
}: DiffFileCardProps) {
  const filePath = file.file.newPath ?? file.file.oldPath ?? `file-${fileIndex}`;
  const fileId = `diff-file-${fileIndex}`;

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
        <FileHeader file={file.file} />
        <BinaryFilePlaceholder file={file.file} />
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
        <FileHeader file={file.file} />
        <div className="py-6 text-center text-surface-500 text-sm">
          {file.file.type === "added"
            ? "Empty file added"
            : file.file.type === "deleted"
              ? "Empty file deleted"
              : "No content"}
        </div>
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
      onLineClick={onLineClick}
    />
  );
});

interface DiffFileCardContentProps {
  file: AnnotatedFile;
  fileId: string;
  fileIndex: number;
  filePath: string;
  allExpanded: boolean;
  onLineClick?: (filePath: string, lineNumber: number) => void;
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
  onLineClick,
}: DiffFileCardContentProps) {
  const { regions, expanded, toggle, expandAll, collapseAll, isExpanded } =
    useCollapsedRegions(file.lines, file.file.type);

  // Sync with parent's allExpanded state
  useMemo(() => {
    if (allExpanded) {
      expandAll();
    } else {
      collapseAll();
    }
  }, [allExpanded, expandAll, collapseAll]);

  const renderItems = useMemo(
    () => buildRenderItems(file.lines, regions, expanded),
    [file.lines, regions, expanded]
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
      <FileHeader file={file.file} />

      {/* Diff content with table semantics */}
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
    </div>
  );
}
