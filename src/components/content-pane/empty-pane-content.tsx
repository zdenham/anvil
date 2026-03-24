import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ThreadInputSection } from "@/components/reusable/thread-input-section";
import { GuideContent } from "@/components/content-pane/guide-content";
import { useMRUWorktree } from "@/hooks/use-mru-worktree";
import { createThread } from "@/lib/thread-creation-service";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { useDraftSync, clearCurrentDraft } from "@/hooks/useDraftSync";
import { useInputStore } from "@/stores/input-store";
import { PERMISSION_MODE_CYCLE, type PermissionModeId } from "@core/types/permissions.js";
import { logger } from "@/lib/logger-client";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { createNewProjectAndHydrate } from "@/lib/project-creation-service";

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

  const handleImportProject = useCallback(async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });

      if (selectedPath && typeof selectedPath === "string") {
        const validation = await repoService.validateNewRepository(selectedPath);
        if (!validation.valid) {
          logger.error("[EmptyPaneContent] Invalid repository:", validation.error);
          return;
        }

        await repoService.createFromFolder(selectedPath);
        await repoService.hydrate();

        const repos = repoService.getAll();
        await Promise.all(repos.map((repo) => worktreeService.sync(repo.name)));
        await useRepoWorktreeLookupStore.getState().hydrate();
        await treeMenuService.hydrate();
      }
    } catch (error) {
      logger.error("[EmptyPaneContent] Failed to import project:", error);
    }
  }, []);

  const handleCreateProject = useCallback(async () => {
    try {
      await createNewProjectAndHydrate();
    } catch (error) {
      logger.error("[EmptyPaneContent] Failed to create project:", error);
    }
  }, []);

  // Show message if no repositories configured
  const noRepoConfigured = !isLoading && !mruWorktree;

  return (
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
      {/* Unified guide — shows get-started buttons when no repo configured */}
      <GuideContent
        showGetStarted={noRepoConfigured}
        onImportProject={handleImportProject}
        onCreateProject={handleCreateProject}
      />

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
