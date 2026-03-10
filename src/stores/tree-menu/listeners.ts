import { EventName } from "@core/types/events.js";
import { eventBus } from "@/entities/events";
import { treeMenuService } from "./service";
import { useRepoWorktreeLookupStore } from "../repo-worktree-lookup-store";
import { logger } from "@/lib/logger-client";

/**
 * Setup tree menu event listeners.
 * Events trigger disk re-reads to ensure consistency across windows.
 */
export function setupTreeMenuListeners(): () => void {
  const handleThreadCreated = async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread created:", e);
    }
  };

  const handleThreadUpdated = async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread updated:", e);
    }
  };

  const handleThreadStatusChanged = async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread status changed:", e);
    }
  };

  const handlePlanUpdated = async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on plan updated:", e);
    }
  };

  const handleRepoCreated = async () => {
    try {
      await useRepoWorktreeLookupStore.getState().hydrate();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh repo lookup on create:", e);
    }
  };

  const handleRepoUpdated = async () => {
    try {
      await useRepoWorktreeLookupStore.getState().hydrate();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh repo lookup:", e);
    }
  };

  eventBus.on(EventName.THREAD_CREATED, handleThreadCreated);
  eventBus.on(EventName.THREAD_UPDATED, handleThreadUpdated);
  eventBus.on(EventName.THREAD_STATUS_CHANGED, handleThreadStatusChanged);
  eventBus.on(EventName.PLAN_UPDATED, handlePlanUpdated);
  eventBus.on(EventName.REPOSITORY_CREATED, handleRepoCreated);
  eventBus.on(EventName.REPOSITORY_UPDATED, handleRepoUpdated);

  logger.debug("[TreeMenuListener] Tree menu listeners initialized");

  return () => {
    eventBus.off(EventName.THREAD_CREATED, handleThreadCreated);
    eventBus.off(EventName.THREAD_UPDATED, handleThreadUpdated);
    eventBus.off(EventName.THREAD_STATUS_CHANGED, handleThreadStatusChanged);
    eventBus.off(EventName.PLAN_UPDATED, handlePlanUpdated);
    eventBus.off(EventName.REPOSITORY_CREATED, handleRepoCreated);
    eventBus.off(EventName.REPOSITORY_UPDATED, handleRepoUpdated);
  };
}
