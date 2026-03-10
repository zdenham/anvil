import { eventBus, EventName } from "@/entities/events";
import { folderService } from "./service";
import { logger } from "@/lib/logger-client";

/**
 * Set up folder event listeners.
 * Called once at app startup.
 * Handles cross-window sync by refreshing from disk on events.
 */
export function setupFolderListeners(): void {
  eventBus.on(EventName.FOLDER_CREATED, async ({ folderId }) => {
    logger.debug(`[folders:listener] FOLDER_CREATED received: ${folderId}`);
    try {
      await folderService.refreshById(folderId);
    } catch (err) {
      logger.error(
        `[folders:listener] Failed to refresh folder ${folderId}:`,
        err
      );
    }
  });

  eventBus.on(EventName.FOLDER_UPDATED, async ({ folderId }) => {
    logger.debug(`[folders:listener] FOLDER_UPDATED received: ${folderId}`);
    try {
      await folderService.refreshById(folderId);
    } catch (err) {
      logger.error(
        `[folders:listener] Failed to refresh folder ${folderId}:`,
        err
      );
    }
  });

  eventBus.on(EventName.FOLDER_DELETED, async ({ folderId }) => {
    logger.debug(`[folders:listener] FOLDER_DELETED received: ${folderId}`);
    try {
      await folderService.refreshById(folderId);
    } catch (err) {
      logger.error(
        `[folders:listener] Failed to handle folder deletion ${folderId}:`,
        err
      );
    }
  });

  logger.info("[folders:listener] Folder listeners initialized");
}
