/**
 * ChangesDiffContent — Virtualized file card list for the Changes pane.
 *
 * Renders diff file cards using react-virtuoso for smooth scrolling
 * at large file counts (up to 300 files). Each card reuses InlineDiffBlock.
 *
 * A sticky header overlay tracks the currently visible file using Virtuoso's
 * rangeChanged callback, since native sticky positioning doesn't work with
 * virtualized lists that unmount off-screen items.
 */

import {
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
  memo,
} from "react";
import { Virtuoso, type VirtuosoHandle, type ListRange } from "react-virtuoso";
import { ArrowRight } from "lucide-react";
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";
import { getFileIconUrl } from "@/components/file-browser/file-icons";
import { MAX_DISPLAYED_FILES } from "./changes-diff-fetcher";
import type { ParsedDiffFile } from "@/lib/diff-parser";

export interface ChangesDiffContentRef {
  scrollToIndex: (index: number) => void;
}

interface ChangesDiffContentProps {
  files: ParsedDiffFile[];
  rawDiffsByFile: Record<string, string>;
  totalFileCount: number;
  worktreePath: string;
  commitHash?: string;
  uncommittedOnly?: boolean;
}

const LARGE_FILE_THRESHOLD = 1000;

// ---------------------------------------------------------------------------
// Sticky file header overlay
// ---------------------------------------------------------------------------

interface StickyFileHeaderProps {
  file: ParsedDiffFile;
}

/** Pinned header showing the currently-visible file's info. */
const StickyFileHeader = memo(function StickyFileHeader({
  file,
}: StickyFileHeaderProps) {
  const path = file.newPath ?? file.oldPath ?? "Unknown file";
  const isRename = file.type === "renamed" && file.oldPath;
  const fileName = (file.newPath ?? file.oldPath ?? "file").split("/").pop() ?? "file";

  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2.5 px-3 py-1.5 bg-surface-800 border-b border-surface-700 shadow-sm">
      {/* File icon */}
      <img
        src={getFileIconUrl(fileName)}
        alt=""
        className="w-4 h-4 flex-shrink-0"
        aria-hidden="true"
      />

      {/* File path(s) */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isRename ? (
          <>
            <span className="font-mono text-xs text-surface-400 truncate">
              {file.oldPath}
            </span>
            <ArrowRight
              className="w-4 h-4 text-surface-500 flex-shrink-0"
              aria-hidden="true"
            />
            <span className="font-mono text-xs text-surface-200 truncate">
              {file.newPath}
            </span>
          </>
        ) : (
          <span className="font-mono text-xs text-surface-200 truncate">
            {path}
          </span>
        )}
      </div>

      {/* Operation badge */}
      <OperationBadge type={file.type} similarity={file.similarity} />

      {/* Stats */}
      {(file.stats.additions > 0 || file.stats.deletions > 0) && (
        <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
          {file.stats.additions > 0 && (
            <span className="text-emerald-400">+{file.stats.additions}</span>
          )}
          {file.stats.deletions > 0 && (
            <span className="text-red-400">-{file.stats.deletions}</span>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Operation badge (matches diff-viewer/file-header.tsx)
// ---------------------------------------------------------------------------

interface OperationBadgeProps {
  type: ParsedDiffFile["type"];
  similarity?: number;
}

function OperationBadge({ type, similarity }: OperationBadgeProps) {
  const { label, className } = getBadgeConfig(type, similarity);
  return (
    <span
      className={`px-2 py-0.5 text-xs rounded font-medium flex-shrink-0 ${className}`}
    >
      {label}
    </span>
  );
}

function getBadgeConfig(
  type: ParsedDiffFile["type"],
  similarity?: number,
): { label: string; className: string } {
  switch (type) {
    case "added":
      return { label: "Added", className: "bg-emerald-500/20 text-emerald-400" };
    case "deleted":
      return { label: "Deleted", className: "bg-red-500/20 text-red-400" };
    case "modified":
      return { label: "Modified", className: "bg-amber-500/20 text-amber-400" };
    case "renamed":
      return {
        label: similarity === 100 ? "Renamed" : `Renamed (${similarity}%)`,
        className: "bg-accent-500/20 text-accent-400",
      };
    case "binary":
      return { label: "Binary", className: "bg-surface-500/20 text-surface-400" };
    default:
      return { label: "Changed", className: "bg-surface-500/20 text-surface-400" };
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ChangesDiffContent = forwardRef<
  ChangesDiffContentRef,
  ChangesDiffContentProps
>(function ChangesDiffContent({ files, rawDiffsByFile, totalFileCount }, ref) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [topIndex, setTopIndex] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        virtuosoRef.current?.scrollToIndex({
          index,
          behavior: "smooth",
          align: "start",
        });
      },
    }),
    [],
  );

  const handleRangeChanged = useCallback((range: ListRange) => {
    setTopIndex(range.startIndex);
  }, []);

  const renderItem = useCallback(
    (_index: number, file: ParsedDiffFile) => {
      const filePath = file.newPath ?? file.oldPath ?? "unknown";
      const rawDiff = rawDiffsByFile[filePath] ?? "";
      const isLargeFile =
        file.stats.additions + file.stats.deletions > LARGE_FILE_THRESHOLD;

      return (
        <div className="py-2 px-4">
          <InlineDiffBlock
            filePath={filePath}
            diff={rawDiff}
            fileType={file.type}
            defaultCollapsed={isLargeFile}
          />
        </div>
      );
    },
    [rawDiffsByFile],
  );

  const footer = useCallback(() => {
    if (totalFileCount <= MAX_DISPLAYED_FILES) return null;
    return (
      <div className="px-4 py-3 text-xs text-surface-500 text-center">
        Showing {MAX_DISPLAYED_FILES} of {totalFileCount} files
      </div>
    );
  }, [totalFileCount]);

  const currentFile = files[topIndex];

  return (
    <div className="relative h-full">
      {/* Sticky header overlay for the currently-visible file */}
      {currentFile && <StickyFileHeader file={currentFile} />}

      <Virtuoso
        ref={virtuosoRef}
        data={files}
        itemContent={renderItem}
        rangeChanged={handleRangeChanged}
        increaseViewportBy={400}
        style={{ height: "100%" }}
        components={{ Footer: footer }}
      />
    </div>
  );
});
