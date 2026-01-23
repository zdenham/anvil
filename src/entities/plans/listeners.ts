import { eventBus, EventName, EventPayloads } from "@/entities/events";
import { planService } from "./service";
import { usePlanStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Set up plan event listeners.
 * Called once at app startup to wire up plan detection events.
 */
export function setupPlanListeners(): void {
  logger.info("[plans:listener] 📋 Registering plan listeners...");

  // Handle plan detection from agent
  eventBus.on(EventName.PLAN_DETECTED, async ({ planId }) => {
    logger.info(`[plans:listener] 📋 PLAN_DETECTED handler called! planId=${planId}`);
    // Refresh plan from disk - agent already wrote metadata.json
    try {
      await planService.refreshById(planId);
      logger.info(`[plans:listener] 📋 Plan refreshed successfully: ${planId}`);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to refresh plan ${planId}:`, err);
    }
  });

  // Handle plan updates (including mark as read) for cross-window sync
  eventBus.on(EventName.PLAN_UPDATED, async ({ planId }) => {
    logger.debug(`[plans:listener] 📋 PLAN_UPDATED received for: ${planId}`);
    try {
      await planService.refreshById(planId);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to refresh plan ${planId}:`, err);
    }
  });

  // Handle plan archived - remove from store (for cross-window sync)
  eventBus.on(EventName.PLAN_ARCHIVED, ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
    try {
      const store = usePlanStore.getState();
      // Remove from store (disk already updated by archive operation)
      if (store.plans[planId]) {
        store._applyDelete(planId);
        logger.info(`[plans:listener] 📋 Removed archived plan ${planId} from store`);
      }
    } catch (e) {
      logger.error(`[plans:listener] 📋 Failed to handle plan archive ${planId}:`, e);
    }
  });

  logger.info("[plans:listener] 📋 Plan listeners initialized");
}
