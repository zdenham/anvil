import { useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Turn } from "@/lib/utils/turn-grouping";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { cn } from "@/lib/utils";
import { TurnRenderer } from "./turn-renderer";
import { WorkingIndicator } from "./working-indicator";
import { StreamingContent } from "./streaming-content";
import { useStreamingStore } from "@/stores/streaming-store";

interface MessageListProps {
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
  /** Turns to render */
  turns: Turn[];
  /** Full messages array (needed for tool result lookup) */
  messages: MessageParam[];
  /** Whether the thread is streaming */
  isStreaming?: boolean;
  /** Explicit tool states from the agent */
  toolStates?: Record<string, ToolExecutionState>;
  /** Callback when user responds to a tool (e.g., AskUserQuestion) */
  onToolResponse?: (toolId: string, response: string) => void;
  /** Working directory for resolving relative file paths in markdown */
  workingDirectory?: string;
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
  threadId,
  turns,
  messages,
  isStreaming = false,
  toolStates,
  onToolResponse,
  workingDirectory,
}, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Show working indicator when streaming but no assistant content yet
  const showWorkingIndicator = useMemo(() => {
    if (!isStreaming || turns.length === 0) return false;
    const lastTurn = turns[turns.length - 1];
    return lastTurn?.type === "user";
  }, [isStreaming, turns]);

  const getScrollElement = useCallback(() => scrollerRef.current, []);

  const followOutput = useCallback(
    (atBottom: boolean) => {
      if (isStreaming && atBottom) return "smooth" as ScrollBehavior;
      return false as const;
    },
    [isStreaming],
  );

  const { items, totalHeight, scrollToIndex: scrollTo, measureRef } = useVirtualList({
    count: turns.length,
    getScrollElement,
    estimateHeight: 100,
    overscan: 200,
    atBottomThreshold: 300,
    onAtBottomChange: setIsAtBottom,
    followOutput,
  });

  const scrollToBottom = useCallback(() => {
    scrollTo({ index: "LAST", behavior: "auto" });
  }, [scrollTo]);

  const scrollToIndex = useCallback((index: number) => {
    scrollTo({ index, align: "center", behavior: "auto" });
  }, [scrollTo]);

  // Expose scroll functions and scroller element through ref
  useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToIndex,
    getScrollerElement: () => scrollerRef.current,
  }), [scrollToBottom, scrollToIndex]);

  // Check if we have active streaming data for this thread
  const hasStreamingContent = useStreamingStore(
    (s) => {
      const stream = s.activeStreams[threadId];
      return !!stream && stream.blocks.length > 0;
    }
  );

  // Scroll to bottom on mount if we have turns
  const mountedRef = useRef(false);
  if (!mountedRef.current && turns.length > 0) {
    mountedRef.current = true;
    // Deferred to after first paint via rAF in the effect below
  }

  return (
    <div
      data-testid="message-list"
      className="flex-1 min-h-0 overflow-hidden relative"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div
        ref={scrollerRef}
        style={{ height: "100%", overflow: "auto" }}
      >
        <div ref={measureRef} style={{ height: totalHeight, position: "relative" }}>
          {items.map((item) => (
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
              <div className={cn("px-4 py-2 w-full max-w-[900px] mx-auto", item.index === 0 && "pt-12")}>
                <TurnRenderer
                  turn={turns[item.index]}
                  turnIndex={item.index}
                  messages={messages}
                  isLast={item.index === turns.length - 1}
                  isStreaming={isStreaming}
                  toolStates={toolStates}
                  onToolResponse={onToolResponse}
                  threadId={threadId}
                  workingDirectory={workingDirectory}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer — rendered after the spacer, outside the virtual list */}
        {hasStreamingContent && (
          <div className="px-4 py-2 w-full max-w-[900px] mx-auto">
            <article role="article" aria-label="Assistant response" className="group">
              <div className="flex gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <StreamingContent threadId={threadId} workingDirectory={workingDirectory} />
                </div>
              </div>
            </article>
          </div>
        )}
        {!hasStreamingContent && showWorkingIndicator && (
          <div className="w-full max-w-[900px] mx-auto">
            <WorkingIndicator />
          </div>
        )}
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
