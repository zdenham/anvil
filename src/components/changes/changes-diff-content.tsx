/**
 * ChangesDiffContent — Virtualized file card list for the Changes pane.
 *
 * Renders diff file cards using a custom VirtualList for smooth scrolling
 * at large file counts (up to 300 files). Each card reuses InlineDiffBlock.
 */

import {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
import { useScrolling } from "@/hooks/use-scrolling";
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
  useScrolling(scrollerRef);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());

  const getScrollElement = useCallback(() => scrollerRef.current, []);

  const { items, paddingBefore, paddingAfter, scrollToIndex, measureItem } = useVirtualList({
    count: files.length,
    getScrollElement,
    estimateHeight: 1000,
    overscan: 2400,
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

  const pendingCollapseRef = useRef<number | null>(null);

  const toggleCollapsed = useCallback((index: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        // Only snap-scroll if the card's header is currently sticky (above viewport top)
        const scroller = scrollerRef.current;
        const card = scroller?.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
        if (card && scroller) {
          const cardTop = card.getBoundingClientRect().top;
          const scrollerTop = scroller.getBoundingClientRect().top;
          if (cardTop <= scrollerTop) {
            pendingCollapseRef.current = index;
          }
        }
      }
      return next;
    });
  }, []);

  // After collapsing a sticky card, snap it flush with the viewport top
  useEffect(() => {
    const index = pendingCollapseRef.current;
    if (index === null) return;
    pendingCollapseRef.current = null;

    // Double RAF: frame 1 lets ResizeObserver fire, frame 2 lets virtual list correction apply
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        const wrapper = scroller?.querySelector(`[data-index="${index}"]`);
        const card = wrapper?.firstElementChild?.firstElementChild as HTMLElement | null;
        if (card && scroller) {
          const cardRect = card.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          scroller.scrollTop += cardRect.top - scrollerRect.top;
        } else {
          scrollToIndex({ index, align: "start", behavior: "instant" });
        }
      });
    });
  }, [collapsedFiles, scrollToIndex]);

  return (
    <div data-testid="changes-diff-content" className="h-full min-w-0 overflow-hidden">
      <div ref={scrollerRef} style={{ height: "100%", overflow: "auto" }}>
        <div style={{ paddingTop: paddingBefore, paddingBottom: paddingAfter }}>
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
                ref={measureItem}
                data-index={item.index}
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
