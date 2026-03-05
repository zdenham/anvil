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
 * User messages are dispatched directly into the thread store's reducer
 * so they share the same messages array as streaming assistant responses.
 */

import { useEffect, useCallback, useState, useRef } from "react";
import type { StoredMessage } from "@core/types/events";
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
  cancelAgent,
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

export function ThreadContent({
  threadId,
  onPopOut: _onPopOut,
  initialPrompt,
  autoFocus,
}: ThreadContentProps) {
  // Note: onPopOut is available for future use (pop-out functionality wired in Phase 4)
  void _onPopOut;

  // Use useCallback to ensure Zustand creates a new subscription when threadId changes
  const activeState = useThreadStore(
    useCallback((s) => s.threadStates[threadId], [threadId])
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

  // Set this thread as active so THREAD_ACTION events update the store
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

  const entityStatus = activeMetadata?.status ?? "idle";

  // Derive working directory from thread's worktreeId via repo settings
  const workingDirectory = useWorkingDirectory(activeMetadata);

  // Detect sub-agent threads (read-only mode)
  const isSubAgent = !!activeMetadata?.parentThreadId;

  // Permission mode from thread metadata (defaults to "implement")
  const permissionMode: PermissionModeId = activeMetadata?.permissionMode ?? "implement";

  const handleCancel = useCallback(async () => {
    await cancelAgent(threadId);
  }, [threadId]);

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

  // Derive view status from entity status
  const viewStatus: ViewStatus =
    entityStatus === "paused"
      ? "idle"
      : entityStatus === "cancelled"
        ? "cancelled"
        : entityStatus;

  // Determine if we can queue messages (agent is running) or resume (agent is idle/completed)
  const canQueueMessages = viewStatus === "running";
  const resumableStatuses: ViewStatus[] = [
    "idle",
    "error",
    "cancelled",
    "completed",
  ];
  const canResumeAgent = resumableStatuses.includes(viewStatus);


  // Messages come directly from the thread store — user messages are dispatched
  // into the reducer on send, so no separate optimistic layer is needed
  const messages: StoredMessage[] = activeState?.messages ?? (
    initialPrompt ? [{ id: "optimistic-initial", role: "user", content: initialPrompt }] : []
  );

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
  const { isEnabled: searchEnabled, searchQuery: globalSearchQuery, targetMatchIndex, targetSnippet, nonce: searchNonce } = useSearchState();
  useEffect(() => {
    if (searchEnabled && globalSearchQuery) {
      setFindBarOpen(true);
      threadSearch.setQueryAndNavigate(globalSearchQuery, targetMatchIndex ?? 0, targetSnippet ?? undefined);
    }
  }, [searchEnabled, globalSearchQuery, searchNonce]);

  // Clear find state when switching threads
  useEffect(() => {
    threadSearch.clear();
    setFindBarOpen(false);
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Generate a stable ID and dispatch the user message directly into the
      // thread reducer — this makes it a first-class message in the same array
      // as streaming assistant messages, so ordering is always correct.
      const messageId = crypto.randomUUID();
      useThreadStore.getState().dispatch(threadId, {
        type: "THREAD_ACTION",
        action: { type: "APPEND_USER_MESSAGE", payload: { content: userPrompt, id: messageId } },
      });

      // Queue message if agent is currently running
      if (canQueueMessages) {
        // If there are pending questions, cancel them — user is overriding with their message
        const pendingQuestions = useQuestionStore.getState().getPendingForThread(threadId);
        for (const req of pendingQuestions) {
          questionService.cancel(threadId, req.requestId);
        }

        try {
          await sendQueuedMessage(threadId, userPrompt, messageId);
        } catch (error) {
          logger.error("[ThreadContent] Failed to queue message:", error);
          showToast("Failed to queue message");
        }
        return;
      }

      if (canResumeAgent) {
        try {
          // For first message on a pre-created thread, use spawnSimpleAgent
          // This ensures thread naming runs (it only runs on initial spawn, not resume)
          if (isFirstMessage && activeMetadata?.repoId && activeMetadata?.worktreeId) {
            await spawnSimpleAgent({
              repoId: activeMetadata.repoId,
              worktreeId: activeMetadata.worktreeId,
              threadId,
              prompt: userPrompt,
              sourcePath: workingDirectory,
              permissionMode: activeMetadata.permissionMode,
              messageId,
            });
          } else {
            await resumeSimpleAgent(threadId, userPrompt, workingDirectory, messageId);
          }
        } catch (error) {
          logger.error("[ThreadContent] Failed to spawn/resume agent:", error);
          throw error;
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
      activeMetadata?.permissionMode,
      clearContent,
    ]
  );

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
            status={viewStatus}
            workingDirectory={workingDirectory || undefined}
            error={activeState?.error}
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
            onCancel={canQueueMessages ? handleCancel : undefined}
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
