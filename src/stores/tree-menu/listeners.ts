import { EventName } from "@core/types/events.js";
import { eventBus } from "@/entities/events";
import { treeMenuService } from "./service";
import { useRepoWorktreeLookupStore } from "../repo-worktree-lookup-store";
import { logger } from "@/lib/logger-client";

/**
 * Setup tree menu event listeners.
 * Events trigger disk re-reads to ensure consistency across windows.
 */
export function setupTreeMenuListeners(): void {
  // Thread events - tree structure may have changed
  eventBus.on(EventName.THREAD_CREATED, async () => {
    try {
      // Thread store handles the thread data - we just need to ensure our
      // UI state is fresh if another window modified it
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread created:", e);
    }
  });

  eventBus.on(EventName.THREAD_UPDATED, async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread updated:", e);
    }
  });

  eventBus.on(EventName.THREAD_STATUS_CHANGED, async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread status changed:", e);
    }
  });

  // Plan events - tree structure may have changed
  eventBus.on(EventName.PLAN_UPDATED, async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on plan updated:", e);
    }
  });

  // Repository events - repo/worktree lookup needs refresh
  eventBus.on(EventName.REPOSITORY_CREATED, async () => {
    try {
      // Refresh the lookup cache when a new repository is added
      await useRepoWorktreeLookupStore.getState().hydrate();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh repo lookup on create:", e);
    }
  });

  eventBus.on(EventName.REPOSITORY_UPDATED, async () => {
    try {
      // Refresh the lookup cache when repository settings change
      await useRepoWorktreeLookupStore.getState().hydrate();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh repo lookup:", e);
    }
  });

  logger.debug("[TreeMenuListener] Tree menu listeners initialized");
}
