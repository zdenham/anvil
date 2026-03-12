import { useCallback, useState } from "react";
import { ThreadInputSection } from "@/components/reusable/thread-input-section";
import { GuideContent } from "@/components/content-pane/guide-content";
import { useMRUWorktree } from "@/hooks/use-mru-worktree";
import { createThread } from "@/lib/thread-creation-service";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { useDraftSync, clearCurrentDraft } from "@/hooks/useDraftSync";
import { useInputStore } from "@/stores/input-store";
import { PERMISSION_MODE_CYCLE, type PermissionModeId } from "@core/types/permissions.js";
import { logger } from "@/lib/logger-client";

/**
 * EmptyPaneContent
 *
 * Displayed when a content pane has no content selected.
 * Shows a welcome message and provides input for creating new threads.
 *
 * Features:
 * - ThreadInput for submitting prompts
 * - QuickActionsPanel for quick actions
 * - Uses MRU worktree for thread creation
 */
export function EmptyPaneContent() {
  const { workingDirectory, repoId, worktreeId, mruWorktree, isLoading } = useMRUWorktree();

  // Draft sync — save/restore input drafts for empty state
  useDraftSync({ type: 'empty' });
  const clearContent = useInputStore((s) => s.clearContent);

  // Permission mode for the thread that will be created
  const [permissionMode, setPermissionMode] = useState<PermissionModeId>("implement");
  const handleCycleMode = useCallback(() => {
    setPermissionMode((current) => {
      const idx = PERMISSION_MODE_CYCLE.indexOf(current);
      return PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
    });
  }, []);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      if (!repoId || !worktreeId || !workingDirectory) {
        logger.error("[EmptyPaneContent] Cannot create thread: no repository configured", {
          repoId,
          worktreeId,
          workingDirectory,
        });
        // TODO: Show error toast or prompt user to add a repository
        return;
      }

      logger.info("[EmptyPaneContent] Creating thread", {
        repoId,
        worktreeId,
        workingDirectory,
        promptLength: prompt.length,
      });

      // Clear the persisted draft on send
      clearCurrentDraft({ type: 'empty' }, clearContent);

      const { threadId } = await createThread({
        prompt,
        repoId,
        worktreeId,
        worktreePath: workingDirectory,
        permissionMode,
      });

      // Switch view to the new thread
      await paneLayoutService.setActiveTabView({ type: "thread", threadId });
    },
    [repoId, worktreeId, workingDirectory, clearContent, permissionMode]
  );

  // Show message if no repositories configured
  const noRepoConfigured = !isLoading && !mruWorktree;

  return (
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
      {/* Guide content or fallback message */}
      {noRepoConfigured ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-surface-400">
            <h2 className="text-xl font-medium font-mono text-surface-100">
              Welcome to Mort
            </h2>
            <p className="text-base mt-2">
              Add a project to get started
            </p>
          </div>
        </div>
      ) : (
        <GuideContent />
      )}

      {/* Input section pinned to bottom */}
      <ThreadInputSection
        onSubmit={handleSubmit}
        workingDirectory={workingDirectory}
        contextType="empty"
        autoFocus
        disabled={noRepoConfigured}
        placeholder={noRepoConfigured ? "Add a project to get started" : undefined}
        permissionMode={permissionMode}
        onCycleMode={handleCycleMode}
      />
    </div>
  );
}
