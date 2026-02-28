/**
 * ChangesDiffContent — Virtualized file card list for the Changes pane.
 *
 * Renders diff file cards using a custom VirtualList for smooth scrolling
 * at large file counts (up to 300 files). Each card reuses InlineDiffBlock.
 */

import {
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());

  const getScrollElement = useCallback(() => scrollerRef.current, []);

  const { items, totalHeight, scrollToIndex, measureRef } = useVirtualList({
    count: files.length,
    getScrollElement,
    estimateHeight: 200,
    overscan: 400,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        scrollToIndex({ index, behavior: "smooth", align: "start" });
      },
    }),
    [scrollToIndex],
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

  return (
    <div className="h-full">
      <div ref={scrollerRef} style={{ height: "100%", overflow: "auto" }}>
        <div ref={measureRef} style={{ height: totalHeight, position: "relative" }}>
          {items.map((item) => {
            const file = files[item.index];
            const filePath = file.newPath ?? file.oldPath ?? "unknown";
            const rawDiff = rawDiffsByFile[filePath] ?? "";
            const content = fileContents[filePath];
            const isLargeFile =
              file.stats.additions + file.stats.deletions > LARGE_FILE_THRESHOLD;

            return (
              <div
                key={item.key}
                data-index={item.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div className="py-2 px-4">
                  <InlineDiffBlock
                    filePath={filePath}
                    diff={rawDiff}
                    fileType={file.type}
                    oldContent={content?.oldContent}
                    newContent={content?.newContent}
                    defaultCollapsed={isLargeFile}
                    isFileCollapsed={collapsedFiles.has(item.index)}
                    onToggleFileCollapse={() => toggleCollapsed(item.index)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {totalFileCount > MAX_DISPLAYED_FILES && (
          <div className="px-4 py-3 text-xs text-surface-500 text-center">
            Showing {MAX_DISPLAYED_FILES} of {totalFileCount} files
          </div>
        )}
      </div>
    </div>
  );
});
