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
      // Refresh parent relationship for this plan (handles nested directories)
      await planService.refreshSinglePlanParent(planId);
      logger.info(`[plans:listener] 📋 Plan refreshed successfully: ${planId}`);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to refresh plan ${planId}:`, err);
    }
  });

  // Handle plan creation - update parent's folder status
  eventBus.on(EventName.PLAN_CREATED, async ({ planId }) => {
    logger.debug(`[plans:listener] 📋 PLAN_CREATED received for: ${planId}`);
    try {
      // Refresh parent relationship and update parent's folder status
      await planService.refreshSinglePlanParent(planId);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to handle plan creation ${planId}:`, err);
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

  // Handle plan archived - remove from store and update parent's folder status
  eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
    try {
      const store = usePlanStore.getState();
      const plan = store.plans[planId];
      const parentId = plan?.parentId;

      // Remove from store (disk already updated by archive operation)
      if (plan) {
        store._applyDelete(planId);
        logger.info(`[plans:listener] 📋 Removed archived plan ${planId} from store`);

        // Update parent's folder status since it lost a child
        if (parentId) {
          await planService.updateFolderStatus(parentId);
        }
      }
    } catch (e) {
      logger.error(`[plans:listener] 📋 Failed to handle plan archive ${planId}:`, e);
    }
  });

  logger.info("[plans:listener] 📋 Plan listeners initialized");
}
