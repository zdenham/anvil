import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { useSimpleTaskParams } from "./use-simple-task-params";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import {
  resumeSimpleAgent,
  submitToolResult,
  sendQueuedMessage,
} from "@/lib/agent-service";
import { useQueuedMessagesForThread } from "@/stores/queued-messages-store";
import { SimpleTaskHeader, type SimpleTaskView } from "./simple-task-header";
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageListRef } from "@/components/thread/message-list";
import { QueuedMessagesBanner } from "./queued-messages-banner";
import { SuggestedActionsPanel, type SuggestedActionsPanelRef } from "./suggested-actions-panel";
import { ChangesTab } from "./changes-tab";
import { logger } from "@/lib/logger-client";
import { useAgentModeStore } from "@/entities/agent-mode";
import { useMarkThreadAsRead } from "@/hooks/use-mark-thread-as-read";
import { markTaskUnread } from "@/entities/tasks/mark-unread-service";
import { archiveTask } from "@/entities/tasks/archive-service";
import { useNavigateToNextTask } from "@/hooks/use-navigate-to-next-task";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NavigationBanner } from "./navigation-banner";
import { useQuickActionsStore, defaultActions, streamingActions, type ActionType } from "@/stores/quick-actions-store";

/** Map entity ThreadStatus to ThreadView's expected status type */
type ViewStatus = "idle" | "loading" | "running" | "completed" | "error" | "cancelled";

export function SimpleTaskWindow() {
  const params = useSimpleTaskParams();

  if (!params) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-900 text-surface-500 text-sm">
        Loading...
      </div>
    );
  }

  return <SimpleTaskWindowContent {...params} />;
}

interface SimpleTaskWindowContentProps {
  taskId: string;
  threadId: string;
  prompt?: string;
}

/**
 * Inner component that renders once params are available.
 * Separated to allow hooks to be called unconditionally.
 */
