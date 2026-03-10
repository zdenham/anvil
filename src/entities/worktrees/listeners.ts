import { EventName, EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { logger } from "@/lib/logger-client.js";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store.js";
import { terminalSessionService } from "@/entities/terminal-sessions/service.js";
import { worktreeService } from "./service.js";

/**
 * Setup worktree event listeners.
 */
export function setupWorktreeListeners(): () => void {
  const handleNameGenerated = async ({ worktreeId, repoId, name }: EventPayloads[typeof EventName.WORKTREE_NAME_GENERATED]) => {
    logger.info(`[WorktreeListener] Received worktree:name:generated event for "${worktreeId}" -> "${name}" in repo "${repoId}"`);
    try {
      await useRepoWorktreeLookupStore.getState().hydrate();
      logger.info(`[WorktreeListener] UI refreshed for worktree "${worktreeId}" renamed to "${name}"`);
    } catch (error) {
      logger.error(`[WorktreeListener] Failed to refresh UI after worktree rename:`, error);
    }
  };

  const handleSynced = async ({ repoId }: EventPayloads[typeof EventName.WORKTREE_SYNCED]) => {
    logger.info(`[WorktreeListener] Received worktree:synced event for repo "${repoId}", syncing worktrees`);
    try {
      const repoName = useRepoWorktreeLookupStore.getState().getRepoName(repoId);
      if (repoName === "Unknown") {
        logger.warn(`[WorktreeListener] Cannot sync: unknown repo ${repoId}`);
        return;
      }
      await worktreeService.sync(repoName, false);
      await useRepoWorktreeLookupStore.getState().hydrate();

      const repo = useRepoWorktreeLookupStore.getState().repos.get(repoId);
      if (repo) {
        const worktrees: Array<{ worktreeId: string; worktreePath: string }> = [];
        for (const [wtId, wtInfo] of repo.worktrees) {
          if (wtInfo.path) {
            worktrees.push({ worktreeId: wtId, worktreePath: wtInfo.path });
          }
        }
        await terminalSessionService.ensureTerminalsForWorktrees(worktrees);
      }

      logger.info(`[WorktreeListener] Sidebar re-hydrated after worktree sync for repo "${repoId}"`);
    } catch (error) {
      logger.error(`[WorktreeListener] Failed to sync worktrees after worktree:synced event:`, error);
    }
  };

  eventBus.on(EventName.WORKTREE_NAME_GENERATED, handleNameGenerated);
  eventBus.on(EventName.WORKTREE_SYNCED, handleSynced);

  return () => {
    eventBus.off(EventName.WORKTREE_NAME_GENERATED, handleNameGenerated);
    eventBus.off(EventName.WORKTREE_SYNCED, handleSynced);
  };
}
