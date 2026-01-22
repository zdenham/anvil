import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { useThreadStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup thread event listeners.
 */
export function setupThreadListeners(): void {
  eventBus.on(EventName.THREAD_CREATED, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh created thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh updated thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_STATUS_CHANGED, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);

      // Mark thread as unread when it transitions to running status
      const thread = threadService.get(threadId);
      if (thread?.status === "running") {
        await useThreadStore.getState().markThreadAsUnread(threadId);
        logger.info(`[ThreadListener] Marked thread ${threadId} as unread (status: running)`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread status ${threadId}:`, e);
    }
  });

  // Agent state updates - only refresh state if this is the active thread
  eventBus.on(EventName.AGENT_STATE, async ({ threadId }) => {
    logger.info(`[FC-DEBUG] AGENT_STATE event received`, {
      threadId,
      activeThreadId: useThreadStore.getState().activeThreadId,
      isActiveThread: useThreadStore.getState().activeThreadId === threadId,
    });
    try {
      const store = useThreadStore.getState();
      if (store.activeThreadId === threadId) {
        logger.info(`[FC-DEBUG] Thread is active, calling loadThreadState`);
        await threadService.loadThreadState(threadId);
      } else {
        logger.info(`[FC-DEBUG] Thread is NOT active, skipping loadThreadState`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread state ${threadId}:`, e);
    }
  });

  // Agent completed - always refresh metadata, only refresh state if active
  eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }) => {
    try {
      const store = useThreadStore.getState();
      // Always refresh metadata (lightweight)
      await threadService.refreshById(threadId);

      // Mark thread as unread when it completes (user needs to see the results)
      await store.markThreadAsUnread(threadId);
      logger.info(`[ThreadListener] Marked thread ${threadId} as unread (agent completed)`);

      // Only refresh state if this is the active thread
      if (store.activeThreadId === threadId) {
        await threadService.loadThreadState(threadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
    }
  });
}
