import { useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo, useEffect } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Turn } from "@/lib/utils/turn-grouping";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { cn } from "@/lib/utils";
import { TurnRenderer } from "./turn-renderer";
import { WorkingIndicator } from "./working-indicator";
import { StreamingContent } from "./streaming-content";
import { useStreamingStore } from "@/stores/streaming-store";
import { logger } from "@/lib/logger-client";

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
 * Uses react-virtuoso for efficient rendering of variable-height items
 * with automatic scroll anchoring during streaming.
 */
// Track mount times for timing analysis
const messageListMountTimes = new Map<string, number>();

export const MessageList = forwardRef<MessageListRef, MessageListProps>(function MessageList({
  threadId,
  turns,
  messages,
  isStreaming = false,
  toolStates,
  onToolResponse,
  workingDirectory,
}, ref) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const mountTimeRef = useRef<number>(Date.now());
  const hasLoggedMount = useRef(false);
  const hasLoggedFirstRender = useRef(false);

  // Log on first render (synchronous)
  if (!hasLoggedMount.current) {
    const now = Date.now();
    mountTimeRef.current = now;
    messageListMountTimes.set(threadId, now);
    logger.info(`[MessageList:TIMING] FIRST RENDER`, {
      threadId,
      turnCount: turns.length,
      messageCount: messages.length,
      isStreaming,
      renderTime: now,
      timestamp: new Date(now).toISOString(),
    });
    hasLoggedMount.current = true;
  }

  // Log after first DOM paint using useEffect
  useEffect(() => {
    if (!hasLoggedFirstRender.current && turns.length > 0) {
      const now = Date.now();
      const mountTime = messageListMountTimes.get(threadId) ?? mountTimeRef.current;
      logger.info(`[MessageList:TIMING] useEffect after render (DOM committed)`, {
        threadId,
        turnCount: turns.length,
        elapsedSinceMount: now - mountTime,
        timestamp: new Date(now).toISOString(),
      });
      hasLoggedFirstRender.current = true;
    }
  }, [turns.length, threadId]);

  // Show working indicator when streaming but no assistant content yet
  const showWorkingIndicator = useMemo(() => {
    if (!isStreaming || turns.length === 0) return false;
    const lastTurn = turns[turns.length - 1];
    return lastTurn?.type === "user";
  }, [isStreaming, turns]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      behavior: "auto",
    });
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
  }, []);

  // Expose scroll functions and scroller element through ref
  useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToIndex,
    getScrollerElement: () => scrollerElRef.current,
  }), [scrollToBottom, scrollToIndex]);

  // Render individual turn
  const itemContent = useCallback(
    (index: number, turn: Turn) => {
      // Only log the first turn render for timing purposes (avoid log spam)
      if (index === 0) {
        const now = Date.now();
        const mountTime = messageListMountTimes.get(threadId) ?? mountTimeRef.current;
        logger.info(`[MessageList:TIMING] itemContent callback for turn 0`, {
          threadId,
          turnType: turn.type,
          elapsedSinceMount: now - mountTime,
          timestamp: new Date(now).toISOString(),
        });
      }
      return (
        <div data-turn-index={index} className={cn("px-4 py-2 w-full max-w-[900px] mx-auto", index === 0 && "pt-12")}>
          <TurnRenderer
            turn={turn}
            turnIndex={index}
            messages={messages}
            isLast={index === turns.length - 1}
            isStreaming={isStreaming}
            toolStates={toolStates}
            onToolResponse={onToolResponse}
            threadId={threadId}
            workingDirectory={workingDirectory}
          />
        </div>
      );
    },
    [messages, turns.length, isStreaming, toolStates, onToolResponse, threadId, workingDirectory]
  );

  // Check if we have active streaming data for this thread
  const hasStreamingContent = useStreamingStore(
    (s) => {
      const stream = s.activeStreams[threadId];
      return !!stream && stream.blocks.length > 0;
    }
  );

  // Footer component for streaming content / working indicator (renders at end of virtualized list)
  const Footer = useCallback(() => {
    // Show streaming content when we have live blocks from the agent
    if (hasStreamingContent) {
      return (
        <div className="px-4 py-2 w-full max-w-[900px] mx-auto">
          <article role="article" aria-label="Assistant response" className="group">
            <div className="flex gap-3">
              <div className="flex-1 min-w-0 space-y-1.5">
                <StreamingContent threadId={threadId} workingDirectory={workingDirectory} />
              </div>
            </div>
          </article>
        </div>
      );
    }

    // Show working indicator when streaming but no content yet (waiting for first token)
    if (showWorkingIndicator) {
      return (
        <div className="w-full max-w-[900px] mx-auto">
          <WorkingIndicator threadId={threadId} />
        </div>
      );
    }

    return null;
  }, [hasStreamingContent, showWorkingIndicator, threadId, workingDirectory]);

  return (
    <div
      data-testid="message-list"
      className="flex-1 min-h-0 overflow-hidden relative"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={(el) => { scrollerElRef.current = el as HTMLElement | null; }}
        data={turns}
        itemContent={itemContent}
        components={{ Footer }}
        initialTopMostItemIndex={turns.length > 0 ? turns.length - 1 : 0}
        followOutput={(atBottom) => {
          if (isStreaming && atBottom) return "smooth";
          return false;
        }}
        atBottomStateChange={setIsAtBottom}
        atBottomThreshold={300}
        style={{ height: "100%" }}
        overscan={200}
      />

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
