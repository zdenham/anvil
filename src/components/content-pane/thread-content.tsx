/**
 * ThreadContent
 *
 * Self-contained thread viewer for embedding in content panes.
 * Manages its own data fetching, state, and interactions.
 *
 * This is essentially control-panel-window.tsx's thread rendering
 * extracted into a reusable component without window chrome.
 *
 * Key responsibilities:
 * - Set thread as active via threadService.setActiveThread()
 * - Handle thread refresh from disk if not in store
 * - Manage ThreadView status derivation
 * - Handle tool responses
 * - Provide message input with queue support
 * - Show quick actions panel
 *
 * IMPORTANT: This component NEVER writes directly to stores.
 * All mutations go through services (threadService, etc.)
 */

import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { ArrowLeft } from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import {
  spawnSimpleAgent,
  resumeSimpleAgent,
  submitToolResult,
  sendQueuedMessage,
} from "@/lib/agent-service";
import { type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadInputSection } from "@/components/reusable/thread-input-section";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageListRef } from "@/components/thread/message-list";
import { logger } from "@/lib/logger-client";
import { savePromptToHistory } from "@/lib/prompt-history-helpers";
import { useMarkThreadAsRead } from "@/hooks/use-mark-thread-as-read";
import { useWorkingDirectory } from "@/hooks/use-working-directory";
import { useQueuedMessagesForThread } from "@/stores/queued-messages-store";
import { navigationService } from "@/stores/navigation-service";
import type { ThreadContentProps } from "./types";

/** Map entity ThreadStatus to ThreadView's expected status type */
type ViewStatus =
  | "idle"
  | "loading"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

/**
 * Back button for sub-agent threads.
 * Shows at the bottom to navigate back to parent thread.
 */
function BackToParentButton({
  parentThreadId,
}: {
  parentThreadId: string;
}) {
  const parentThread = useThreadStore(
    useCallback((s) => s.threads[parentThreadId], [parentThreadId])
  );

  const handleParentClick = useCallback(() => {
    navigationService.navigateToThread(parentThreadId);
  }, [parentThreadId]);

  return (
    <div className="py-3 px-2">
      <button
        onClick={handleParentClick}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to {parentThread?.name ?? "parent thread"}</span>
      </button>
    </div>
  );
}

// Track component mount times for timing analysis
const componentMountTimes = new Map<string, number>();

