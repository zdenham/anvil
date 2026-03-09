import { useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
import { useScrolling } from "@/hooks/use-scrolling";
import { useIsThreadRunning } from "@/hooks/use-is-thread-running";
import type { Turn } from "@/lib/utils/turn-grouping";
import { cn } from "@/lib/utils";
import { TurnRenderer } from "./turn-renderer";
import { WorkingIndicator } from "./working-indicator";
import { useThreadContext } from "./thread-context";

interface MessageListProps {
  /** Turns to render */
  turns: Turn[];
}

export interface MessageListRef {
  scrollToBottom: () => void;
  scrollToIndex: (index: number) => void;
  getScrollerElement: () => HTMLElement | null;
}

/**
 * Virtualized scrollable message list.
 *
 * Uses a custom VirtualList engine for efficient rendering of variable-height
 * items with automatic scroll anchoring during streaming.
 */
export const MessageList = forwardRef<MessageListRef, MessageListProps>(function MessageList({
  turns,
}, ref) {
  const { threadId } = useThreadContext();
  const isRunning = useIsThreadRunning(threadId);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  useScrolling(scrollerRef);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Show working indicator when running but no assistant content yet
  const showWorkingIndicator = useMemo(() => {
    if (!isRunning || turns.length === 0) return false;
    const lastTurn = turns[turns.length - 1];
    return lastTurn?.type === "user";
  }, [isRunning, turns]);

  const getScrollElement = useCallback(() => scrollerRef.current, []);
  const getContentWrapper = useCallback(() => contentWrapperRef.current, []);

  // Reserve an extra slot for the working indicator so virtual count stays
  // stable while streaming (avoids N -> N+1 -> N offset recalculations).
  const virtualCount = turns.length + (showWorkingIndicator ? 1 : 0);

  const { items, totalHeight, paddingBefore, paddingAfter, scrollToIndex: scrollTo, measureItem, setSticky } = useVirtualList({
    count: virtualCount,
    getScrollElement,
    getContentWrapper,
    estimateHeight: 100,
    overscan: 200,
    atBottomThreshold: 300,
    onAtBottomChange: setIsAtBottom,
    sticky: true,
    autoScrollOnGrowth: isRunning,
    initialScrollToBottom: true,
  });

  const scrollToBottom = useCallback(() => {
    setSticky(true);
    scrollTo({ index: "LAST", behavior: "auto" });
  }, [scrollTo, setSticky]);

  const scrollToIndex = useCallback((index: number) => {
    scrollTo({ index, align: "center", behavior: "auto" });
  }, [scrollTo]);

  // Expose scroll functions and scroller element through ref
  useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToIndex,
    getScrollerElement: () => scrollerRef.current,
  }), [scrollToBottom, scrollToIndex]);

  return (
    <div
      data-testid="message-list"
      className="flex-1 min-h-0 overflow-hidden relative"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {/* overscrollBehavior: "contain" prevents macOS elastic bounce at scroll
          boundaries. This pairs with the overscroll-past-top correction guard in
          useVirtualList to give a hard stop at the top of the list. */}
      <div
        ref={scrollerRef}
        style={{ height: "100%", overflow: "auto", overflowAnchor: "auto", overscrollBehavior: "contain" }}
      >
        <div ref={contentWrapperRef} style={{ minHeight: totalHeight + 30 }}>
        <div style={{ height: paddingBefore }} />
        {items.map((item) => {
          const isWorkingSlot = item.index >= turns.length;

          return (
            <div
              key={item.key}
              ref={measureItem}
              data-index={item.index}
              style={{ contain: "layout style" }}
            >
              <div className={cn("px-4 py-2 w-full max-w-[900px] mx-auto", item.index === 0 && "pt-12")}>
                {isWorkingSlot ? (
                  <WorkingIndicator />
                ) : (
                  <TurnRenderer
                    turn={turns[item.index]}
                    turnIndex={item.index}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div style={{ height: paddingAfter + 30 }} />
        </div>
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 p-2 rounded-full bg-surface-700/80 shadow-lg hover:bg-surface-600 transition-colors"
          aria-label="Scroll to bottom"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      )}
    </div>
  );
});
