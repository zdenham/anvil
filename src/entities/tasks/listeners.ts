import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { taskService } from "./service.js";
import { useTaskStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup task event listeners.
 * Each listener refreshes from disk (source of truth) then store updates.
 */
export function setupTaskListeners(): void {
  logger.log("[TaskListener] Setting up task event listeners...");

  eventBus.on(EventName.TASK_CREATED, async ({ taskId }) => {
    logger.log(`[TaskListener] TASK_CREATED event received for ${taskId}`);
    try {
      await taskService.refreshTask(taskId);
      logger.log(`[TaskListener] Successfully refreshed created task ${taskId}`);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh created task ${taskId}:`, e);
    }
  });

  eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
    logger.log(`[TaskListener] TASK_UPDATED event received for ${taskId}`);
    try {
      await taskService.refreshTask(taskId);
      logger.log(`[TaskListener] Successfully refreshed updated task ${taskId}`);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh updated task ${taskId}:`, e);
    }
  });

  eventBus.on(EventName.TASK_DELETED, async ({ taskId }) => {
    logger.log(`[TaskListener] TASK_DELETED event received for ${taskId}`);
    useTaskStore.getState()._applyDelete(taskId);
    logger.log(`[TaskListener] Successfully deleted task ${taskId} from store`);
  });

  eventBus.on(EventName.TASK_STATUS_CHANGED, async ({ taskId }) => {
    logger.log(`[TaskListener] TASK_STATUS_CHANGED event received for ${taskId}`);
    try {
      await taskService.refreshTask(taskId);
      logger.log(`[TaskListener] Successfully refreshed task status ${taskId}`);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh task status ${taskId}:`, e);
    }
  });

  eventBus.on(EventName.TASK_MARKED_UNREAD, async ({ taskId }) => {
    logger.log(`[TaskListener] TASK_MARKED_UNREAD event received for ${taskId}`);
    try {
      // Refresh task to get updated sortOrder and trigger UI updates
      await taskService.refreshTask(taskId);
      logger.log(`[TaskListener] Successfully refreshed unread task ${taskId}`);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh unread task ${taskId}:`, e);
    }
  });

  logger.log("[TaskListener] Task event listeners setup complete");
}
