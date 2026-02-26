/**
 * ChangesDiffContent — Virtualized file card list for the Changes pane.
 *
 * Renders diff file cards using react-virtuoso for smooth scrolling
 * at large file counts (up to 300 files). Each card reuses InlineDiffBlock.
 */

import { useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";
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

export const ChangesDiffContent = forwardRef<ChangesDiffContentRef, ChangesDiffContentProps>(
  function ChangesDiffContent(
    { files, rawDiffsByFile, totalFileCount },
    ref
  ) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    useImperativeHandle(ref, () => ({
      scrollToIndex: (index: number) => {
        virtuosoRef.current?.scrollToIndex({
          index,
          behavior: "smooth",
          align: "start",
        });
      },
    }), []);

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
      [rawDiffsByFile]
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
      <Virtuoso
        ref={virtuosoRef}
        data={files}
        itemContent={renderItem}
        increaseViewportBy={400}
        style={{ height: "100%" }}
        components={{ Footer: footer }}
      />
    );
  }
);
