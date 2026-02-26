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
import { flushSync } from "react-dom";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { ArrowLeft } from "lucide-react";
import { ContextMeter } from "@/components/content-pane/context-meter";
import { FindBar } from "@/components/content-pane/find-bar";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import {
  spawnSimpleAgent,
  resumeSimpleAgent,
  sendQueuedMessage,
  sendToAgent,
} from "@/lib/agent-service";
import { PERMISSION_MODE_CYCLE, type PermissionModeId } from "@core/types/permissions.js";

import { type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadInputSection } from "@/components/reusable/thread-input-section";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageListRef } from "@/components/thread/message-list";
import { useThreadSearch } from "@/components/thread/use-thread-search";
import { logger } from "@/lib/logger-client";
import { savePromptToHistory } from "@/lib/prompt-history-helpers";
import { useMarkThreadAsRead } from "@/hooks/use-mark-thread-as-read";
import { useWorkingDirectory } from "@/hooks/use-working-directory";
import { useDraftSync, clearCurrentDraft } from "@/hooks/useDraftSync";
import { useInputStore } from "@/stores/input-store";

import { navigationService } from "@/stores/navigation-service";
import { useSearchState } from "@/stores/search-state";
import { useQuestionStore } from "@/entities/questions/store";
import { questionService } from "@/entities/questions/service";
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
  threadId,
}: {
  parentThreadId: string;
  threadId: string;
}) {
  const parentThread = useThreadStore(
    useCallback((s) => s.threads[parentThreadId], [parentThreadId])
  );

  const handleParentClick = useCallback(() => {
    navigationService.navigateToThread(parentThreadId);
  }, [parentThreadId]);

  return (
    <div className="flex items-center justify-between py-3 px-2">
      <button
        onClick={handleParentClick}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to {parentThread?.name ?? "parent thread"}</span>
      </button>
      <ContextMeter threadId={threadId} />
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

  // Draft sync — save/restore input drafts on navigation
  useDraftSync({ type: 'thread', id: threadId });
  const clearContent = useInputStore((s) => s.clearContent);

  const inputRef = useRef<ThreadInputRef>(null);
  const messageListRef = useRef<MessageListRef>(null);

  // Find-in-page state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const scrollerRef = useRef<HTMLElement | null>(null);

  // Toast state for "coming soon" messages
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Track optimistic messages sent but not yet persisted to state.json
  const [optimisticMessages, setOptimisticMessages] = useState<MessageParam[]>([]);
  // Track the real message count when optimistic messages were added
  // This helps us know when the real state has caught up
  const realMessageCountWhenOptimisticAdded = useRef<number>(0);

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

  // Permission mode from thread metadata (defaults to "implement")
  const permissionMode: PermissionModeId = activeMetadata?.permissionMode ?? "implement";

  // Cycle to next permission mode: implement -> plan -> approve -> implement
  const handleCycleMode = useCallback(async () => {
    if (!threadId) return;
    const currentIndex = PERMISSION_MODE_CYCLE.indexOf(permissionMode);
    const nextMode = PERMISSION_MODE_CYCLE[(currentIndex + 1) % PERMISSION_MODE_CYCLE.length];

    // Optimistic UI update via thread service
    await threadService.update(threadId, { permissionMode: nextMode });

    // Emit event to agent process via hub socket
    try {
      await sendToAgent(threadId, {
        type: "permission_mode_changed",
        payload: { modeId: nextMode },
      });
    } catch {
      // Agent may not be connected (idle thread) - that's OK,
      // the mode is persisted to disk and will be read on next agent start
    }
  }, [threadId, permissionMode]);

  // Derive status to handle optimistic state
  // If we have optimistic messages or initialPrompt but no real state, treat as "running"
  // This ensures the message is displayed while waiting for the agent to start
  const hasOptimisticContent = optimisticMessages.length > 0 || (initialPrompt && !activeState?.messages?.length);
  const viewStatus: ViewStatus =
    hasOptimisticContent
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


  // Compute messages with optimistic message support
  const messages = useMemo((): MessageParam[] => {
    const now = Date.now();
    const mountTime = componentMountTimes.get(threadId) ?? mountTimeRef.current;
    const elapsed = now - mountTime;

    const realMessages = activeState?.messages ?? [];

    // If no real messages, check initialPrompt first (for thread-creation-service path)
    // and also check if there are no local optimistic messages
    if (realMessages.length === 0 && initialPrompt && optimisticMessages.length === 0) {
      logger.info(`[ThreadContent:TIMING] messages useMemo - using INITIAL_PROMPT`, {
        threadId,
        promptLength: initialPrompt.length,
        elapsedSinceMount: elapsed,
        timestamp: new Date(now).toISOString(),
      });
      return [{ role: "user", content: initialPrompt }];
    }

    // Append any optimistic messages to real messages
    if (optimisticMessages.length > 0) {
      logger.info(`[ThreadContent:TIMING] messages useMemo - appending OPTIMISTIC messages`, {
        threadId,
        realMessageCount: realMessages.length,
        optimisticMessageCount: optimisticMessages.length,
        optimisticPreview: optimisticMessages.map(m =>
          typeof m.content === 'string' ? m.content.slice(0, 30) : '[complex]'
        ),
        elapsedSinceMount: elapsed,
        timestamp: new Date(now).toISOString(),
      });
      return [...realMessages, ...optimisticMessages];
    }

    // Just real messages (or empty)
    if (realMessages.length > 0) {
      logger.info(`[ThreadContent:TIMING] messages useMemo - using STORE messages`, {
        threadId,
        messageCount: realMessages.length,
        elapsedSinceMount: elapsed,
        timestamp: new Date(now).toISOString(),
      });
    } else {
      logger.info(`[ThreadContent:TIMING] messages useMemo - returning EMPTY array`, {
        threadId,
        hasActiveState: !!activeState,
        hasInitialPrompt: !!initialPrompt,
        elapsedSinceMount: elapsed,
        timestamp: new Date(now).toISOString(),
      });
    }
    return realMessages;
  }, [activeState?.messages, initialPrompt, optimisticMessages, threadId]);

  // Keep scrollerRef in sync with MessageList's scroller element
  useEffect(() => {
    const el = messageListRef.current?.getScrollerElement?.() ?? null;
    if (el !== scrollerRef.current) {
      scrollerRef.current = el;
    }
  });

  // Thread search hook (data-layer search + DOM highlighting)
  const threadSearch = useThreadSearch(messages, messageListRef, scrollerRef);
  const searchClearRef = useRef(threadSearch.clear);
  searchClearRef.current = threadSearch.clear;

  // Cmd+F handler for find-in-page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        setFindBarOpen((prev) => {
          if (prev) searchClearRef.current();
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-open FindBar from global search panel via searchState store
  const { isEnabled: searchEnabled, searchQuery: globalSearchQuery, targetMatchIndex, nonce: searchNonce } = useSearchState();
  useEffect(() => {
    if (searchEnabled && globalSearchQuery) {
      setFindBarOpen(true);
      threadSearch.setQueryAndNavigate(globalSearchQuery, targetMatchIndex ?? 0);
    }
  }, [searchEnabled, globalSearchQuery, searchNonce]);

  const closeFindBar = useCallback(() => {
    threadSearch.clear();
    setFindBarOpen(false);
  }, [threadSearch]);

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

      // Clear the persisted draft on send
      clearCurrentDraft({ type: 'thread', id: threadId }, clearContent);

      // Add optimistic message immediately for instant feedback
      // Track the current real message count so we know when state has caught up
      const currentRealCount = activeState?.messages?.length ?? 0;
      realMessageCountWhenOptimisticAdded.current = currentRealCount;
      logger.info(`[ThreadContent] Adding optimistic message`, {
        threadId,
        promptLength: userPrompt.length,
        promptPreview: userPrompt.slice(0, 50),
        currentRealMessageCount: currentRealCount,
        timestamp: Date.now(),
      });
      // Use flushSync to force immediate render of the optimistic message
      // This prevents the message from being cleared before it's ever displayed
      flushSync(() => {
        setOptimisticMessages((prev) => [...prev, { role: "user", content: userPrompt }]);
      });

      // Queue message if agent is currently running
      if (canQueueMessages) {
        // If there are pending questions, cancel them — user is overriding with their message
        const pendingQuestions = useQuestionStore.getState().getPendingForThread(threadId);
        for (const req of pendingQuestions) {
          questionService.cancel(threadId, req.requestId);
        }

        try {
          await sendQueuedMessage(threadId, userPrompt);
        } catch (error) {
          logger.error("[ThreadContent] Failed to queue message:", error);
          showToast("Failed to queue message");
          // Remove optimistic message on failure
          setOptimisticMessages((prev) =>
            prev.filter((m) => m.content !== userPrompt)
          );
        }
        return;
      }

      if (canResumeAgent) {
        try {
          // For first message on a pre-created thread, use spawnSimpleAgent
          // This ensures thread naming runs (it only runs on initial spawn, not resume)
          if (isFirstMessage && activeMetadata?.repoId && activeMetadata?.worktreeId) {
            logger.info("[ThreadContent] First message - using spawnSimpleAgent", {
              threadId,
              permissionMode: activeMetadata.permissionMode,
            });
            await spawnSimpleAgent({
              repoId: activeMetadata.repoId,
              worktreeId: activeMetadata.worktreeId,
              threadId,
              prompt: userPrompt,
              sourcePath: workingDirectory,
              permissionMode: activeMetadata.permissionMode,
            });
          } else {
            await resumeSimpleAgent(threadId, userPrompt, workingDirectory);
          }
        } catch (error) {
          logger.error("[ThreadContent] Failed to spawn/resume agent:", error);
          // Remove optimistic message on failure
          setOptimisticMessages((prev) =>
            prev.filter((m) => m.content !== userPrompt)
          );
          throw error;
        }
      } else {
        logger.warn("[ThreadContent] Cannot submit in current state", {
          status: viewStatus,
        });
        // Remove optimistic message since we can't process it
        setOptimisticMessages((prev) =>
          prev.filter((m) => m.content !== userPrompt)
        );
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
      activeMetadata?.permissionMode,
      activeState?.messages?.length,
      clearContent,
    ]
  );

  // Reset optimistic messages when thread changes
  useEffect(() => {
    setOptimisticMessages([]);
  }, [threadId]);

  // Clear optimistic messages when they appear in the real state
  useEffect(() => {
    if (optimisticMessages.length === 0 || !activeState?.messages) {
      return;
    }

    const realMessageCount = activeState.messages.length;
    const countWhenAdded = realMessageCountWhenOptimisticAdded.current;

    // Only consider clearing if the real message count has INCREASED since we added optimistic messages
    // This prevents clearing optimistic messages too early due to race conditions
    if (realMessageCount <= countWhenAdded) {
      logger.debug(`[ThreadContent] Skipping optimistic clear - real count hasn't increased yet`, {
        threadId,
        realMessageCount,
        countWhenAdded,
        optimisticCount: optimisticMessages.length,
      });
      return;
    }

    // Find optimistic messages that are now in real state by content matching
    const realContent = new Set(
      activeState.messages
        .filter((m) => m.role === "user")
        .map((m) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        )
    );

    const stillPending = optimisticMessages.filter((m) => {
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return !realContent.has(content);
    });

    if (stillPending.length !== optimisticMessages.length) {
      logger.debug(`[ThreadContent] Clearing optimistic messages - now in real state`, {
        threadId,
        realMessageCount,
        countWhenAdded,
        clearedCount: optimisticMessages.length - stillPending.length,
        remainingCount: stillPending.length,
      });
      setOptimisticMessages(stillPending);
    }
  }, [activeState?.messages, optimisticMessages, threadId]);

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

  // Log at render time to see what's actually being rendered
  logger.debug(`[ThreadContent] RENDER`, {
    threadId,
    messageCount: messages.length,
    optimisticCount: optimisticMessages.length,
    hasActiveState: !!activeState,
    realMessageCount: activeState?.messages?.length ?? 0,
    firstMessagePreview: messages[0]?.content?.toString().slice(0, 30),
  });

  return (
      <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
        {/* Find bar for Cmd+F search */}
        {findBarOpen && <FindBar search={threadSearch} onClose={closeFindBar} />}

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
            workingDirectory={workingDirectory || undefined}
          />
        </div>

        {/* Back to parent button for sub-agent threads */}
        {isSubAgent && activeMetadata?.parentThreadId && (
          <BackToParentButton
            parentThreadId={activeMetadata.parentThreadId}
            threadId={threadId}
          />
        )}

        {/* Quick actions and input pinned to bottom - hidden for sub-agent threads (read-only) */}
        {!isSubAgent && (
          <ThreadInputSection
            ref={inputRef}
            onSubmit={handleSubmit}
            workingDirectory={workingDirectory}
            contextType={messages.length === 0 ? "empty" : "thread"}
            placeholder={canQueueMessages ? "Queue a follow-up message..." : undefined}
            threadId={threadId}
            permissionMode={permissionMode}
            onCycleMode={handleCycleMode}
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
