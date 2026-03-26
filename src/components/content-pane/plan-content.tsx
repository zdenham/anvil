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
import { TiptapEditor } from "@/components/content-pane/tiptap-editor";
import { FilesystemClient } from "@/lib/filesystem-client";
import { StalePlanView } from "@/components/control-panel/stale-plan-view";
import { type ThreadInputRef } from "@/components/reusable/thread-input";
import { ThreadInputSection } from "@/components/reusable/thread-input-section";
import { useRepoStore } from "@/entities/repositories";
import { loadSettings } from "@/lib/app-data-store";
import { spawnSimpleAgent } from "@/lib/agent-service";
import { useContextAwareNavigation } from "@/hooks/use-context-aware-navigation";
import { useMarkPlanAsRead } from "@/entities/plans/use-mark-plan-as-read";
import { usePlanContent } from "@/entities/plans/hooks/use-plan-content";
import { useDraftSync, clearCurrentDraft } from "@/hooks/useDraftSync";
import { useInputStore } from "@/stores/input-store";
import { logger } from "@/lib/logger-client";
import { PERMISSION_MODE_CYCLE, type PermissionModeId } from "@core/types/permissions.js";
import type { PlanContentProps } from "./types";

export function PlanContent({ planId, onPopOut: _onPopOut }: PlanContentProps) {
  // Note: onPopOut is available for future use (pop-out functionality wired in Phase 4)
  void _onPopOut;
  const plan = usePlanStore(useCallback((s) => s.getPlan(planId), [planId]));
  const { content, isLoading: isContentLoading, isStale } = usePlanContent(planId);
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

  // Draft sync — save/restore input drafts for plan context
  useDraftSync({ type: 'plan', id: planId });
  const clearContent = useInputStore((s) => s.clearContent);

  // Context-aware navigation (main window vs control panel)
  const { navigateToThread } = useContextAwareNavigation();

  // Local permission mode for the thread that will be created
  const [permissionMode, setPermissionMode] = useState<PermissionModeId>("implement");
  const handleCycleMode = useCallback(() => {
    setPermissionMode((current) => {
      const idx = PERMISSION_MODE_CYCLE.indexOf(current);
      return PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
    });
  }, []);

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

  // Handle saving plan content to disk
  const handlePlanSave = useCallback(
    async (markdown: string) => {
      if (!workingDirectory || !plan) return;
      const fullPath = `${workingDirectory}/${plan.relativePath}`;
      try {
        const fs = new FilesystemClient();
        await fs.writeFile(fullPath, markdown);
      } catch (err) {
        logger.error("[PlanContent] Failed to save plan:", err);
      }
    },
    [workingDirectory, plan]
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

      // Clear the persisted draft on send
      clearCurrentDraft({ type: 'plan', id: planId }, clearContent);

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
        permissionMode,
      });
    },
    [plan, workingDirectory, navigateToThread, permissionMode, planId, clearContent]
  );

  // Still resolving whether plan exists - return null to avoid any flash
  if (refreshResult === "pending") {
    return null;
  }

  // Plan confirmed not found
  if (refreshResult === "not-found") {
    return (
      <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
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
    <div data-testid="plan-content-pane" className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
      {/* Main content area */}
      {isContentLoading ? (
        <div className="flex-1 min-h-0" />
      ) : isStale || content === null ? (
        <div className="flex-1 min-h-0 overflow-y-auto w-full pt-8">
          <div className="w-full max-w-[900px] mx-auto p-4">
            <StalePlanView plan={plan} />
          </div>
        </div>
      ) : content.trim() === "" ? (
        <div className="flex-1 min-h-0 overflow-y-auto w-full pt-8">
          <div className="flex items-center justify-center h-full text-surface-400 text-sm">
            This plan is empty
          </div>
        </div>
      ) : (
        <TiptapEditor
          key={planId}
          initialContent={content}
          onSave={handlePlanSave}
          onChange={handlePlanSave}
        />
      )}

      {/* Quick actions and input */}
      <ThreadInputSection
        ref={inputRef}
        onSubmit={handleMessageSubmit}
        workingDirectory={workingDirectory ?? null}
        contextType="plan"
        placeholder="Type a message to start a thread about this plan..."
        permissionMode={permissionMode}
        onCycleMode={handleCycleMode}
        autoFocus
      />
    </div>
  );
}
