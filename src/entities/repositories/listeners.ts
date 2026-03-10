import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { repoService } from "./service.js";
import { useRepoStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup repository event listeners.
 */
export function setupRepositoryListeners(): () => void {
  const handleCreated = async ({ name }: EventPayloads[typeof EventName.REPOSITORY_CREATED]) => {
    try {
      const existing = useRepoStore.getState().repositories[name];
      if (existing) {
        await repoService.refresh(name);
      } else {
        logger.log(`[RepositoryListener] Repo "${name}" not in store, re-hydrating from disk...`);
        await repoService.hydrate();
      }
    } catch (e) {
      logger.error(`[RepositoryListener] Failed to handle created repository ${name}:`, e);
    }
  };

  const handleUpdated = async ({ name }: EventPayloads[typeof EventName.REPOSITORY_UPDATED]) => {
    try {
      await repoService.refresh(name);
    } catch (e) {
      logger.error(`[RepositoryListener] Failed to refresh updated repository ${name}:`, e);
    }
  };

  const handleDeleted = async ({ name }: EventPayloads[typeof EventName.REPOSITORY_DELETED]) => {
    useRepoStore.getState()._applyDelete(name);
  };

  eventBus.on(EventName.REPOSITORY_CREATED, handleCreated);
  eventBus.on(EventName.REPOSITORY_UPDATED, handleUpdated);
  eventBus.on(EventName.REPOSITORY_DELETED, handleDeleted);

  return () => {
    eventBus.off(EventName.REPOSITORY_CREATED, handleCreated);
    eventBus.off(EventName.REPOSITORY_UPDATED, handleUpdated);
    eventBus.off(EventName.REPOSITORY_DELETED, handleDeleted);
  };
}
