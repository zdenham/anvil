import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { relationDetector } from "./detection";
import { relationService } from "./service";
import { planService } from "../plans/service";
import { logger } from "@/lib/logger-client";

/**
 * Set up event listeners for automatic relation management.
 *
 * The agent runner emits:
 * - THREAD_FILE_CREATED - when a thread creates a file
 * - THREAD_FILE_MODIFIED - when a thread modifies a file
 * - USER_MESSAGE_SENT - when user sends a message to a thread
 *
 * The relation service listens and creates/updates relations
 * when file paths match plan files.
 */
export function setupRelationListeners(): void {
  logger.log("[relations:listeners] Setting up relation listeners...");

  // When thread creates a file (emitted by agent runner)
  eventBus.on(EventName.THREAD_FILE_CREATED, async ({ threadId, filePath }) => {
    logger.debug(`[relations:listeners] THREAD_FILE_CREATED: ${threadId} -> ${filePath}`);
    await relationDetector.onFileChange(threadId, filePath, 'created');
  });

  // When thread modifies a file (emitted by agent runner)
  eventBus.on(EventName.THREAD_FILE_MODIFIED, async ({ threadId, filePath }) => {
    logger.debug(`[relations:listeners] THREAD_FILE_MODIFIED: ${threadId} -> ${filePath}`);
    await relationDetector.onFileChange(threadId, filePath, 'modified');
  });

  // When user sends message to thread (emitted by agent runner)
  eventBus.on(EventName.USER_MESSAGE_SENT, async ({ threadId, message }) => {
    logger.debug(`[relations:listeners] USER_MESSAGE_SENT: ${threadId}`);
    await relationDetector.onUserMessage(threadId, message);
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

  // When a relation is created with type 'modified', mark the plan as unread
  // Note: planService.markAsUnread is defined in plan-entity
  eventBus.on(EventName.RELATION_CREATED, async ({ planId, type }) => {
    if (type === 'modified') {
      logger.debug(`[relations:listeners] RELATION_CREATED (modified): marking plan ${planId} as unread`);
      await planService.markAsUnread(planId);
    }
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
