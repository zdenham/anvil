import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import { X } from "lucide-react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { useControlPanelParams } from "./use-control-panel-params";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import {
  resumeSimpleAgent,
  sendQueuedMessage,
} from "@/lib/agent-service";
import { ControlPanelHeader } from "./control-panel-header";
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageListRef } from "@/components/thread/message-list";
import { ChangesTab } from "./changes-tab";
import { PlanView } from "./plan-view";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";
import { useMarkThreadAsRead } from "@/hooks/use-mark-thread-as-read";
import { useWorkingDirectory } from "@/hooks/use-working-directory";
import { useWindowDrag } from "@/hooks/use-window-drag";
import { useNavigateToNextItem } from "@/hooks/use-navigate-to-next-item";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NavigationBanner } from "./navigation-banner";

import { QuickActionsPanel } from "@/components/quick-actions/quick-actions-panel";
import { useQuickActionsStore, defaultActions, streamingActions, type ActionType } from "@/stores/quick-actions-store";

import { closeCurrentPanelOrWindow } from "@/lib/panel-navigation";
import { eventBus, type ControlPanelViewType } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import type { WindowConfig } from "@/control-panel-main";

/** Map entity ThreadStatus to ThreadView's expected status type */
type ViewStatus = "idle" | "loading" | "running" | "completed" | "error" | "cancelled";

/** Thread tab state - local to thread view only */
type ThreadTab = "conversation" | "changes";

interface LoadingViewProps {
  message: string;
  isStandaloneWindow?: boolean;
  instanceId?: string | null;
}

/**
 * Loading view that preserves drag and close behavior while params are loading.
 */
