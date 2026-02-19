/**
 * Plan View Component
 *
 * Displays plan content in the control panel.
 * Single view showing:
 * - Plan header with name and close button
 * - Rendered markdown content (read-only)
 * - Plan metadata (created date, related threads count)
 * - Quick actions panel (create thread, edit, delete)
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { planService, usePlanStore } from "@/entities/plans";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import { useWindowDrag } from "@/hooks/use-window-drag";
import { usePlanContent } from "@/hooks/use-plan-content";
import { useMarkPlanAsRead } from "@/entities/plans/use-mark-plan-as-read";
import { MarkdownRenderer } from "@/components/thread/markdown-renderer";
import { ControlPanelHeader } from "./control-panel-header";
import { StalePlanView } from "./stale-plan-view";
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
import { useQuickActionsStore, planDefaultActions, type ActionType } from "@/stores/quick-actions-store";
import { useRepoStore } from "@/entities/repositories";
import { loadSettings } from "@/lib/app-data-store";
import { spawnSimpleAgent } from "@/lib/agent-service";
import { closeCurrentPanelOrWindow } from "@/lib/panel-navigation";
import { useNavigateToNextItem } from "@/hooks/use-navigate-to-next-item";
import { InputStoreProvider } from "@/stores/input-store";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";

interface PlanViewProps {
  planId: string;
  isStandaloneWindow?: boolean;
  instanceId?: string | null;
}

export function PlanView({ planId, isStandaloneWindow = false, instanceId }: PlanViewProps) {
  const plan = usePlanStore(
    useCallback((s) => s.getPlan(planId), [planId])
  );
  const { content, isLoading: isContentLoading, isStale } = usePlanContent(planId);
  const inputRef = useRef<ThreadInputRef>(null);

  // State for refresh tracking (cross-window sync)
  // 'pending' = haven't tried yet, 'found' = plan exists, 'not-found' = plan doesn't exist
  const [refreshResult, setRefreshResult] = useState<'pending' | 'found' | 'not-found'>('pending');

  // Working directory for the plan's repository
  const [workingDirectory, setWorkingDirectory] = useState<string | undefined>(undefined);

  // Window drag behavior via reusable hook
  // Only use custom drag for NSPanel, standalone windows use native decorations
  const { dragProps } = useWindowDrag({
    pinCommand: isStandaloneWindow ? undefined : "pin_control_panel",
    hideCommand: isStandaloneWindow ? undefined : "hide_control_panel",
    enableDoubleClickClose: !isStandaloneWindow,
  });

  // Mark plan as read when viewed
  useMarkPlanAsRead(planId);

  // Quick actions store for keyboard navigation
  const {
    selectedIndex,
    isProcessing,
    setProcessing,
    setSelectedIndex,
    resetState,
    navigateUp,
    navigateDown,
  } = useQuickActionsStore();

  // Navigation hook for quick action next item
  const { navigateToNextItemOrFallback } = useNavigateToNextItem();

  // Reset quick actions state when planId changes
  useEffect(() => {
    resetState();
  }, [planId, resetState]);

  // Reset refresh state when planId changes
  useEffect(() => {
    setRefreshResult('pending');
  }, [planId]);

  // Resolve working directory from plan's repoId/worktreeId
  useEffect(() => {
    if (!plan) {
      setWorkingDirectory(undefined);
      return;
    }

    const resolveWorkingDir = async () => {
      const repoNames = useRepoStore.getState().getRepositoryNames();

      for (const name of repoNames) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        try {
          const settings = await loadSettings(slug);
          if (settings.id === plan.repoId) {
            // Find the worktree by matching worktreeId
            const worktree = settings.worktrees.find((wt) => wt.id === plan.worktreeId);
            const dir = worktree?.path ?? settings.sourcePath;
            setWorkingDirectory(dir);
            return;
          }
        } catch (err) {
          // Skip repos that fail to load
          logger.debug(`[PlanView] Failed to load settings for ${name}:`, err);
          continue;
        }
      }

      // Fallback: no matching repo found
      logger.warn(`[PlanView] No repo found for repoId: ${plan.repoId}`);
      setWorkingDirectory(undefined);
    };

    resolveWorkingDir();
  }, [plan?.id, plan?.repoId, plan?.worktreeId]);

  // Refresh plan from disk if not in store (handles cross-window sync and late hydration)
  useEffect(() => {
    if (!planId) return;

    // Plan already in store - mark as found
    if (plan) {
      setRefreshResult('found');
      return;
    }

    // Already resolved (either found or not-found)
    if (refreshResult !== 'pending') return;

    const currentPlanId = planId;
    logger.info(`[PlanView] Plan ${currentPlanId} not in store, attempting refresh from disk`);

    async function refreshPlan() {
      try {
        await planService.refreshById(currentPlanId);
        const refreshedPlan = usePlanStore.getState().getPlan(currentPlanId);
        if (refreshedPlan) {
          setRefreshResult('found');
        } else {
          logger.info(`[PlanView] Plan ${currentPlanId} not found after refresh`);
          setRefreshResult('not-found');
        }
      } catch (err) {
        logger.error(`[PlanView] Failed to refresh plan ${currentPlanId}:`, err);
        setRefreshResult('not-found');
      }
    }

    refreshPlan();
  }, [planId, plan, refreshResult]);

  // Focus restoration on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [planId]);

  // Listen for plan archive events to close standalone window when its plan is archived
  useEffect(() => {
    if (!isStandaloneWindow || !instanceId) return;

    const handlePlanArchived = (payload: { planId: string; originInstanceId?: string | null }) => {
      // Skip if we're the window that initiated the archive (we navigate instead of closing)
      if (payload.originInstanceId === instanceId) return;

      // Close if this window's plan was archived (from another window or main window)
      if (payload.planId === planId) {
        logger.info(`[PlanView] Plan ${planId} archived from another window, closing standalone window ${instanceId}`);
        getCurrentWindow().close();
      }
    };

    eventBus.on(EventName.PLAN_ARCHIVED, handlePlanArchived);
    return () => {
      eventBus.off(EventName.PLAN_ARCHIVED, handlePlanArchived);
    };
  }, [isStandaloneWindow, instanceId, planId]);

  const handleQuickAction = useCallback(async (action: ActionType) => {
    if (isProcessing) return;

    setProcessing(action);
    const currentItem = { type: "plan" as const, id: planId };

    try {
      if (action === "archive") {
        await planService.archive(planId, instanceId);
        await navigateToNextItemOrFallback(currentItem, { actionType: "archive" });
      } else if (action === "markUnread") {
        await planService.markAsUnread(planId);
        await navigateToNextItemOrFallback(currentItem, { actionType: "markUnread" });
      } else if (action === "respond") {
        // Focus the message input
        inputRef.current?.focus();
      } else if (action === "closePanel") {
        await closeCurrentPanelOrWindow();
      }
    } catch (error) {
      logger.error(`[PlanView] Failed to handle quick action ${action}:`, error);
    } finally {
      setProcessing(null);
    }
  }, [planId, isProcessing, setProcessing, navigateToNextItemOrFallback]);


  // Handle message submission from ThreadInput - creates a new thread with plan context
  const handleMessageSubmit = useCallback(async (userMessage: string) => {
    if (!workingDirectory || !plan) {
      logger.error("[PlanView] Cannot submit: missing workingDirectory or plan");
      return;
    }

    // Prefix message with @ and the plan's relative path for context
    const messageWithContext = `@${plan.relativePath} ${userMessage}`;

    // Generate new thread ID
    const threadId = crypto.randomUUID();

    // Open control panel with the new thread
    await invoke("open_control_panel", {
      threadId,
      taskId: threadId, // Use same ID for task
      prompt: messageWithContext,
    });

    // Spawn agent with the new thread
    await spawnSimpleAgent({
      repoId: plan.repoId,
      worktreeId: plan.worktreeId,
      threadId,
      prompt: messageWithContext,
      sourcePath: workingDirectory,
    });
  }, [plan, workingDirectory]);

  // Handle focus transfer from ThreadInput - no-op since we removed quick actions panel
  const handleNavigateToQuickActions = useCallback(() => {
    // Focus is handled by keyboard navigation in the main component
  }, []);

  // Global keyboard navigation for quick actions
  useEffect(() => {
    const actions = planDefaultActions;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if input is focused - let it handle its own keys
      const activeElement = document.activeElement;
      if (activeElement?.tagName === "TEXTAREA" || activeElement?.tagName === "INPUT") {
        return;
      }

      // Handle arrow keys
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateUp(actions.length);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateDown(actions.length);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedAction = actions[selectedIndex];
        if (selectedAction) {
          if (selectedAction.key === "respond") {
            // Focus input instead of executing respond action
            inputRef.current?.focus();
          } else {
            handleQuickAction(selectedAction.key);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeCurrentPanelOrWindow();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Any regular character typed auto-focuses input
        // This enables "type to do something else" - user can just start typing
        const respondIndex = actions.findIndex(a => a.key === "respond");
        if (respondIndex !== -1) {
          setSelectedIndex(respondIndex); // Visual feedback: highlight "respond"
        }
        inputRef.current?.focus(); // Focus captures the typed character
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, navigateUp, navigateDown, handleQuickAction, setSelectedIndex]);

  // Still resolving whether plan exists - return null to avoid any flash
  if (refreshResult === 'pending') {
    return null;
  }

  // Plan confirmed not found
  if (refreshResult === 'not-found') {
    return (
      <div
        className={cn(
          "control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden",
          !isStandaloneWindow && dragProps.className,
          isStandaloneWindow && "standalone-window"
        )}
        onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
        onDoubleClick={!isStandaloneWindow ? dragProps.onDoubleClick : undefined}
      >
        <ControlPanelHeader
          view={{ type: "plan", planId }}
          isStandaloneWindow={isStandaloneWindow}
          instanceId={instanceId}
        />
        <div className="flex items-center justify-center flex-1 text-surface-400">
          Plan not found
        </div>
      </div>
    );
  }

  // Edge case: refresh says found but store subscription hasn't updated yet
  if (!plan) {
    return null;
  }

  return (
    <div
      className={cn(
        "control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden",
        !isStandaloneWindow && dragProps.className,
        isStandaloneWindow && "standalone-window"
      )}
      onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
      onDoubleClick={!isStandaloneWindow ? dragProps.onDoubleClick : undefined}
    >
      <ControlPanelHeader
        view={{ type: "plan", planId }}
        isStandaloneWindow={isStandaloneWindow}
        instanceId={instanceId}
      />

      {/* Main content area */}
      {/* Max width constraint centered for readability on wide screens */}
      <div className="flex-1 min-h-0 overflow-y-auto w-full">
        <div key={planId} className="w-full max-w-[900px] mx-auto p-4 pt-[100px]">
          {isContentLoading ? (
            null  // Show blank during loading to avoid stale content flash
          ) : isStale || content === null ? (
            <StalePlanView plan={plan} />
          ) : content.trim() === "" ? (
            <div className="flex items-center justify-center h-full text-surface-400 text-sm">
              This plan is empty
            </div>
          ) : (
            <MarkdownRenderer content={content} />
          )}
        </div>
      </div>

      {/* Message input */}
      {/* Max width constraint centered for readability on wide screens */}
      <InputStoreProvider>
        <div className="w-full max-w-[900px] mx-auto px-2.5">
          <ThreadInput
            ref={inputRef}
            onSubmit={handleMessageSubmit}
            disabled={false}
            workingDirectory={workingDirectory}
            placeholder="Type a message to start a thread about this plan..."
            onNavigateToQuickActions={handleNavigateToQuickActions}
          />
        </div>
      </InputStoreProvider>
    </div>
  );
}