function SimpleTaskWindowContent({
  taskId,
  threadId,
  prompt,
}: SimpleTaskWindowContentProps) {
  const activeState = useThreadStore((s) => s.threadStates[threadId]);
  const activeMetadata = useThreadStore((s) => s.threads[threadId]);
  // Select the mode value directly to avoid unstable selector return values
  const threadModes = useAgentModeStore((s) => s.threadModes);
  const defaultMode = useAgentModeStore((s) => s.defaultMode);
  const agentMode = threadModes[threadId] ?? defaultMode;

  // Handle marking thread as read when viewed or completed
  useMarkThreadAsRead(threadId, {
    markOnView: true,
    markOnComplete: true, // Re-enabled with simple-task panel check to prevent Spotlight interference
    requiredPanel: "simple-task", // Only mark as read when simple-task panel is visible
  });

  // Navigation hook for suggested actions
  const { navigateToNextTaskOrFallback } = useNavigateToNextTask(taskId);

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

  // Queued messages from store (single source of truth)
  const queuedMessages = useQueuedMessagesForThread(threadId);
  const inputRef = useRef<ThreadInputRef>(null);
  const messageListRef = useRef<MessageListRef>(null);
  const quickActionsPanelRef = useRef<SuggestedActionsPanelRef>(null);

  // View toggle state: "thread" (default) or "changes"
  const [activeView, setActiveView] = useState<SimpleTaskView>("thread");

  // Toast state for "coming soon" messages
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Determine if changes view is available (requires git info, but not necessarily file changes)
  // ChangesTab handles empty state with appropriate message
  const hasChanges = useMemo(() => {
    const hasGitInfo = !!activeMetadata?.git?.initialCommitHash;

    logger.debug("[SimpleTaskWindow] hasChanges calculation:", {
      hasGitInfo,
      initialCommitHash: activeMetadata?.git?.initialCommitHash,
      fileChangesLength: activeState?.fileChanges?.length ?? 0,
    });

    return hasGitInfo;
  }, [activeMetadata?.git?.initialCommitHash, activeState?.fileChanges?.length]);

  const handleToggleView = useCallback(() => {
    setActiveView((v) => (v === "thread" ? "changes" : "thread"));
  }, []);

  // Set this thread as active so AGENT_STATE events update the store
  // Also refresh thread from disk if not in store (handles cross-window sync)
  useEffect(() => {
    logger.debug(`[SimpleTaskWindow] useEffect FIRED for threadId: ${threadId}`);
    logger.info(`[SimpleTaskWindow] useEffect: Setting active thread: ${threadId}`);

    const initThread = async () => {
      // If thread is not in store, refresh from disk first
      // This handles the case where another window created the thread
      const threadExists = !!useThreadStore.getState().threads[threadId];
      logger.info(`[SimpleTaskWindow] Thread exists in store: ${threadExists}`);

      if (!threadExists) {
        logger.info(`[SimpleTaskWindow] Thread not in store, refreshing from disk...`);
        await threadService.refreshById(threadId);
        const afterRefresh = !!useThreadStore.getState().threads[threadId];
        logger.info(`[SimpleTaskWindow] After refresh, thread exists: ${afterRefresh}`);
      }

      // Now set as active and load state
      threadService.setActiveThread(threadId);
    };

    initThread().catch((err) => {
      logger.error(`[SimpleTaskWindow] Failed to init thread:`, err);
    });
  }, [threadId]);

  const toolStates = useMemo(() => activeState?.toolStates ?? {}, [activeState?.toolStates]);
  const entityStatus = activeMetadata?.status ?? "idle";
  const workingDirectory = activeMetadata?.workingDirectory ?? "";

  // DEBUG: Log tool states to diagnose spinner bug
  // Note: We select the threadStates object, then derive keys outside to avoid
  // creating new arrays inside the selector (which causes infinite re-renders)
  const storeThreadStates = useThreadStore((s) => s.threadStates);
  const storeThreadStatesKeys = Object.keys(storeThreadStates);
  logger.info(`[SimpleTaskWindow] Tool states debug`, {
    threadId,
    hasActiveState: !!activeState,
    hasToolStates: !!activeState?.toolStates,
    toolStatesKeys: Object.keys(toolStates),
    toolStatesCount: Object.keys(toolStates).length,
    toolStatesSnapshot: JSON.stringify(toolStates).slice(0, 500),
    // DEBUG: Check what threadIds have state in the store
    storeHasAnyStates: storeThreadStatesKeys.length > 0,
    storeThreadStatesKeys: storeThreadStatesKeys,
    currentThreadInStore: storeThreadStatesKeys.includes(threadId),
  });

  // Derive status to handle optimistic state
  // If we have optimistic messages but no real state, treat as "running"
  // This prevents ThreadView from showing EmptyState when status === "idle"
  const viewStatus: ViewStatus =
    prompt && !activeState?.messages?.length
      ? "running"
      : entityStatus === "paused"
        ? "idle"
        : entityStatus === "cancelled"
          ? "cancelled"
          : entityStatus;

  const isStreaming = viewStatus === "running";

  // Determine if we can queue messages (agent is running) or resume (agent is idle/completed)
  const canQueueMessages = viewStatus === 'running';
  const resumableStatuses: ViewStatus[] = ['idle', 'error', 'cancelled', 'completed'];
  const canResumeAgent = resumableStatuses.includes(viewStatus);

  // Create optimistic messages when store is empty
  const messages = useMemo((): MessageParam[] => {
    // If we have messages from the store, use those (real data)
    if (activeState?.messages && activeState.messages.length > 0) {
      return activeState.messages;
    }

    // If we have a prompt but no messages yet, show optimistic message
    if (prompt) {
      return [{ role: "user", content: prompt }];
    }

    return [];
  }, [activeState?.messages, prompt]);

  // Show toast with auto-dismiss
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const handleSubmit = async (userPrompt: string) => {
    if (!workingDirectory) {
      logger.error("[SimpleTaskWindow] Cannot submit: no working directory");
      return;
    }

    // Message queueing temporarily disabled
    if (canQueueMessages) {
      showToast("Message queueing coming soon");
      return;
    }

    if (canResumeAgent) {
      await resumeSimpleAgent(taskId, threadId, userPrompt, workingDirectory, agentMode);
    } else {
      // Paused or other state - shouldn't happen with current logic
      logger.warn('[SimpleTaskWindow] Cannot submit in current state', { status: viewStatus });
    }
  };

  // NOTE: QUEUED_MESSAGE_ACK handling is now done in agent-service.ts
  // which updates the Zustand store directly. No local state or event
  // listener needed here - the store is the single source of truth.

  // Pin panel when resized - panel stays pinned until explicitly hidden
  // This allows users to position the panel and have it stay visible on blur
  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let hasPinned = false;

    const handleResize = async () => {
      // Only need to pin once - panel stays pinned until hidden
      if (!hasPinned) {
        try {
          await invoke("pin_simple_task_panel");
          hasPinned = true;
          logger.debug("[SimpleTaskWindow] Panel pinned due to resize (will stay pinned until closed)");
        } catch (err) {
          logger.error("[SimpleTaskWindow] Failed to pin panel for resize:", err);
        }
      }
    };

    // Listen to Tauri window resize events
    const unlisten = currentWindow.onResized(handleResize);

    return () => {
      unlisten.then((unlistenFn) => unlistenFn());
    };
  }, []);

  // Auto-scroll to bottom when simple task panel opens with messages
  useEffect(() => {
    // Only auto-scroll if we have messages and the component just mounted or messages were just loaded
    if (messages.length > 0 && messageListRef.current) {
      // Small delay to ensure the DOM has rendered the messages
      const timer = setTimeout(() => {
        messageListRef.current?.scrollToBottom();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [messages.length > 0 && activeState?.messages ? activeState.messages.length : 0]);

  // Reset quick actions state when taskId changes
  useEffect(() => {
    resetState();
  }, [taskId, resetState]);

  // Focus restoration after task navigation
  // This ensures keyboard navigation works after archive/nextTask actions
  useEffect(() => {
    const initialFocus = document.hasFocus();
    logger.info(`[SimpleTaskWindow] Focus restoration effect triggered`, {
      taskId,
      documentHasFocus: initialFocus,
      activeElement: document.activeElement?.tagName,
      activeElementId: document.activeElement?.id,
    });

    // Track focus changes during the restoration window to diagnose focus theft
    let focusLostAt: number | null = null;
    const handleBlur = () => {
      focusLostAt = Date.now();
      logger.warn(`[SimpleTaskWindow] Window BLUR detected during focus restoration window`, {
        taskId,
        timestamp: focusLostAt,
        documentHasFocus: document.hasFocus(),
      });
    };
    const handleFocus = () => {
      logger.info(`[SimpleTaskWindow] Window FOCUS detected during focus restoration window`, {
        taskId,
        timestamp: Date.now(),
        focusLostAt,
        documentHasFocus: document.hasFocus(),
      });
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    // Short delay to ensure DOM is ready after task change
    const timer = setTimeout(async () => {
      // Log state before attempting focus
      logger.info(`[SimpleTaskWindow] Attempting focus restoration`, {
        taskId,
        documentHasFocus: document.hasFocus(),
        focusLostDuringWait: focusLostAt !== null,
        focusLostAt,
        inputRefExists: !!inputRef.current,
        quickActionsPanelRefExists: !!quickActionsPanelRef.current,
        activeElementBefore: document.activeElement?.tagName,
      });

      // First, ensure the native window has focus via Tauri command
      // This is necessary because something may steal window focus during the async gap
      try {
        await invoke("focus_simple_task_panel");
        logger.debug(`[SimpleTaskWindow] Native panel focus restored via invoke`);
      } catch (e) {
        logger.warn(`[SimpleTaskWindow] Failed to invoke focus_simple_task_panel`, { error: e });
      }

      // Focus the quick actions panel to enable keyboard navigation
      // We prefer the quick actions panel over input so arrow keys work immediately
      if (quickActionsPanelRef.current) {
        quickActionsPanelRef.current.focus();
      } else {
        // Fallback to input if panel ref not available
        inputRef.current?.focus();
      }

      // Log whether focus was successful
      const activeEl = document.activeElement;
      const focusedQuickActions = activeEl?.closest('[data-quick-actions-panel]') !== null;
      const focusedInput = activeEl?.closest('[data-thread-input]') !== null ||
                          activeEl?.tagName === 'TEXTAREA';

      logger.info(`[SimpleTaskWindow] Focus restoration completed`, {
        taskId,
        documentHasFocus: document.hasFocus(),
        activeElementAfter: document.activeElement?.tagName,
        activeElementId: document.activeElement?.id,
        focusedQuickActions,
        focusedInput,
        focusSucceeded: focusedQuickActions || focusedInput,
      });

      // Clean up listeners after restoration completes
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    }, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [taskId]);

  // Reset selectedIndex when streaming state changes (actions array changes)
  useEffect(() => {
    setSelectedIndex(0);
  }, [isStreaming, setSelectedIndex]);

  const handleSuggestedAction = useCallback(
    async (action: "markUnread" | "archive") => {
      try {
        if (action === "markUnread") {
          await markTaskUnread(taskId);

          // Navigate to next unread task or fallback to tasks panel
          const navigated = await navigateToNextTaskOrFallback({ actionType: 'markUnread' });
          if (!navigated) {
            // Fallback happened, hide the simple task window
            await invoke("hide_simple_task");
          }
        } else if (action === "archive") {
          await archiveTask(taskId);

          // Navigate to next unread task or fallback to tasks panel
          const navigated = await navigateToNextTaskOrFallback({ actionType: 'archive' });
          if (!navigated) {
            // Fallback happened, hide the simple task window
            await invoke("hide_simple_task");
          }
        }
      } catch (error) {
        logger.error(`[SimpleTaskWindow] Failed to ${action} task`, {
          error,
          taskId,
        });
        // TODO: Show error toast
      }
    },
    [taskId, navigateToNextTaskOrFallback]
  );

  const handleQuickAction = useCallback(async (action: ActionType) => {
    if (isProcessing) return;

    setProcessing(action);
    try {
      if (action === "nextTask") {
        const success = await navigateToNextTaskOrFallback({ actionType: 'quickAction' });
        if (!success) {
          logger.info("[SimpleTaskWindow] Navigated to tasks panel as fallback");
        }
      } else if (action === "closeTask") {
        await invoke("hide_simple_task");
      } else if (action === "followUp") {
        setShowFollowUpInput(true);
      } else if (action === "respond") {
        inputRef.current?.focus();
      } else if (action === "markUnread" || action === "archive") {
        // Handle these through the existing handler
        await handleSuggestedAction(action);
      }
    } catch (error) {
      logger.error(`[SimpleTaskWindow] Failed to handle quick action ${action}:`, error);
    } finally {
      setProcessing(null);
    }
  }, [isProcessing, setProcessing, setShowFollowUpInput, navigateToNextTaskOrFallback, handleSuggestedAction]);

  // Global keyboard navigation for quick actions
  useEffect(() => {
    const actions = isStreaming ? streamingActions : defaultActions;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keyboard if there's a modal or follow-up input is active
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
        // If already at the bottom action, focus the input
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
            // Focus the input instead of processing an action
            inputRef.current?.focus();
          } else {
            handleQuickAction(selectedAction.key);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Close the panel when pressing Escape
        invoke("hide_simple_task");
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Any regular character typed - focus input and select respond option
        const respondIndex = actions.findIndex(a => a.key === "respond");
        if (respondIndex !== -1) {
          setSelectedIndex(respondIndex);
        }
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, isStreaming, showFollowUpInput, navigateUp, navigateDown, setSelectedIndex, setShowFollowUpInput, setFollowUpValue, handleQuickAction]);

  const handleToolResponse = useCallback(async (toolId: string, response: string) => {
    if (!workingDirectory) {
      logger.error("[SimpleTaskWindow] Cannot respond: no working directory");
      return;
    }

    try {
      await submitToolResult(taskId, threadId, toolId, response, workingDirectory);
    } catch (error) {
      logger.error("[SimpleTaskWindow] Failed to submit tool response", { error, toolId });
      throw error;
    }
  }, [taskId, threadId, workingDirectory]);


  const handleAutoSelectInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Handle focus transfer from ThreadInput to quick actions panel
  const handleNavigateToQuickActions = useCallback(() => {
    logger.debug(`[SimpleTaskWindow] handleNavigateToQuickActions called`);
    // Focus the quick actions panel so keyboard nav works
    // The document-level keydown listener will handle arrow keys
    if (quickActionsPanelRef.current) {
      quickActionsPanelRef.current.focus();
    }
  }, []);

  const handleWindowDrag = useCallback(async (e: React.MouseEvent) => {
    // Only drag on primary (left) mouse button
    if (e.button !== 0) return;

    // Check if clicking on an interactive element - if so, don't start dragging
    const target = e.target as HTMLElement;
    const interactiveSelector = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';
    if (target.closest(interactiveSelector)) return;

    // Pin the panel - it stays pinned until explicitly hidden
    // This allows users to position the panel and have it stay visible on blur
    try {
      await invoke("pin_simple_task_panel");
      logger.debug("[SimpleTaskWindow] Panel pinned due to drag (will stay pinned until closed)");
    } catch (err) {
      logger.error("[SimpleTaskWindow] Failed to pin panel for drag:", err);
    }

    // Start window drag via Tauri API
    getCurrentWindow().startDragging().catch((err) => {
      console.error("[SimpleTaskWindow] startDragging failed:", err);
    });
  }, []);

  return (
    <div
      className="simple-task-container flex flex-col h-screen text-surface-50 relative overflow-hidden"
      onMouseDown={handleWindowDrag}
      onDoubleClick={(e) => {
        // Close panel on double-click, unless clicking on interactive elements
        const target = e.target as HTMLElement;
        const interactiveSelector = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';
        const isInteractive = target.closest(interactiveSelector);
        if (!isInteractive) {
          invoke("hide_simple_task");
        }
      }}
    >
      <SimpleTaskHeader
        taskId={taskId}
        threadId={threadId}
        status={viewStatus}
        activeView={activeView}
        onToggleView={handleToggleView}
        hasChanges={hasChanges}
      />

      {/* Conditionally render Thread view or Changes tab */}
      {activeView === "thread" ? (
        <>
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ThreadView
              ref={messageListRef}
              messages={messages}
              isStreaming={isStreaming}
              status={viewStatus}
              toolStates={toolStates}
              onToolResponse={handleToolResponse}
            />
          </div>
          {/* Queued messages banner disabled - queueing is temporarily disabled */}
          {/* <QueuedMessagesBanner messages={queuedMessages} /> */}
          <SuggestedActionsPanel
            ref={quickActionsPanelRef}
            threadId={threadId}
            onAction={handleSuggestedAction}
            onAutoSelectInput={handleAutoSelectInput}
            isStreaming={isStreaming}
            onSubmitFollowUp={handleSubmit}
            onQuickAction={handleQuickAction}
          />
          <ThreadInput
            ref={inputRef}
            threadId={threadId}
            onSubmit={handleSubmit}
            disabled={false}
            workingDirectory={workingDirectory}
            placeholder={undefined} // Queueing disabled for now
            onNavigateToQuickActions={handleNavigateToQuickActions}
          />
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeMetadata && (
            <ChangesTab
              threadMetadata={activeMetadata}
              threadState={activeState}
            />
          )}
        </div>
      )}

      {/* <PermissionIndicator threadId={threadId} /> */}

      {/* Navigation banner overlays at bottom */}
      <NavigationBanner />

      {/* Toast for temporary messages - positioned above quick actions panel */}
      {toastMessage && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg shadow-lg border border-amber-500 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toastMessage}
        </div>
      )}

      {/* Visual resize indicator - native resize handle is in this corner */}
      <div
        className="absolute bottom-1 right-1 w-3 h-3 text-surface-600 opacity-50 hover:opacity-100 transition-opacity pointer-events-none"
        aria-hidden="true"
      >
        <svg viewBox="0 0 12 12" fill="currentColor">
          <path d="M10 2L2 10M10 6L6 10M10 10L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}
