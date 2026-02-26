/**
 * ChangesDiffContent — Virtualized file card list for the Changes pane.
 *
 * Renders diff file cards using react-virtuoso for smooth scrolling
 * at large file counts (up to 300 files). Each card reuses InlineDiffBlock.
 */

import {
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";
import { MAX_DISPLAYED_FILES } from "./changes-diff-fetcher";
import type { FileContentEntry } from "./changes-diff-fetcher";
import type { ParsedDiffFile } from "@/lib/diff-parser";

export interface ChangesDiffContentRef {
  scrollToIndex: (index: number) => void;
}

interface ChangesDiffContentProps {
  files: ParsedDiffFile[];
  rawDiffsByFile: Record<string, string>;
  fileContents: Record<string, FileContentEntry>;
  totalFileCount: number;
  worktreePath: string;
  commitHash?: string;
  uncommittedOnly?: boolean;
}

const LARGE_FILE_THRESHOLD = 1000;

export const ChangesDiffContent = forwardRef<
  ChangesDiffContentRef,
  ChangesDiffContentProps
>(function ChangesDiffContent({ files, rawDiffsByFile, fileContents, totalFileCount }, ref) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());

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

  const toggleCollapsed = useCallback((index: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const renderItem = useCallback(
    (index: number, file: ParsedDiffFile) => {
      const filePath = file.newPath ?? file.oldPath ?? "unknown";
      const rawDiff = rawDiffsByFile[filePath] ?? "";
      const content = fileContents[filePath];
      const isLargeFile =
        file.stats.additions + file.stats.deletions > LARGE_FILE_THRESHOLD;

      return (
        <div className="py-2 px-4">
          <InlineDiffBlock
            filePath={filePath}
            diff={rawDiff}
            fileType={file.type}
            oldContent={content?.oldContent}
            newContent={content?.newContent}
            defaultCollapsed={isLargeFile}
            isFileCollapsed={collapsedFiles.has(index)}
            onToggleFileCollapse={() => toggleCollapsed(index)}
          />
        </div>
      );
    },
    [rawDiffsByFile, fileContents, collapsedFiles, toggleCollapsed],
  );

  const footer = useCallback(() => {
    if (totalFileCount <= MAX_DISPLAYED_FILES) return null;
    return (
      <div className="px-4 py-3 text-xs text-surface-500 text-center">
        Showing {MAX_DISPLAYED_FILES} of {totalFileCount} files
      </div>
    );
  }, [totalFileCount]);

  return (
    <div className="h-full">
      <Virtuoso
        ref={virtuosoRef}
        data={files}
        itemContent={renderItem}
        increaseViewportBy={400}
        style={{ height: "100%" }}
        components={{ Footer: footer }}
      />
    </div>
  );
});
