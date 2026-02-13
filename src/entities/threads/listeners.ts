import { EventName, EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { useThreadStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup thread event listeners.
 */
export function setupThreadListeners(): void {
  // Optimistic thread creation - creates placeholder in store for immediate UI feedback
  // Will be overwritten by THREAD_CREATED when disk version is available
  eventBus.on(EventName.THREAD_OPTIMISTIC_CREATED, ({ threadId, repoId, worktreeId, prompt, status }: EventPayloads[typeof EventName.THREAD_OPTIMISTIC_CREATED]) => {
    const eventReceivedAt = Date.now();
    try {
      const existingThread = useThreadStore.getState().threads[threadId];
      if (existingThread) {
        logger.info(`[ThreadListener:TIMING] Thread ${threadId} already in store, skipping optimistic create`, {
          threadId,
          timestamp: new Date(eventReceivedAt).toISOString(),
        });
        return;
      }

      logger.info(`[ThreadListener:TIMING] Creating optimistic thread ${threadId}`, {
        threadId,
        hasPrompt: !!prompt,
        promptLength: prompt?.length ?? 0,
        timestamp: new Date(eventReceivedAt).toISOString(),
      });
      threadService.createOptimistic({
        id: threadId,
        repoId,
        worktreeId,
        status,
        prompt,
      });
      logger.info(`[ThreadListener:TIMING] Optimistic thread ${threadId} created in store`, {
        threadId,
        elapsedMs: Date.now() - eventReceivedAt,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.error(`[ThreadListener] Failed to create optimistic thread ${threadId}:`, e);
    }
  });

  // Thread created on disk - refresh from disk (overwrites any optimistic version)
  eventBus.on(EventName.THREAD_CREATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_CREATED]) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh created thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_UPDATED]) => {
    try {
      await threadService.refreshById(threadId);

      // Cascade: refresh ancestor chain so aggregate cost displays update
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh updated thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_STATUS_CHANGED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]) => {
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

  // Agent state updates - refresh metadata (for usage) + state if active thread
  eventBus.on(EventName.AGENT_STATE, async ({ threadId }: EventPayloads[typeof EventName.AGENT_STATE]) => {
    logger.info(`[FC-DEBUG] AGENT_STATE event received`, {
      threadId,
      activeThreadId: useThreadStore.getState().activeThreadId,
      isActiveThread: useThreadStore.getState().activeThreadId === threadId,
    });
    try {
      // Always refresh metadata (usage data lives there now)
      await threadService.refreshById(threadId);

      const store = useThreadStore.getState();
      if (store.activeThreadId === threadId) {
        logger.info(`[FC-DEBUG] Thread is active, calling loadThreadState`);
        await threadService.loadThreadState(threadId);
      } else {
        logger.info(`[FC-DEBUG] Thread is NOT active, skipping loadThreadState`);
      }

      // Cascade: refresh parent so aggregate cost displays update
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread state ${threadId}:`, e);
    }
  });

  // Agent completed - always refresh metadata, only refresh state if active
  eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
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

      // Cascade: refresh parent so aggregate cost displays update
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
    }
  });

  // Thread archived - remove from store
  eventBus.on(EventName.THREAD_ARCHIVED, ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
    try {
      const store = useThreadStore.getState();
      // Remove from store (disk already updated by archive operation)
      if (store.threads[threadId]) {
        store._applyDelete(threadId);
        logger.info(`[ThreadListener] Removed archived thread ${threadId} from store`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to handle thread archive ${threadId}:`, e);
    }
  });

  // Thread name generated - refresh thread metadata to show new name
  eventBus.on(EventName.THREAD_NAME_GENERATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_NAME_GENERATED]) => {
    try {
      await threadService.refreshById(threadId);
      logger.info(`[ThreadListener] Refreshed thread ${threadId} after name generated`);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread after name generated ${threadId}:`, e);
    }
  });

  // Panel hidden - clear active thread to prevent marking threads as read when panel is not visible
  // This allows useMarkThreadAsRead to simply check if the thread is active rather than polling panel visibility
  eventBus.on("panel-hidden", () => {
    const store = useThreadStore.getState();
    if (store.activeThreadId) {
      logger.info(`[ThreadListener] Panel hidden, clearing active thread: ${store.activeThreadId}`);
      store.setActiveThread(null);
    }
  });
}
