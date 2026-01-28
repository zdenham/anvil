import { useMemo, forwardRef, useRef } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { groupMessagesIntoTurns } from "@/lib/utils/turn-grouping";
import { MessageList, type MessageListRef } from "./message-list";
import { LoadingState } from "./loading-state";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { StatusAnnouncement } from "./status-announcement";
import { logger } from "@/lib/logger-client";

type ThreadStatus = "idle" | "loading" | "running" | "completed" | "error" | "cancelled";

interface ThreadViewProps {
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
  /** Messages from the thread (SDK MessageParam format) */
  messages: MessageParam[];
  /** Whether the thread is streaming */
  isStreaming: boolean;
  /** Thread status */
  status: ThreadStatus;
  /** Error message if status is error */
  error?: string;
  /** Callback to retry loading */
  onRetry?: () => void;
  /** Explicit tool states from the agent */
  toolStates?: Record<string, ToolExecutionState>;
  /** Callback when user responds to a tool (e.g., AskUserQuestion) */
  onToolResponse?: (toolId: string, response: string) => void;
}

/**
 * Main thread view container.
 *
 * Handles state rendering (loading/empty/error) and message display.
 * Messages are in SDK MessageParam format with { role, content }.
 */
// Track mount times for timing analysis
const threadViewMountTimes = new Map<string, number>();

export const ThreadView = forwardRef<MessageListRef, ThreadViewProps>(function ThreadView({
  threadId,
  messages,
  isStreaming,
  status,
  error,
  onRetry,
  toolStates,
  onToolResponse,
}, ref) {
  const mountTimeRef = useRef<number>(Date.now());
  const hasLoggedMount = useRef(false);

  // Log on first render (synchronous)
  if (!hasLoggedMount.current) {
    const now = Date.now();
    mountTimeRef.current = now;
    threadViewMountTimes.set(threadId, now);
    logger.info(`[ThreadView:TIMING] FIRST RENDER`, {
      threadId,
      messageCount: messages.length,
      status,
      isStreaming,
      renderTime: now,
      timestamp: new Date(now).toISOString(),
    });
    hasLoggedMount.current = true;
  }

  // Group messages into turns
  const turns = useMemo(() => {
    const now = Date.now();
    const mountTime = threadViewMountTimes.get(threadId) ?? mountTimeRef.current;
    const result = groupMessagesIntoTurns(messages);
    logger.info(`[ThreadView:TIMING] turns useMemo completed`, {
      threadId,
      messageCount: messages.length,
      turnCount: result.length,
      elapsedSinceMount: now - mountTime,
      timestamp: new Date(now).toISOString(),
    });
    return result;
  }, [messages, threadId]);

  // Loading state
  if (status === "loading") {
    logger.info(`[ThreadView:TIMING] Rendering LoadingState`, { threadId, status });
    return <LoadingState />;
  }

  // Error state with no messages
  if (status === "error" && messages.length === 0) {
    logger.info(`[ThreadView:TIMING] Rendering ErrorState`, { threadId, status, error });
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  // Empty/idle state
  if (status === "idle" || messages.length === 0) {
    const now = Date.now();
    const mountTime = threadViewMountTimes.get(threadId) ?? mountTimeRef.current;
    logger.info(`[ThreadView:TIMING] Rendering EmptyState`, {
      threadId,
      status,
      messageCount: messages.length,
      isStreaming,
      elapsedSinceMount: now - mountTime,
      timestamp: new Date(now).toISOString(),
    });
    return <EmptyState isRunning={isStreaming} />;
  }

  // Log that we're about to render the MessageList with messages
  const now = Date.now();
  const mountTime = threadViewMountTimes.get(threadId) ?? mountTimeRef.current;
  logger.info(`[ThreadView:TIMING] Rendering MessageList with messages`, {
    threadId,
    messageCount: messages.length,
    turnCount: turns.length,
    status,
    isStreaming,
    elapsedSinceMount: now - mountTime,
    timestamp: new Date(now).toISOString(),
  });

  return (
    <div
      data-testid="thread-panel"
      className="relative flex-1 flex flex-col min-h-0"
      role="main"
      aria-label="Thread with AI assistant"
    >
      <StatusAnnouncement status={status} error={error} />

      <MessageList
        ref={ref}
        threadId={threadId}
        turns={turns}
        messages={messages}
        isStreaming={isStreaming}
        toolStates={toolStates}
        onToolResponse={onToolResponse}
      />

      {/* Error banner for errors during streaming */}
      {status === "error" && messages.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-red-950/90 border-t border-red-500/30">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
});
