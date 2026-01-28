import { EventName, EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { worktreeService } from "./service.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup worktree event listeners.
 */
export function setupWorktreeListeners(): void {
  // Worktree name generated - rename the worktree when AI generates a name
  eventBus.on(EventName.WORKTREE_NAME_GENERATED, async ({ worktreeId, repoId, name }: EventPayloads[typeof EventName.WORKTREE_NAME_GENERATED]) => {
    try {
      // The worktreeId is the current name (identifier) of the worktree
      // The repoId is the repository name
      // The name is the new generated name to assign
      await worktreeService.rename(repoId, worktreeId, name);
      logger.info(`[WorktreeListener] Renamed worktree "${worktreeId}" to "${name}" in repo "${repoId}"`);
    } catch (error) {
      // Non-blocking - log and continue
      // This could fail if the worktree was deleted before rename, or due to name conflicts
      logger.error(`[WorktreeListener] Failed to rename worktree "${worktreeId}" to "${name}":`, error);
    }
  });
}
