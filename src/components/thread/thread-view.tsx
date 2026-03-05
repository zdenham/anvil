import { useMemo, forwardRef } from "react";
import type { StoredMessage } from "@core/types/events";
import { groupMessagesIntoTurns } from "@/lib/utils/turn-grouping";
import { useIsThreadRunning } from "@/hooks/use-is-thread-running";
import { MessageList, type MessageListRef } from "./message-list";
import { ThreadProvider } from "./thread-context";
import { LoadingState } from "./loading-state";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { StatusAnnouncement } from "./status-announcement";


type ThreadStatus = "idle" | "loading" | "running" | "completed" | "error" | "cancelled";

interface ThreadViewProps {
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
  /** Messages from the thread (StoredMessage with stable id) */
  messages: StoredMessage[];
  /** Thread status */
  status: ThreadStatus;
  /** Error message if status is error */
  error?: string;
  /** Callback to retry loading */
  onRetry?: () => void;
  /** Working directory for resolving relative file paths in markdown */
  workingDirectory?: string;
}

/**
 * Main thread view container.
 *
 * Handles state rendering (loading/empty/error) and message display.
 * Messages are in SDK MessageParam format with { role, content }.
 */
export const ThreadView = forwardRef<MessageListRef, ThreadViewProps>(function ThreadView({
  threadId,
  messages,
  status,
  error,
  onRetry,
  workingDirectory,
}, ref) {
  const isRunning = useIsThreadRunning(threadId);

  // Group messages into turns
  const turns = useMemo(() => {
    return groupMessagesIntoTurns(messages);
  }, [messages]);

  // Loading state
  if (status === "loading") {
    return <LoadingState />;
  }

  // Error state with no messages
  if (status === "error" && messages.length === 0) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  // Empty/idle state (don't flash EmptyState if streaming content still exists)
  if (messages.length === 0 && (status === "idle" || !isRunning)) {
    return <EmptyState isRunning={isRunning} />;
  }

  return (
    <div
      data-testid="thread-panel"
      className="relative flex-1 flex flex-col min-h-0"
      role="main"
      aria-label="Thread with AI assistant"
    >
      <StatusAnnouncement status={status} error={error} />

      <ThreadProvider threadId={threadId} workingDirectory={workingDirectory ?? ""}>
        <MessageList
          ref={ref}
          turns={turns}
        />
      </ThreadProvider>

      {/* Error banner for errors during streaming */}
      {status === "error" && messages.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-red-950/90 border-t border-red-500/30">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
});
