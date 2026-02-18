import { useCallback } from "react";
import { ThreadInputSection } from "@/components/reusable/thread-input-section";
import { useMRUWorktree } from "@/hooks/use-mru-worktree";
import { createThread } from "@/lib/thread-creation-service";
import { contentPanesService } from "@/stores/content-panes/service";
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
  const { workingDirectory, repoId, worktreeId, mruWorktree } = useMRUWorktree();

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

      const { threadId } = await createThread({
        prompt,
        repoId,
        worktreeId,
        worktreePath: workingDirectory,
      });

      // Switch view to the new thread
      await contentPanesService.setActivePaneView({ type: "thread", threadId });
    },
    [repoId, worktreeId, workingDirectory]
  );

  // Show message if no repositories configured
  const noRepoConfigured = !mruWorktree;

  return (
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
      {/* Welcome message in main area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-surface-400">
          <h2 className="text-xl font-medium font-mono text-surface-100">
            Welcome to Mort
          </h2>
          {noRepoConfigured ? (
            <p className="text-base mt-2">
              Add a repository to get started
            </p>
          ) : (
            <p className="text-base mt-2">
              Type a message below to get started
            </p>
          )}
        </div>
      </div>

      {/* Input section pinned to bottom */}
      <ThreadInputSection
        onSubmit={handleSubmit}
        workingDirectory={workingDirectory}
        contextType="empty"
        autoFocus
        disabled={noRepoConfigured}
        placeholder={noRepoConfigured ? "Add a repository to get started" : undefined}
      />
    </div>
  );
}
