import { eventBus, EventName, type EventPayloads } from "@/entities/events";
import { folderService } from "./service";
import { logger } from "@/lib/logger-client";

/**
 * Set up folder event listeners.
 * Called once at app startup.
 * Handles cross-window sync by refreshing from disk on events.
 */
export function setupFolderListeners(): () => void {
  const handleCreated = async ({ folderId }: EventPayloads[typeof EventName.FOLDER_CREATED]) => {
    logger.debug(`[folders:listener] FOLDER_CREATED received: ${folderId}`);
    try {
      await folderService.refreshById(folderId);
    } catch (err) {
      logger.error(
        `[folders:listener] Failed to refresh folder ${folderId}:`,
        err
      );
    }
  };

  const handleUpdated = async ({ folderId }: EventPayloads[typeof EventName.FOLDER_UPDATED]) => {
    logger.debug(`[folders:listener] FOLDER_UPDATED received: ${folderId}`);
    try {
      await folderService.refreshById(folderId);
    } catch (err) {
      logger.error(
        `[folders:listener] Failed to refresh folder ${folderId}:`,
        err
      );
    }
  };

  const handleDeleted = async ({ folderId }: EventPayloads[typeof EventName.FOLDER_DELETED]) => {
    logger.debug(`[folders:listener] FOLDER_DELETED received: ${folderId}`);
    try {
      await folderService.refreshById(folderId);
    } catch (err) {
      logger.error(
        `[folders:listener] Failed to handle folder deletion ${folderId}:`,
        err
      );
    }
  };

  eventBus.on(EventName.FOLDER_CREATED, handleCreated);
  eventBus.on(EventName.FOLDER_UPDATED, handleUpdated);
  eventBus.on(EventName.FOLDER_DELETED, handleDeleted);

  logger.info("[folders:listener] Folder listeners initialized");

  return () => {
    eventBus.off(EventName.FOLDER_CREATED, handleCreated);
    eventBus.off(EventName.FOLDER_UPDATED, handleUpdated);
    eventBus.off(EventName.FOLDER_DELETED, handleDeleted);
  };
}
