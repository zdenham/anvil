import { EventName, EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { logger } from "@/lib/logger-client.js";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store.js";

/**
 * Setup worktree event listeners.
 */
export function setupWorktreeListeners(): void {
  // Worktree name generated - refresh UI when AI generates a name
  // NOTE: The agent writes the name to disk directly before emitting this event.
  // This listener just refreshes the UI by re-hydrating from disk.
  eventBus.on(EventName.WORKTREE_NAME_GENERATED, async ({ worktreeId, repoId, name }: EventPayloads[typeof EventName.WORKTREE_NAME_GENERATED]) => {
    logger.info(`[WorktreeListener] Received worktree:name:generated event for "${worktreeId}" -> "${name}" in repo "${repoId}"`);
    try {
      // Refresh the UI by re-hydrating the lookup store from disk
      await useRepoWorktreeLookupStore.getState().hydrate();
      logger.info(`[WorktreeListener] UI refreshed for worktree "${worktreeId}" renamed to "${name}"`);
    } catch (error) {
      logger.error(`[WorktreeListener] Failed to refresh UI after worktree rename:`, error);
    }
  });
}