export function ThreadContent({
  threadId,
  onPopOut: _onPopOut,
  initialPrompt,
  autoFocus,
}: ThreadContentProps) {
  // Note: onPopOut is available for future use (pop-out functionality wired in Phase 4)
  void _onPopOut;

  // Timing: Track mount time for this specific threadId
  const mountTimeRef = useRef<number>(Date.now());
  const hasLoggedMount = useRef(false);

  // Log on first render (synchronous timing)
  if (!hasLoggedMount.current) {
    const now = Date.now();
    mountTimeRef.current = now;
    componentMountTimes.set(threadId, now);
    logger.info(`[ThreadContent:TIMING] FIRST RENDER (sync)`, {
      threadId,
      hasInitialPrompt: !!initialPrompt,
      initialPromptLength: initialPrompt?.length ?? 0,
      renderTime: now,
      timestamp: new Date(now).toISOString(),
    });
    hasLoggedMount.current = true;
  }

  // Use useCallback to ensure Zustand creates a new subscription when threadId changes
  const activeState = useThreadStore(
    useCallback((s) => {
      const state = s.threadStates[threadId];
      const now = Date.now();
      const mountTime = componentMountTimes.get(threadId) ?? mountTimeRef.current;
      logger.debug(`[ThreadContent:TIMING] activeState selector ran`, {
        threadId,
        hasMessages: !!(state?.messages?.length),
        messageCount: state?.messages?.length ?? 0,
        elapsedSinceMount: now - mountTime,
      });
      return state;
    }, [threadId])
  );
  const activeMetadata = useThreadStore(
    useCallback((s) => s.threads[threadId], [threadId])
  );
  // Note: isLoadingThreadState available for future loading indicator
  const _isLoadingThreadState = useThreadStore((s) => s.activeThreadLoading);
  void _isLoadingThreadState;

  // Handle marking thread as read when viewed or completed
  useMarkThreadAsRead(threadId, {
    markOnView: true,
    markOnComplete: true,
  });

  const inputRef = useRef<ThreadInputRef>(null);
  const messageListRef = useRef<MessageListRef>(null);
  const hasScrolledOnMount = useRef(false);

  // Toast state for "coming soon" messages
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Set this thread as active so AGENT_STATE events update the store
  // Also refresh thread from disk if not in store (handles cross-window sync)
  useEffect(() => {
    logger.debug(`[ThreadContent] useEffect FIRED for threadId: ${threadId}`);

    const initThread = async () => {
      // If thread is not in store, refresh from disk first
      const threadExists = !!useThreadStore.getState().threads[threadId];

      if (!threadExists) {
        logger.info(
          `[ThreadContent] Thread not in store, refreshing from disk...`
        );
        await threadService.refreshById(threadId);
      }

      // Now set as active and load state
      threadService.setActiveThread(threadId);
    };

    initThread().catch((err) => {
      logger.error(`[ThreadContent] Failed to init thread:`, err);
    });
  }, [threadId]);

  const toolStates = useMemo(
    () => activeState?.toolStates ?? {},
    [activeState?.toolStates]
  );
  const entityStatus = activeMetadata?.status ?? "idle";

  // Derive working directory from thread's worktreeId via repo settings
  const workingDirectory = useWorkingDirectory(activeMetadata);

  // Detect sub-agent threads (read-only mode)
  const isSubAgent = !!activeMetadata?.parentThreadId;

  // Derive status to handle optimistic state
  // If we have optimistic messages but no real state, treat as "running"
  const viewStatus: ViewStatus =
    initialPrompt && !activeState?.messages?.length
      ? "running"
      : entityStatus === "paused"
        ? "idle"
        : entityStatus === "cancelled"
          ? "cancelled"
          : entityStatus;

  const isStreaming = viewStatus === "running";

  // Determine if we can queue messages (agent is running) or resume (agent is idle/completed)
  const canQueueMessages = viewStatus === "running";
  const resumableStatuses: ViewStatus[] = [
    "idle",
    "error",
    "cancelled",
    "completed",
  ];
  const canResumeAgent = resumableStatuses.includes(viewStatus);

  // Get queued messages for this thread (reactive)
  const queuedMessages = useQueuedMessagesForThread(threadId);

  // Create optimistic messages when store is empty
  const messages = useMemo((): MessageParam[] => {
    const now = Date.now();
    const mountTime = componentMountTimes.get(threadId) ?? mountTimeRef.current;
    const elapsed = now - mountTime;

    // If we have messages from the store, use those (real data)
    if (activeState?.messages && activeState.messages.length > 0) {
      logger.info(`[ThreadContent:TIMING] messages useMemo - using STORE messages`, {
        threadId,
        messageCount: activeState.messages.length,
        elapsedSinceMount: elapsed,
        timestamp: new Date(now).toISOString(),
      });
      return activeState.messages;
    }

    // If we have a prompt but no messages yet, show optimistic message
    if (initialPrompt) {
      logger.info(`[ThreadContent:TIMING] messages useMemo - creating OPTIMISTIC message`, {
        threadId,
        promptLength: initialPrompt.length,
        elapsedSinceMount: elapsed,
        timestamp: new Date(now).toISOString(),
      });
      return [{ role: "user", content: initialPrompt }];
    }

    logger.info(`[ThreadContent:TIMING] messages useMemo - returning EMPTY array`, {
      threadId,
      hasActiveState: !!activeState,
      hasInitialPrompt: !!initialPrompt,
      elapsedSinceMount: elapsed,
      timestamp: new Date(now).toISOString(),
    });
    return [];
  }, [activeState?.messages, initialPrompt, threadId]);

  // Show toast with auto-dismiss
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  // Detect if this is the first message (thread created but no agent run yet)
  // This happens when thread is created from tree menu with empty prompt
  const isFirstMessage = !activeState?.messages?.length;

  const handleSubmit = useCallback(
    async (userPrompt: string) => {
      if (!workingDirectory) {
        logger.error("[ThreadContent] Cannot submit: no working directory");
        return;
      }

      // Save to history (fire and forget - don't block on this)
      savePromptToHistory(userPrompt, threadId);

      // Queue message if agent is currently running
      if (canQueueMessages) {
        try {
          await sendQueuedMessage(threadId, userPrompt);
        } catch (error) {
          logger.error("[ThreadContent] Failed to queue message:", error);
          showToast("Failed to queue message");
        }
        return;
      }

      if (canResumeAgent) {
        // For first message on a pre-created thread, use spawnSimpleAgent
        // This ensures thread naming runs (it only runs on initial spawn, not resume)
        if (isFirstMessage && activeMetadata?.repoId && activeMetadata?.worktreeId) {
          logger.info("[ThreadContent] First message - using spawnSimpleAgent");
          await spawnSimpleAgent({
            repoId: activeMetadata.repoId,
            worktreeId: activeMetadata.worktreeId,
            threadId,
            prompt: userPrompt,
            sourcePath: workingDirectory,
          });
        } else {
          await resumeSimpleAgent(threadId, userPrompt, workingDirectory);
        }
      } else {
        logger.warn("[ThreadContent] Cannot submit in current state", {
          status: viewStatus,
        });
      }
    },
    [
      workingDirectory,
      canQueueMessages,
      canResumeAgent,
      threadId,
      viewStatus,
      showToast,
      isFirstMessage,
      activeMetadata?.repoId,
      activeMetadata?.worktreeId,
    ]
  );

  // Reset scroll tracking when threadId changes
  useEffect(() => {
    hasScrolledOnMount.current = false;
  }, [threadId]);

  // Auto-focus input when autoFocus flag is set (for newly created threads)
  useEffect(() => {
    if (autoFocus) {
      // Small delay to ensure input is mounted and ready
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, threadId]);

  // Auto-scroll to bottom ONLY on initial mount when opening panel with messages
  useEffect(() => {
    if (
      !hasScrolledOnMount.current &&
      messages.length > 0 &&
      messageListRef.current
    ) {
      hasScrolledOnMount.current = true;
      const timer = setTimeout(() => {
        messageListRef.current?.scrollToBottom();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages.length > 0]);

  const handleToolResponse = useCallback(
    async (toolId: string, response: string) => {
      if (!workingDirectory) {
        logger.error("[ThreadContent] Cannot respond: no working directory");
        return;
      }

      try {
        await submitToolResult(threadId, toolId, response, workingDirectory);
      } catch (error) {
        logger.error("[ThreadContent] Failed to submit tool response", {
          error,
          toolId,
        });
        throw error;
      }
    },
    [threadId, workingDirectory]
  );

  return (
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
      {/* ThreadView takes remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col w-full">
        <ThreadView
          key={threadId}
          ref={messageListRef}
          threadId={threadId}
          messages={messages}
          isStreaming={isStreaming}
          status={viewStatus}
          toolStates={toolStates}
          onToolResponse={handleToolResponse}
        />
      </div>

      {/* Back to parent button for sub-agent threads */}
      {isSubAgent && activeMetadata?.parentThreadId && (
        <BackToParentButton parentThreadId={activeMetadata.parentThreadId} />
      )}

      {/* Quick actions and input pinned to bottom - hidden for sub-agent threads (read-only) */}
      {!isSubAgent && (
        <ThreadInputSection
          ref={inputRef}
          onSubmit={handleSubmit}
          workingDirectory={workingDirectory}
          contextType={messages.length === 0 ? "empty" : "thread"}
          placeholder={canQueueMessages ? "Queue a follow-up message..." : undefined}
          queuedMessages={queuedMessages}
          canQueue={canQueueMessages}
        />
      )}

      {/* Toast for temporary messages */}
      {toastMessage && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg shadow-lg border border-amber-500 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
