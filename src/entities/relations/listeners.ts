import { eventBus } from "../events";
import { EventName, type EventPayloads } from "@core/types/events.js";
import { relationService } from "./service";
import { planService } from "../plans/service";
import { logger } from "@/lib/logger-client";

/**
 * Set up event listeners for automatic relation management.
 *
 * The agent runner writes relations directly to disk. These listeners:
 * - Refresh relations from disk when threads/plans are updated
 * - Archive relations when threads/plans are archived
 * - Mark plans as unread when relations are created/upgraded to 'modified'
 */
export function setupRelationListeners(): () => void {
  const handleThreadUpdated = async ({ threadId }: EventPayloads[typeof EventName.THREAD_UPDATED]) => {
    logger.debug(`[relations:listeners] THREAD_UPDATED: refreshing relations for ${threadId}`);
    await relationService.refreshByThread(threadId);
  };

  const handlePlanUpdated = async ({ planId }: EventPayloads[typeof EventName.PLAN_UPDATED]) => {
    logger.debug(`[relations:listeners] PLAN_UPDATED: refreshing relations for ${planId}`);
    await relationService.refreshByPlan(planId);
  };

  const handleRelationCreated = async ({ planId, threadId, type }: EventPayloads[typeof EventName.RELATION_CREATED]) => {
    logger.debug(`[relations:listeners] RELATION_CREATED: ${planId}-${threadId} (${type})`);
    await relationService.refreshByThread(threadId);
    if (type === 'modified') {
      logger.debug(`[relations:listeners] RELATION_CREATED (modified): marking plan ${planId} as unread`);
      await planService.markAsUnread(planId);
    }
  };

  const handleThreadArchived = async ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
    logger.debug(`[relations:listeners] THREAD_ARCHIVED: ${threadId}`);
    await relationService.archiveByThread(threadId);
  };

  const handlePlanArchived = async ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
    logger.debug(`[relations:listeners] PLAN_ARCHIVED: ${planId}`);
    await relationService.archiveByPlan(planId);
  };

  const handleRelationUpdated = async ({ planId, type, previousType }: EventPayloads[typeof EventName.RELATION_UPDATED]) => {
    if (type === 'modified' && previousType !== 'modified') {
      logger.debug(`[relations:listeners] RELATION_UPDATED (upgraded to modified): marking plan ${planId} as unread`);
      await planService.markAsUnread(planId);
    }
  };

  eventBus.on(EventName.THREAD_UPDATED, handleThreadUpdated);
  eventBus.on(EventName.PLAN_UPDATED, handlePlanUpdated);
  eventBus.on(EventName.RELATION_CREATED, handleRelationCreated);
  eventBus.on(EventName.THREAD_ARCHIVED, handleThreadArchived);
  eventBus.on(EventName.PLAN_ARCHIVED, handlePlanArchived);
  eventBus.on(EventName.RELATION_UPDATED, handleRelationUpdated);

  logger.log("[relations:listeners] Relation listeners initialized");

  return () => {
    eventBus.off(EventName.THREAD_UPDATED, handleThreadUpdated);
    eventBus.off(EventName.PLAN_UPDATED, handlePlanUpdated);
    eventBus.off(EventName.RELATION_CREATED, handleRelationCreated);
    eventBus.off(EventName.THREAD_ARCHIVED, handleThreadArchived);
    eventBus.off(EventName.PLAN_ARCHIVED, handlePlanArchived);
    eventBus.off(EventName.RELATION_UPDATED, handleRelationUpdated);
  };
}
