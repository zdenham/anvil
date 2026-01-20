import { useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Turn } from "@/lib/utils/turn-grouping";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { TurnRenderer } from "./turn-renderer";
import { WorkingIndicator } from "./working-indicator";

interface MessageListProps {
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
}

export interface MessageListRef {
  scrollToBottom: () => void;
}

/**
 * Virtualized scrollable message list.
 *
 * Uses react-virtuoso for efficient rendering of variable-height items
 * with automatic scroll anchoring during streaming.
 */
export const MessageList = forwardRef<MessageListRef, MessageListProps>(function MessageList({
  turns,
  messages,
  isStreaming = false,
  toolStates,
  onToolResponse,
}, ref) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Show working indicator when streaming but no assistant content yet
  const showWorkingIndicator = useMemo(() => {
    if (!isStreaming || turns.length === 0) return false;
    const lastTurn = turns[turns.length - 1];
    return lastTurn?.type === "user";
  }, [isStreaming, turns]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      behavior: "smooth",
    });
  }, []);

  // Expose scrollToBottom function through ref
  useImperativeHandle(ref, () => ({
    scrollToBottom,
  }), [scrollToBottom]);

  // Render individual turn
  const itemContent = useCallback(
    (index: number, turn: Turn) => (
      <div className="px-4 py-3">
        <TurnRenderer
          turn={turn}
          turnIndex={index}
          messages={messages}
          isLast={index === turns.length - 1}
          isStreaming={isStreaming}
          toolStates={toolStates}
          onToolResponse={onToolResponse}
        />
      </div>
    ),
    [messages, turns.length, isStreaming, toolStates, onToolResponse]
  );

  // Footer component for working indicator (renders at end of virtualized list)
  const Footer = useCallback(() => {
    if (!showWorkingIndicator) return null;
    return <WorkingIndicator />;
  }, [showWorkingIndicator]);

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
        data={turns}
        itemContent={itemContent}
        components={{ Footer }}
        followOutput={isStreaming ? "smooth" : false}
        alignToBottom
        atBottomStateChange={setIsAtBottom}
        atBottomThreshold={50}
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
