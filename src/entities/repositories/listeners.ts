import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { repoService } from "./service.js";
import { useRepoStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup repository event listeners.
 */
export function setupRepositoryListeners(): void {
  eventBus.on(EventName.REPOSITORY_CREATED, async ({ name }) => {
    try {
      // Check if repo exists in store (same-window creation)
      const existing = useRepoStore.getState().repositories[name];
      if (existing) {
        await repoService.refresh(name);
      } else {
        // Cross-window creation: repo doesn't exist in our store yet
        // Re-hydrate from disk to pick up the new repo
        logger.log(`[RepositoryListener] Repo "${name}" not in store, re-hydrating from disk...`);
        await repoService.hydrate();
      }
    } catch (e) {
      logger.error(`[RepositoryListener] Failed to handle created repository ${name}:`, e);
    }
  });

  eventBus.on(EventName.REPOSITORY_UPDATED, async ({ name }) => {
    try {
      await repoService.refresh(name);
    } catch (e) {
      logger.error(`[RepositoryListener] Failed to refresh updated repository ${name}:`, e);
    }
  });

  eventBus.on(EventName.REPOSITORY_DELETED, async ({ name }) => {
    useRepoStore.getState()._applyDelete(name);
  });
}