function LoadingView({ message, isStandaloneWindow = false, instanceId }: LoadingViewProps) {
  // Window drag behavior via reusable hook
  const { dragProps } = useWindowDrag({
    pinCommand: isStandaloneWindow ? undefined : "pin_control_panel",
    hideCommand: isStandaloneWindow && instanceId ? undefined : "hide_control_panel",
    enableDoubleClickClose: !isStandaloneWindow,
  });

  const handleClose = useCallback(async () => {
    if (isStandaloneWindow && instanceId) {
      await invoke("close_control_panel_window", { instanceId });
    } else {
      await invoke("hide_control_panel");
    }
  }, [isStandaloneWindow, instanceId]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  return (
    <div
      className={cn(
        "flex flex-col h-screen bg-surface-900 text-surface-500 text-sm",
        !isStandaloneWindow && dragProps.className
      )}
      onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
      onDoubleClick={!isStandaloneWindow ? dragProps.onDoubleClick : undefined}
    >
      {/* Header with close button */}
      <div
        className="flex items-center justify-end px-4 py-3 bg-surface-800 border-b border-surface-700"
        data-drag-region="header"
      >
        {!isStandaloneWindow && (
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Close panel (Escape)"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {/* Centered message */}
      <div className="flex-1 flex items-center justify-center">
        {message}
      </div>
    </div>
  );
}

interface ControlPanelWindowProps {
  /** Window configuration - determines if this is an NSPanel or standalone window */
  windowConfig?: WindowConfig;
}

export function ControlPanelWindow({ windowConfig }: ControlPanelWindowProps) {
  const params = useControlPanelParams(windowConfig);
  // For loading state before params are available, derive from windowConfig directly
  const isStandaloneWindowFromConfig = windowConfig?.type === "window";

  if (!params) {
    return (
      <LoadingView
        message="Loading..."
        isStandaloneWindow={isStandaloneWindowFromConfig}
        instanceId={windowConfig?.instanceId}
      />
    );
  }

  // Get view from params - either the new discriminated union or build from legacy fields
  const view: ControlPanelViewType | null = params.view ?? (params.threadId ? { type: "thread", threadId: params.threadId } : null);

  if (!view) {
    return (
      <LoadingView
        message="No view specified"
        isStandaloneWindow={params.isStandaloneWindow}
        instanceId={params.instanceId}
      />
    );
  }

  // Render based on view type
  if (view.type === "plan") {
    return (
      <PlanView
        planId={view.planId}
        isStandaloneWindow={params.isStandaloneWindow}
        instanceId={params.instanceId}
      />
    );
  }

  // Thread view with local tab management
  return (
    <ControlPanelWindowContent
      threadId={view.threadId}
      prompt={params.prompt}
      isStandaloneWindow={params.isStandaloneWindow}
      instanceId={params.instanceId}
    />
  );
}

interface ControlPanelWindowContentProps {
  threadId: string;
  prompt?: string;
  isStandaloneWindow?: boolean;
  instanceId?: string | null;
}

/**
 * Inner component that renders once params are available.
 * Separated to allow hooks to be called unconditionally.
 */
function ControlPanelWindowContent({
  threadId,
  prompt,
  isStandaloneWindow = false,
  instanceId,
}: ControlPanelWindowContentProps) {
  // Use useCallback to ensure Zustand creates a new subscription when threadId changes
  // Without this, the selector closure captures the old threadId and doesn't re-evaluate
  // See: plans/thread-display-stale-bug.md for full diagnosis
  const activeState = useThreadStore(
    useCallback((s) => s.threadStates[threadId], [threadId])
  );
  const activeMetadata = useThreadStore(
    useCallback((s) => s.threads[threadId], [threadId])
  );
  const isLoadingThreadState = useThreadStore((s) => s.activeThreadLoading);

  // Handle marking thread as read when viewed or completed
  // Only marks as read when this thread is the active thread (panel-hidden clears activeThreadId)
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
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledOnMount = useRef(false);

  // Window drag behavior via reusable hook
  // Only use custom drag for NSPanel, standalone windows use native decorations
  const { dragProps } = useWindowDrag({
    pinCommand: isStandaloneWindow ? undefined : "pin_control_panel",
    hideCommand: isStandaloneWindow && instanceId
      ? undefined  // Standalone windows don't hide on double-click
      : "hide_control_panel",
    enableDoubleClickClose: !isStandaloneWindow,
  });

  // Navigation hook for quick action next item
  const { navigateToNextItemOrFallback } = useNavigateToNextItem();

  // Local tab state for thread view only - two-way toggle between conversation and changes
  const [threadTab, setThreadTab] = useState<ThreadTab>("conversation");

  // Toast state for "coming soon" messages
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Set this thread as active so AGENT_STATE events update the store
  // Also refresh thread from disk if not in store (handles cross-window sync)
  useEffect(() => {
    logger.debug(`[ControlPanelWindow] useEffect FIRED for threadId: ${threadId}`);
    logger.info(`[ControlPanelWindow] useEffect: Setting active thread: ${threadId}`);

    const initThread = async () => {
      // If thread is not in store, refresh from disk first
      // This handles the case where another window created the thread
      const threadExists = !!useThreadStore.getState().threads[threadId];
      logger.info(`[ControlPanelWindow] Thread exists in store: ${threadExists}`);

      if (!threadExists) {
        logger.info(`[ControlPanelWindow] Thread not in store, refreshing from disk...`);
        await threadService.refreshById(threadId);
        const afterRefresh = !!useThreadStore.getState().threads[threadId];
        logger.info(`[ControlPanelWindow] After refresh, thread exists: ${afterRefresh}`);
      }

      // Now set as active and load state
      threadService.setActiveThread(threadId);
    };

    initThread().catch((err) => {
      logger.error(`[ControlPanelWindow] Failed to init thread:`, err);
    });
  }, [threadId]);

  const toolStates = useMemo(() => activeState?.toolStates ?? {}, [activeState?.toolStates]);
  const entityStatus = activeMetadata?.status ?? "idle";
  // Derive working directory from thread's worktreeId via repo settings
  const workingDirectory = useWorkingDirectory(activeMetadata);
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
      logger.error("[ControlPanelWindow] Cannot submit: no working directory");
      return;
    }

    // Queue message if agent is currently running
    if (canQueueMessages) {
      try {
        await sendQueuedMessage(threadId, userPrompt);
        // No toast needed - the banner provides visual feedback
      } catch (error) {
        logger.error('[ControlPanelWindow] Failed to queue message:', error);
        showToast("Failed to queue message");
      }
      return;
    }

    // Switch to conversation tab when submitting a message
    setThreadTab("conversation");

    if (canResumeAgent) {
      await resumeSimpleAgent(threadId, userPrompt, workingDirectory);
    } else {
      // Paused or other state - shouldn't happen with current logic
      logger.warn('[ControlPanelWindow] Cannot submit in current state', { status: viewStatus });
    }
  };

  // NOTE: QUEUED_MESSAGE_ACK handling is now done in agent-service.ts
  // which updates the Zustand store directly. No local state or event
  // listener needed here - the store is the single source of truth.

  // Pin panel when resized - NSPanel specific behavior
  // Standalone windows are already independent and don't need pinning
  useEffect(() => {
    // Skip for standalone windows - pinning is only for NSPanel
    if (isStandaloneWindow) return;

    const currentWindow = getCurrentWindow();
    let hasPinned = false;

    const handleResize = async () => {
      // Only need to pin once - panel stays pinned until hidden
      if (!hasPinned) {
        try {
          await invoke("pin_control_panel");
          hasPinned = true;
          logger.debug("[ControlPanelWindow] Panel pinned due to resize (will stay pinned until closed)");
        } catch (err) {
          logger.error("[ControlPanelWindow] Failed to pin panel for resize:", err);
        }
      }
    };

    // Listen to Tauri window resize events
    const unlisten = currentWindow.onResized(handleResize);

    return () => {
      unlisten.then((unlistenFn) => unlistenFn());
    };
  }, [isStandaloneWindow]);

  // Reset scroll tracking when threadId changes (navigating to a different thread)
  useEffect(() => {
    hasScrolledOnMount.current = false;
  }, [threadId]);

  // Auto-scroll to bottom ONLY on initial mount when opening panel with messages
  useEffect(() => {
    if (!hasScrolledOnMount.current && messages.length > 0 && messageListRef.current) {
      hasScrolledOnMount.current = true;
      // Small delay to ensure the DOM has rendered the messages
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

  // Focus the container on mount so keyboard nav works immediately
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Reset thread tab to conversation when navigating to a different thread
  useEffect(() => {
    setThreadTab("conversation");
  }, [threadId]);

  // Listen for thread archive events to close standalone window when its thread is archived
  useEffect(() => {
    if (!isStandaloneWindow || !instanceId) return;

    const handleThreadArchived = (payload: { threadId: string; originInstanceId?: string | null }) => {
      // Skip if we're the window that initiated the archive (we navigate instead of closing)
      if (payload.originInstanceId === instanceId) return;

      // Close if this window's thread was archived (from another window or main window)
      if (payload.threadId === threadId) {
        logger.info(`[ControlPanelWindow] Thread ${threadId} archived from another window, closing standalone window ${instanceId}`);
        getCurrentWindow().close();
      }
    };

    eventBus.on(EventName.THREAD_ARCHIVED, handleThreadArchived);
    return () => {
      eventBus.off(EventName.THREAD_ARCHIVED, handleThreadArchived);
    };
  }, [isStandaloneWindow, instanceId, threadId]);

  // Focus restoration after thread navigation
  // This ensures keyboard navigation works after thread actions
  useEffect(() => {
    const initialFocus = document.hasFocus();
    logger.info(`[ControlPanelWindow] Focus restoration effect triggered`, {
      threadId,
      documentHasFocus: initialFocus,
      activeElement: document.activeElement?.tagName,
      activeElementId: document.activeElement?.id,
    });

    // Track focus changes during the restoration window to diagnose focus theft
    let focusLostAt: number | null = null;
    const handleBlur = () => {
      focusLostAt = Date.now();
      logger.warn(`[ControlPanelWindow] Window BLUR detected during focus restoration window`, {
        threadId,
        timestamp: focusLostAt,
        documentHasFocus: document.hasFocus(),
      });
    };
    const handleFocus = () => {
      logger.info(`[ControlPanelWindow] Window FOCUS detected during focus restoration window`, {
        threadId,
        timestamp: Date.now(),
        focusLostAt,
        documentHasFocus: document.hasFocus(),
      });
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    // Short delay to ensure DOM is ready after thread change
    const timer = setTimeout(async () => {
      // Log state before attempting focus
      logger.info(`[ControlPanelWindow] Attempting focus restoration`, {
        threadId,
        documentHasFocus: document.hasFocus(),
        focusLostDuringWait: focusLostAt !== null,
        focusLostAt,
        inputRefExists: !!inputRef.current,
        containerRefExists: !!containerRef.current,
        activeElementBefore: document.activeElement?.tagName,
      });

      // First, ensure the native window has focus via Tauri command
      // This is necessary because something may steal window focus during the async gap
      try {
        await invoke("focus_control_panel");
        logger.debug(`[ControlPanelWindow] Native panel focus restored via invoke`);
      } catch (e) {
        logger.warn(`[ControlPanelWindow] Failed to invoke focus_control_panel`, { error: e });
      }

      // Focus the container to enable keyboard navigation
      if (containerRef.current) {
        containerRef.current.focus();
      } else {
        // Final fallback to input if refs not available
        inputRef.current?.focus();
      }

      // Log whether focus was successful
      const activeEl = document.activeElement;
      const focusedContainer = activeEl === containerRef.current;
      const focusedInput = activeEl?.closest('[data-thread-input]') !== null ||
                          activeEl?.tagName === 'TEXTAREA';

      logger.info(`[ControlPanelWindow] Focus restoration completed`, {
        threadId,
        documentHasFocus: document.hasFocus(),
        activeElementAfter: document.activeElement?.tagName,
        activeElementId: document.activeElement?.id,
        focusedContainer,
        focusedInput,
        focusSucceeded: focusedContainer || focusedInput,
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
  }, [threadId]);

  // Reset selectedIndex when streaming state changes (actions array changes)
  useEffect(() => {
    setSelectedIndex(0);
  }, [isStreaming, setSelectedIndex]);

  const handleQuickAction = useCallback(async (action: ActionType) => {
    if (isProcessing) return;

    setProcessing(action);
    const currentItem = { type: "thread" as const, id: threadId };

    try {
      if (action === "nextItem") {
        // Navigate to next unread item
        await navigateToNextItemOrFallback(currentItem, { actionType: "nextItem" });
      } else if (action === "closePanel") {
        await closeCurrentPanelOrWindow();
      } else if (action === "followUp") {
        setShowFollowUpInput(true);
      } else if (action === "respond") {
        inputRef.current?.focus();
      } else if (action === "archive") {
        await threadService.archive(threadId, instanceId);
        await navigateToNextItemOrFallback(currentItem, { actionType: "archive" });
      } else if (action === "markUnread") {
        await useThreadStore.getState().markThreadAsUnread(threadId);
        await navigateToNextItemOrFallback(currentItem, { actionType: "markUnread" });
      }
    } catch (error) {
      logger.error(`[ControlPanelWindow] Failed to handle quick action ${action}:`, error);
    } finally {
      setProcessing(null);
    }
  }, [isProcessing, setProcessing, setShowFollowUpInput, threadId, navigateToNextItemOrFallback]);


  // Keyboard navigation for quick actions - scoped to control panel container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const actions = isStreaming ? streamingActions : defaultActions;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keyboard if there's a modal or follow-up input is active
      if (showFollowUpInput) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowFollowUpInput(false);
          setFollowUpValue("");
          containerRef.current?.focus(); // Restore focus to container
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
        // Close the panel/window when pressing Escape
        closeCurrentPanelOrWindow();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Any regular character typed - focus input and select respond option
        const respondIndex = actions.findIndex(a => a.key === "respond");
        if (respondIndex !== -1) {
          setSelectedIndex(respondIndex);
        }
        inputRef.current?.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, isStreaming, showFollowUpInput, navigateUp, navigateDown, setSelectedIndex, setShowFollowUpInput, setFollowUpValue, handleQuickAction]);


  // Handle focus transfer from ThreadInput to container for keyboard nav
  const handleNavigateToQuickActions = useCallback(() => {
    logger.debug(`[ControlPanelWindow] handleNavigateToQuickActions called`);
    // Focus the container so keyboard nav works
    containerRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={cn(
        "control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden outline-none",
        // NSPanel uses custom JS drag, standalone windows use native title bar
        !isStandaloneWindow && dragProps.className,
        isStandaloneWindow && "standalone-window"
      )}
      onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
      onDoubleClick={!isStandaloneWindow ? dragProps.onDoubleClick : undefined}
    >
      <ControlPanelHeader
        view={{ type: "thread", threadId }}
        threadTab={threadTab}
        onThreadTabChange={setThreadTab}
        isStreaming={isStreaming}
        isStandaloneWindow={isStandaloneWindow}
        instanceId={instanceId}
      />

      {/* Main content area - only one tab visible at a time */}
      {/* Max width constraint centered for readability on wide screens */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col w-full">
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col w-full max-w-[900px] mx-auto">
          {threadTab === "conversation" && (
            <ThreadView
              key={threadId}  // Force re-mount when switching threads to reset internal state
              ref={messageListRef}
              threadId={threadId}
              messages={messages}
              isStreaming={isStreaming}
              status={viewStatus}
              toolStates={toolStates}
            />
          )}

          {threadTab === "changes" && activeMetadata && (
            <ChangesTab
              threadMetadata={activeMetadata}
              threadState={activeState}
              isLoadingThreadState={isLoadingThreadState}
            />
          )}
        </div>
      </div>

      {/* Quick actions and input - always visible */}
      {/* Max width constraint centered for readability on wide screens */}
      <div className="w-full max-w-[900px] mx-auto px-2.5">
        <QuickActionsPanel contextType="thread" />
        {/* Wrap input with visual indicator when in queue mode */}
        <div className={cn(
          "relative",
          canQueueMessages && "ring-1 ring-amber-500/30 ring-inset"
        )}>
          <ThreadInput
            ref={inputRef}
            onSubmit={handleSubmit}
            disabled={false}
            workingDirectory={workingDirectory}
            placeholder={canQueueMessages ? "Queue a follow-up message..." : undefined}
            onNavigateToQuickActions={handleNavigateToQuickActions}
          />
        </div>
      </div>

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
