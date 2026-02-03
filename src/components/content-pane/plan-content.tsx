/**
 * PlanContent
 *
 * Self-contained plan viewer for embedding in content panes.
 * Shows plan markdown with quick actions and thread creation.
 *
 * Key responsibilities:
 * - Load plan from store (with disk refresh fallback)
 * - Load plan content via usePlanContent hook
 * - Render markdown content
 * - Handle stale plan state
 * - Provide quick actions for archive/unread/respond
 * - Handle "respond" by creating new thread
 *
 * IMPORTANT: This component NEVER writes directly to stores.
 * All mutations go through services (planService, threadService, etc.)
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { planService, usePlanStore } from "@/entities/plans";
import { MarkdownRenderer } from "@/components/thread/markdown-renderer";
import { StalePlanView } from "@/components/control-panel/stale-plan-view";
import {
  SuggestedActionsPanel,
  type SuggestedActionsPanelRef,
} from "./suggested-actions-panel";
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
import {
  useQuickActionsStore,
  planDefaultActions,
  type ActionType,
} from "@/stores/quick-actions-store";
import { useRepoStore } from "@/entities/repositories";
import { loadSettings } from "@/lib/persistence";
import { spawnSimpleAgent } from "@/lib/agent-service";
import { useNavigateToNextItem } from "@/hooks/use-navigate-to-next-item";
import { useContextAwareNavigation } from "@/hooks/use-context-aware-navigation";
import { useMarkPlanAsRead } from "@/entities/plans/use-mark-plan-as-read";
import { usePlanContent } from "@/entities/plans/hooks/use-plan-content";
import { logger } from "@/lib/logger-client";
import type { PlanContentProps } from "./types";

export function PlanContent({ planId, onPopOut: _onPopOut }: PlanContentProps) {
  // Note: onPopOut is available for future use (pop-out functionality wired in Phase 4)
  void _onPopOut;
  const plan = usePlanStore(useCallback((s) => s.getPlan(planId), [planId]));
  const { content, isLoading: isContentLoading, isStale } = usePlanContent(planId);
  const quickActionsPanelRef = useRef<SuggestedActionsPanelRef>(null);
  const inputRef = useRef<ThreadInputRef>(null);

  // State for refresh tracking (cross-window sync)
  const [refreshResult, setRefreshResult] = useState<
    "pending" | "found" | "not-found"
  >("pending");

  // Working directory for the plan's repository
  const [workingDirectory, setWorkingDirectory] = useState<string | undefined>(
    undefined
  );

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

  // Context-aware navigation (main window vs control panel)
  const { navigateToThread } = useContextAwareNavigation();

  // Reset quick actions state when planId changes
  useEffect(() => {
    resetState();
  }, [planId, resetState]);

  // Reset refresh state when planId changes
  useEffect(() => {
    setRefreshResult("pending");
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
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        try {
          const settings = await loadSettings(slug);
          if (settings.id === plan.repoId) {
            // Find the worktree by matching worktreeId
            const worktree = settings.worktrees.find(
              (wt) => wt.id === plan.worktreeId
            );
            const dir = worktree?.path ?? settings.sourcePath;
            setWorkingDirectory(dir);
            return;
          }
        } catch (err) {
          // Skip repos that fail to load
          logger.debug(
            `[PlanContent] Failed to load settings for ${name}:`,
            err
          );
          continue;
        }
      }

      // Fallback: no matching repo found
      logger.warn(`[PlanContent] No repo found for repoId: ${plan.repoId}`);
      setWorkingDirectory(undefined);
    };

    resolveWorkingDir();
  }, [plan?.id, plan?.repoId, plan?.worktreeId]);

  // Refresh plan from disk if not in store (handles cross-window sync)
  useEffect(() => {
    if (!planId) return;

    // Plan already in store - mark as found
    if (plan) {
      setRefreshResult("found");
      return;
    }

    // Already resolved (either found or not-found)
    if (refreshResult !== "pending") return;

    const currentPlanId = planId;
    logger.info(
      `[PlanContent] Plan ${currentPlanId} not in store, attempting refresh from disk`
    );

    async function refreshPlan() {
      try {
        await planService.refreshById(currentPlanId);
        const refreshedPlan = usePlanStore.getState().getPlan(currentPlanId);
        if (refreshedPlan) {
          setRefreshResult("found");
        } else {
          logger.info(
            `[PlanContent] Plan ${currentPlanId} not found after refresh`
          );
          setRefreshResult("not-found");
        }
      } catch (err) {
        logger.error(
          `[PlanContent] Failed to refresh plan ${currentPlanId}:`,
          err
        );
        setRefreshResult("not-found");
      }
    }

    refreshPlan();
  }, [planId, plan, refreshResult]);

  // Focus restoration on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      quickActionsPanelRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [planId]);

  const handleQuickAction = useCallback(
    async (action: ActionType) => {
      if (isProcessing) return;

      setProcessing(action);
      const currentItem = { type: "plan" as const, id: planId };

      try {
        if (action === "archive") {
          await planService.archive(planId, null);
          await navigateToNextItemOrFallback(currentItem, {
            actionType: "archive",
          });
        } else if (action === "markUnread") {
          await planService.markAsUnread(planId);
          await navigateToNextItemOrFallback(currentItem, {
            actionType: "markUnread",
          });
        } else if (action === "respond") {
          // Focus the message input
          inputRef.current?.focus();
        } else if (action === "closePanel") {
          // In content pane context, "close panel" is a no-op
          // Parent handles this via onClose prop
          logger.info("[PlanContent] closePanel action - no-op in content pane");
        }
      } catch (error) {
        logger.error(
          `[PlanContent] Failed to handle quick action ${action}:`,
          error
        );
      } finally {
        setProcessing(null);
      }
    },
    [planId, isProcessing, setProcessing, navigateToNextItemOrFallback]
  );

  // Legacy action handler - routes to handleQuickAction
  const handleLegacyAction = useCallback(
    async (action: "markUnread" | "archive") => {
      await handleQuickAction(action);
    },
    [handleQuickAction]
  );

  // Handle message submission from ThreadInput - creates a new thread with plan context
  const handleMessageSubmit = useCallback(
    async (userMessage: string) => {
      if (!workingDirectory || !plan) {
        logger.error(
          "[PlanContent] Cannot submit: missing workingDirectory or plan"
        );
        return;
      }

      // Prefix message with @ and the plan's relative path for context
      const messageWithContext = `@${plan.relativePath} ${userMessage}`;

      // Generate new thread ID
      const threadId = crypto.randomUUID();

      // Navigate to the new thread (context-aware: same pane in main window, control panel otherwise)
      await navigateToThread(threadId);

      // Spawn agent with the new thread
      await spawnSimpleAgent({
        repoId: plan.repoId,
        worktreeId: plan.worktreeId,
        threadId,
        prompt: messageWithContext,
        sourcePath: workingDirectory,
      });
    },
    [plan, workingDirectory, navigateToThread]
  );

  // Handle focus transfer from ThreadInput to quick actions panel
  const handleNavigateToQuickActions = useCallback(() => {
    quickActionsPanelRef.current?.expand();
    quickActionsPanelRef.current?.focus();
  }, []);

  // Handle clicks on "respond" action - focus the input
  const handleAutoSelectInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Global keyboard navigation for quick actions
  useEffect(() => {
    const actions = planDefaultActions;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if input is focused - let it handle its own keys
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.tagName === "INPUT"
      ) {
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
            inputRef.current?.focus();
          } else {
            handleQuickAction(selectedAction.key);
          }
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Any regular character typed auto-focuses input
        const respondIndex = actions.findIndex((a) => a.key === "respond");
        if (respondIndex !== -1) {
          setSelectedIndex(respondIndex);
        }
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, navigateUp, navigateDown, handleQuickAction, setSelectedIndex]);

  // Still resolving whether plan exists - return null to avoid any flash
  if (refreshResult === "pending") {
    return null;
  }

  // Plan confirmed not found
  if (refreshResult === "not-found") {
    return (
      <div className="flex flex-col h-full text-surface-50 relative overflow-hidden">
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
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 min-h-0 overflow-y-auto w-full pt-8">
        <div key={planId} className="w-full max-w-[900px] mx-auto p-4">
          {isContentLoading ? null : isStale || content === null ? (
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

      {/* Quick actions and input */}
      <div className="flex-shrink-0 w-full max-w-[900px] mx-auto">
        <SuggestedActionsPanel
          ref={quickActionsPanelRef}
          view={{ type: "plan", planId }}
          onAction={handleLegacyAction}
          isStreaming={false}
          onQuickAction={handleQuickAction}
          onAutoSelectInput={handleAutoSelectInput}
        />

        {/* Message input */}
        <ThreadInput
          ref={inputRef}
          onSubmit={handleMessageSubmit}
          disabled={false}
          workingDirectory={workingDirectory}
          placeholder="Type a message to start a thread about this plan..."
          onNavigateToQuickActions={handleNavigateToQuickActions}
        />
      </div>
    </div>
  );
}
