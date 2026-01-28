import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "@/entities/events";
import { contentPanesService } from "./service";
import { useContentPanesStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Setup content panes event listeners.
 * Handles THREAD_ARCHIVED and PLAN_ARCHIVED events to clear panes showing archived content.
 */
export function setupContentPanesListeners(): void {
  // Thread archived - clear any pane showing this thread
  eventBus.on(EventName.THREAD_ARCHIVED, ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
    try {
      const store = useContentPanesStore.getState();

      // Find panes displaying this thread
      for (const [paneId, pane] of Object.entries(store.panes)) {
        if (pane.view.type === "thread" && pane.view.threadId === threadId) {
          // Clear the pane view
          contentPanesService.setPaneView(paneId, { type: "empty" });
          logger.info(`[ContentPanesListener] Cleared pane ${paneId} (archived thread ${threadId})`);
        }
      }
    } catch (e) {
      logger.error(`[ContentPanesListener] Failed to handle thread archive ${threadId}:`, e);
    }
  });

  // Plan archived - clear any pane showing this plan
  eventBus.on(EventName.PLAN_ARCHIVED, ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
    try {
      const store = useContentPanesStore.getState();

      // Find panes displaying this plan
      for (const [paneId, pane] of Object.entries(store.panes)) {
        if (pane.view.type === "plan" && pane.view.planId === planId) {
          // Clear the pane view
          contentPanesService.setPaneView(paneId, { type: "empty" });
          logger.info(`[ContentPanesListener] Cleared pane ${paneId} (archived plan ${planId})`);
        }
      }
    } catch (e) {
      logger.error(`[ContentPanesListener] Failed to handle plan archive ${planId}:`, e);
    }
  });

  logger.debug("[ContentPanesListener] Content panes listeners initialized");
}
