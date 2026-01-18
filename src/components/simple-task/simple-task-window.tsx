import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { useSimpleTaskParams } from "./use-simple-task-params";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import {
  resumeSimpleAgent,
  submitToolResult,
  sendQueuedMessage,
  confirmQueuedMessage,
  clearPendingQueuedMessages,
} from "@/lib/agent-service";
import { SimpleTaskHeader, type SimpleTaskView } from "./simple-task-header";
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageListRef } from "@/components/thread/message-list";
import { QueuedMessagesBanner } from "./queued-messages-banner";
import { SuggestedActionsPanel } from "./suggested-actions-panel";
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

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

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
  const agentMode = useAgentModeStore((s) => s.getMode(threadId));

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

  // Queued messages state
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuedMessagesRef = useRef(queuedMessages);
  queuedMessagesRef.current = queuedMessages;
  const inputRef = useRef<ThreadInputRef>(null);
  const messageListRef = useRef<MessageListRef>(null);

  // View toggle state: "thread" (default) or "changes"
  const [activeView, setActiveView] = useState<SimpleTaskView>("thread");

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

  const toolStates = activeState?.toolStates ?? {};
  const entityStatus = activeMetadata?.status ?? "idle";
  const workingDirectory = activeMetadata?.workingDirectory ?? "";

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

  const handleSubmit = async (userPrompt: string) => {
    if (!workingDirectory) {
      logger.error("[SimpleTaskWindow] Cannot submit: no working directory");
      return;
    }

    if (canQueueMessages) {
      // Agent is running - queue the message
      try {
        const messageId = await sendQueuedMessage(threadId, userPrompt);
        setQueuedMessages(prev => [...prev, {
          id: messageId,
          content: userPrompt,
          timestamp: Date.now(),
        }]);
      } catch (err) {
        logger.error("[SimpleTaskWindow] Failed to queue message", err);
        // TODO: Show error toast
      }
    } else if (canResumeAgent) {
      // Agent is idle - resume normally
      await resumeSimpleAgent(taskId, threadId, userPrompt, workingDirectory, agentMode);
    } else {
      // Paused or other state - shouldn't happen with current logic
      logger.warn('[SimpleTaskWindow] Cannot submit in current state', { status: viewStatus });
    }
  };

  // Remove queued messages once they appear in conversation
  // NOTE: Content-based matching (SDK doesn't echo message IDs)
  useEffect(() => {
    if (!activeState?.messages) return;

    const processedIds: string[] = [];
    const currentQueued = queuedMessagesRef.current;

    for (const qm of currentQueued) {
      const foundInConversation = activeState.messages.some(m => {
        if (m.role !== 'user') return false;
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? (m.content.find((b: ContentBlockParam) => b.type === 'text') as { text: string } | undefined)?.text
            : '';
        return content === qm.content;
      });

      if (foundInConversation) {
        processedIds.push(qm.id);
        confirmQueuedMessage(qm.id);
      }
    }

    if (processedIds.length > 0) {
      setQueuedMessages(prev => prev.filter(qm => !processedIds.includes(qm.id)));
    }
  }, [activeState?.messages]);

  // Clear pending queued messages on unmount
  useEffect(() => {
    return () => {
      clearPendingQueuedMessages(threadId);
    };
  }, [threadId]);

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

  const handleWindowDrag = useCallback((e: React.MouseEvent) => {
    // Only drag on primary (left) mouse button
    if (e.button !== 0) return;

    // Check if clicking on an interactive element - if so, don't start dragging
    const target = e.target as HTMLElement;
    const interactiveSelector = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';
    if (target.closest(interactiveSelector)) return;

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
          <QueuedMessagesBanner messages={queuedMessages} />
          <SuggestedActionsPanel
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
            placeholder={canQueueMessages ? "Queue a message..." : undefined}
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
