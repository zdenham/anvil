import { eventBus, EventName } from "@/entities/events";
import { planService } from "./service";
import { logger } from "@/lib/logger-client";

/**
 * Set up plan event listeners.
 * Called once at app startup to wire up plan detection events.
 */
export function setupPlanListeners(): void {
  eventBus.on(EventName.PLAN_DETECTED, async ({ planId }) => {
    logger.info(`[plans:listener] Plan detected: ${planId}`);
    // Refresh plan from disk - agent already wrote metadata.json
    await planService.refreshById(planId);
  });

  logger.info("[plans:listener] Plan listeners initialized");
}
