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
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import {
  spawnSimpleAgent,
  resumeSimpleAgent,
  submitToolResult,
  sendQueuedMessage,
} from "@/lib/agent-service";
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageListRef } from "@/components/thread/message-list";
import {
  SuggestedActionsPanel,
  type SuggestedActionsPanelRef,
} from "./suggested-actions-panel";
import { QueuedMessagesBanner } from "./queued-messages-banner";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";
import { useMarkThreadAsRead } from "@/hooks/use-mark-thread-as-read";
import { useWorkingDirectory } from "@/hooks/use-working-directory";
import { useNavigateToNextItem } from "@/hooks/use-navigate-to-next-item";
import {
  useQuickActionsStore,
  defaultActions,
  streamingActions,
  type ActionType,
} from "@/stores/quick-actions-store";
import { useQueuedMessagesForThread } from "@/stores/queued-messages-store";
import type { ThreadContentProps } from "./types";

/** Map entity ThreadStatus to ThreadView's expected status type */
type ViewStatus =
  | "idle"
  | "loading"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

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

  // Quick actions store for keyboard navigation
  const {
    selectedIndex,
    showFollowUpInput,
    isProcessing,
    setSelectedIndex,
    setShowFollowUpInput,
    setFollowUpValue,
    setProcessing,
    resetState,
    navigateUp,
    navigateDown,
  } = useQuickActionsStore();

  const inputRef = useRef<ThreadInputRef>(null);
  const messageListRef = useRef<MessageListRef>(null);
  const quickActionsPanelRef = useRef<SuggestedActionsPanelRef>(null);
  const hasScrolledOnMount = useRef(false);

  // Navigation hook for quick action next item
  const { navigateToNextItemOrFallback } = useNavigateToNextItem();

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

  // Reset quick actions state when threadId changes
  useEffect(() => {
    resetState();
  }, [threadId, resetState]);

  // Reset selectedIndex when streaming state changes (actions array changes)
  useEffect(() => {
    setSelectedIndex(0);
  }, [isStreaming, setSelectedIndex]);

  const handleQuickAction = useCallback(
    async (action: ActionType) => {
      if (isProcessing) return;

      setProcessing(action);
      const currentItem = { type: "thread" as const, id: threadId };

      try {
        if (action === "nextItem") {
          await navigateToNextItemOrFallback(currentItem, {
            actionType: "nextItem",
          });
        } else if (action === "closePanel") {
          // In content pane context, "close panel" means clearing the pane
          // This would be handled by parent via onClose prop
          // For now, just log
          logger.info("[ThreadContent] closePanel action - no-op in content pane");
        } else if (action === "followUp") {
          setShowFollowUpInput(true);
        } else if (action === "respond") {
          inputRef.current?.focus();
        } else if (action === "archive") {
          await threadService.archive(threadId, null);
          await navigateToNextItemOrFallback(currentItem, {
            actionType: "archive",
          });
        } else if (action === "markUnread") {
          await useThreadStore.getState().markThreadAsUnread(threadId);
          await navigateToNextItemOrFallback(currentItem, {
            actionType: "markUnread",
          });
        }
      } catch (error) {
        logger.error(
          `[ThreadContent] Failed to handle quick action ${action}:`,
          error
        );
      } finally {
        setProcessing(null);
      }
    },
    [
      isProcessing,
      setProcessing,
      setShowFollowUpInput,
      threadId,
      navigateToNextItemOrFallback,
    ]
  );

  // Legacy handler for SuggestedActionsPanel onAction prop
  const handleSuggestedAction = useCallback(
    async (action: "markUnread" | "archive") => {
      await handleQuickAction(action);
    },
    [handleQuickAction]
  );

  // Global keyboard navigation for quick actions
  useEffect(() => {
    const actions = isStreaming ? streamingActions : defaultActions;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keyboard if follow-up input is active
      if (showFollowUpInput) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowFollowUpInput(false);
          setFollowUpValue("");
        }
        return;
      }

      // Handle arrow keys
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateUp(actions.length);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (selectedIndex === actions.length - 1) {
          inputRef.current?.focus();
        } else {
          navigateDown(actions.length);
        }
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedAction = actions[selectedIndex];
        if (selectedAction) {
          if (selectedAction.key === "respond") {
            inputRef.current?.focus();
          } else {
            handleQuickAction(selectedAction.key);
          }
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Any regular character typed - focus input and select respond option
        const respondIndex = actions.findIndex((a) => a.key === "respond");
        if (respondIndex !== -1) {
          setSelectedIndex(respondIndex);
        }
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedIndex,
    isStreaming,
    showFollowUpInput,
    navigateUp,
    navigateDown,
    setSelectedIndex,
    setShowFollowUpInput,
    setFollowUpValue,
    handleQuickAction,
  ]);

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

  const handleAutoSelectInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Handle focus transfer from ThreadInput to quick actions panel
  const handleNavigateToQuickActions = useCallback(() => {
    if (quickActionsPanelRef.current) {
      quickActionsPanelRef.current.expand();
      quickActionsPanelRef.current.focus();
    }
  }, []);

  return (
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden">
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

      {/* Quick actions and input pinned to bottom */}
      <div className="flex-shrink-0 w-full max-w-[900px] mx-auto mt-4">
        <SuggestedActionsPanel
          ref={quickActionsPanelRef}
          view={{ type: "thread", threadId }}
          onAction={handleSuggestedAction}
          onAutoSelectInput={handleAutoSelectInput}
          isStreaming={isStreaming}
          onSubmitFollowUp={handleSubmit}
          onQuickAction={handleQuickAction}
        />

        {/* Queued messages banner */}
        <QueuedMessagesBanner messages={queuedMessages} />

        {/* Input with visual indicator when in queue mode */}
        <div
          className={cn(
            "relative",
            canQueueMessages && "ring-1 ring-amber-500/30 ring-inset"
          )}
        >
          <ThreadInput
            ref={inputRef}
            onSubmit={handleSubmit}
            disabled={false}
            workingDirectory={workingDirectory}
            placeholder={
              canQueueMessages ? "Queue a follow-up message..." : undefined
            }
            onNavigateToQuickActions={handleNavigateToQuickActions}
          />
        </div>
      </div>

      {/* Toast for temporary messages */}
      {toastMessage && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg shadow-lg border border-amber-500 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
