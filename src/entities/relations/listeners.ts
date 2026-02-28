import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
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
export function setupRelationListeners(): void {
  // When thread is updated (e.g., refreshed from disk), refresh its relations
  eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
    logger.debug(`[relations:listeners] THREAD_UPDATED: refreshing relations for ${threadId}`);
    await relationService.refreshByThread(threadId);
  });

  // When plan is updated (e.g., refreshed from disk), refresh its relations
  eventBus.on(EventName.PLAN_UPDATED, async ({ planId }) => {
    logger.debug(`[relations:listeners] PLAN_UPDATED: refreshing relations for ${planId}`);
    await relationService.refreshByPlan(planId);
  });

  // When a relation is created (emitted by agent), refresh from disk and mark unread if modified
  eventBus.on(EventName.RELATION_CREATED, async ({ planId, threadId, type }) => {
    logger.debug(`[relations:listeners] RELATION_CREATED: ${planId}-${threadId} (${type})`);
    // Refresh by thread to pick up the new relation from disk
    await relationService.refreshByThread(threadId);
    // Mark plan as unread if this was a modification
    if (type === 'modified') {
      logger.debug(`[relations:listeners] RELATION_CREATED (modified): marking plan ${planId} as unread`);
      await planService.markAsUnread(planId);
    }
  });

  // When thread is archived, archive its relations
  eventBus.on(EventName.THREAD_ARCHIVED, async ({ threadId }) => {
    logger.debug(`[relations:listeners] THREAD_ARCHIVED: ${threadId}`);
    await relationService.archiveByThread(threadId);
  });

  // When plan is archived, archive its relations
  eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }) => {
    logger.debug(`[relations:listeners] PLAN_ARCHIVED: ${planId}`);
    await relationService.archiveByPlan(planId);
  });

  // When a relation is upgraded to 'modified', mark the plan as unread
  eventBus.on(EventName.RELATION_UPDATED, async ({ planId, type, previousType }) => {
    if (type === 'modified' && previousType !== 'modified') {
      logger.debug(`[relations:listeners] RELATION_UPDATED (upgraded to modified): marking plan ${planId} as unread`);
      await planService.markAsUnread(planId);
    }
  });

  logger.log("[relations:listeners] Relation listeners initialized");
}
