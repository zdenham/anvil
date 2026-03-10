/**
 * Folder archive operations.
 *
 * Extracted from service.ts to keep file sizes under the 250-line limit.
 */

import { appData } from "@/lib/app-data-store";
import { useFolderStore } from "./store";
import { FolderMetadataSchema } from "./types";
import type { FolderMetadata } from "./types";
import { logger } from "@/lib/logger-client";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";

const FOLDERS_DIR = "folders";
const ARCHIVE_FOLDERS_DIR = "archive/folders";

/**
 * Archive a folder.
 * Moves metadata from folders/{id}/ to archive/folders/{id}/.
 * Removes from store optimistically, rolls back on failure.
 */
export async function archiveFolder(id: string): Promise<void> {
  const folder = useFolderStore.getState().getFolder(id);
  if (!folder) return;

  const rollback = useFolderStore.getState()._applyDelete(id);
  try {
    const sourcePath = `${FOLDERS_DIR}/${id}`;
    const archivePath = `${ARCHIVE_FOLDERS_DIR}/${id}`;
    const metadata = await appData.readJson(`${sourcePath}/metadata.json`);

    await appData.ensureDir(ARCHIVE_FOLDERS_DIR);
    await appData.ensureDir(archivePath);
    if (metadata) await appData.writeJson(`${archivePath}/metadata.json`, metadata);
    await appData.removeDir(sourcePath);

    eventBus.emit(EventName.FOLDER_ARCHIVED, { folderId: id });
    logger.info(`[folderService:archive] Archived folder ${id}`);
  } catch (error) {
    rollback();
    throw error;
  }
}

/**
 * Unarchive a folder.
 * Moves metadata from archive/folders/{id}/ back to folders/{id}/.
 * Adds back to store.
 */
export async function unarchiveFolder(id: string): Promise<void> {
  const archivePath = `${ARCHIVE_FOLDERS_DIR}/${id}`;
  const metadataPath = `${archivePath}/metadata.json`;

  const raw = await appData.readJson(metadataPath);
  const result = raw ? FolderMetadataSchema.safeParse(raw) : null;
  if (!result?.success) {
    logger.warn(`[folderService:unarchive] Folder ${id} not found in archive`);
    return;
  }

  const metadata = result.data;
  const destPath = `${FOLDERS_DIR}/${id}`;

  await appData.ensureDir(destPath);
  await appData.writeJson(`${destPath}/metadata.json`, metadata);
  await appData.removeDir(archivePath);

  useFolderStore.getState()._applyCreate(metadata);
  logger.info(`[folderService:unarchive] Unarchived folder ${id}`);
}

/**
 * List all archived folders.
 * Returns FolderMetadata for folders in archive/folders/ directory.
 */
export async function listArchivedFolders(): Promise<FolderMetadata[]> {
  const pattern = `${ARCHIVE_FOLDERS_DIR}/*/metadata.json`;
  const files = await appData.glob(pattern);
  const folders: FolderMetadata[] = [];

  for (const filePath of files) {
    const raw = await appData.readJson(filePath);
    const result = raw ? FolderMetadataSchema.safeParse(raw) : null;
    if (result?.success) folders.push(result.data);
  }

  return folders;
}
