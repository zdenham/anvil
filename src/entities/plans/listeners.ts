import { eventBus, EventName, type EventPayloads } from "@/entities/events";
import { planService } from "./service";
import { usePlanStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Set up plan event listeners.
 * Called once at app startup to wire up plan detection events.
 */
export function setupPlanListeners(): () => void {
  const handleDetected = async ({ planId }: EventPayloads[typeof EventName.PLAN_DETECTED]) => {
    logger.info(`[plans:listener] 📋 PLAN_DETECTED handler called! planId=${planId}`);
    try {
      await planService.refreshById(planId);
      await planService.refreshSinglePlanParent(planId);
      logger.info(`[plans:listener] 📋 Plan refreshed successfully: ${planId}`);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to refresh plan ${planId}:`, err);
    }
  };

  const handleCreated = async ({ planId }: EventPayloads[typeof EventName.PLAN_CREATED]) => {
    logger.debug(`[plans:listener] 📋 PLAN_CREATED received for: ${planId}`);
    try {
      await planService.refreshSinglePlanParent(planId);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to handle plan creation ${planId}:`, err);
    }
  };

  const handleUpdated = async ({ planId }: EventPayloads[typeof EventName.PLAN_UPDATED]) => {
    logger.debug(`[plans:listener] 📋 PLAN_UPDATED received for: ${planId}`);
    try {
      await planService.refreshById(planId);
    } catch (err) {
      logger.error(`[plans:listener] 📋 Failed to refresh plan ${planId}:`, err);
    }
  };

  const handleArchived = async ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
    try {
      const store = usePlanStore.getState();
      const plan = store.plans[planId];
      const parentId = plan?.parentId;

      if (plan) {
        store._applyDelete(planId);
        logger.info(`[plans:listener] 📋 Removed archived plan ${planId} from store`);

        if (parentId) {
          await planService.updateFolderStatus(parentId);
        }
      }
    } catch (e) {
      logger.error(`[plans:listener] 📋 Failed to handle plan archive ${planId}:`, e);
    }
  };

  eventBus.on(EventName.PLAN_DETECTED, handleDetected);
  eventBus.on(EventName.PLAN_CREATED, handleCreated);
  eventBus.on(EventName.PLAN_UPDATED, handleUpdated);
  eventBus.on(EventName.PLAN_ARCHIVED, handleArchived);

  logger.info("[plans:listener] 📋 Plan listeners initialized");

  return () => {
    eventBus.off(EventName.PLAN_DETECTED, handleDetected);
    eventBus.off(EventName.PLAN_CREATED, handleCreated);
    eventBus.off(EventName.PLAN_UPDATED, handleUpdated);
    eventBus.off(EventName.PLAN_ARCHIVED, handleArchived);
  };
}
