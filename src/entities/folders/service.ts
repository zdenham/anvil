import { optimistic } from "@/lib/optimistic";
import { appData } from "@/lib/app-data-store";
import { useFolderStore } from "./store";
import { FolderMetadataSchema } from "./types";
import type { FolderMetadata, CreateFolderInput } from "./types";
import type { VisualSettings } from "@core/types/visual-settings.js";
import { logger } from "@/lib/logger-client";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { archiveFolder, unarchiveFolder, listArchivedFolders } from "./archive";

const FOLDERS_DIR = "folders";

class FolderService {
  /**
   * Hydrate store from folders/{id}/metadata.json files.
   * Called once at app startup.
   */
  async hydrate(): Promise<void> {
    await appData.ensureDir(FOLDERS_DIR);
    const pattern = `${FOLDERS_DIR}/*/metadata.json`;
    const metadataFiles = await appData.glob(pattern);

    const folders: Record<string, FolderMetadata> = {};

    for (const filePath of metadataFiles) {
      try {
        const data = await appData.readJson(filePath);
        const result = FolderMetadataSchema.safeParse(data);
        if (result.success) {
          folders[result.data.id] = result.data;
        } else {
          logger.warn(
            `[folderService:hydrate] Invalid folder metadata at ${filePath}:`,
            result.error.message
          );
        }
      } catch (err) {
        logger.warn(
          `[folderService:hydrate] Failed to read folder metadata at ${filePath}:`,
          err
        );
      }
    }

    useFolderStore.getState().hydrate(folders);
    logger.info(
      `[folderService:hydrate] Loaded ${Object.keys(folders).length} folders`
    );
  }

  /** Get a folder by ID from the store. */
  get(id: string): FolderMetadata | undefined {
    return useFolderStore.getState().getFolder(id);
  }

  /** Get all folders from the store. */
  getAll(): FolderMetadata[] {
    return useFolderStore.getState().getAll();
  }

  /** Get folders for a specific worktree. */
  getByWorktree(worktreeId: string): FolderMetadata[] {
    return useFolderStore.getState().getByWorktree(worktreeId);
  }

  /**
   * Create a new folder.
   * Uses optimistic update — UI updates immediately, rolls back on failure.
   */
  async create(input: CreateFolderInput): Promise<FolderMetadata> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const folder: FolderMetadata = {
      id,
      name: input.name,
      icon: input.icon ?? "folder",
      worktreeId: input.worktreeId,
      visualSettings: input.parentId ? { parentId: input.parentId } : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const folderPath = `${FOLDERS_DIR}/${id}`;

    await optimistic(
      folder,
      (f) => useFolderStore.getState()._applyCreate(f),
      async (f) => {
        await appData.ensureDir(folderPath);
        await appData.writeJson(`${folderPath}/metadata.json`, f);
      },
    );

    eventBus.emit(EventName.FOLDER_CREATED, { folderId: id });
    logger.info(`[folderService:create] Created folder ${id} ("${input.name}")`);
    return folder;
  }

  /**
   * Rename a folder.
   * Read-modify-write pattern following disk-as-truth.
   */
  async rename(id: string, name: string): Promise<void> {
    const existing = useFolderStore.getState().getFolder(id);
    if (!existing) throw new Error(`Folder not found: ${id}`);

    const updated: FolderMetadata = {
      ...existing,
      name,
      updatedAt: Date.now(),
    };

    await this.persistUpdate(id, updated);
    eventBus.emit(EventName.FOLDER_UPDATED, { folderId: id });
  }

  /**
   * Update the worktreeId on a folder.
   * Called by DnD drop handler when a folder moves into/out of a worktree.
   */
  async updateWorktreeId(id: string, worktreeId: string | undefined): Promise<void> {
    const existing = useFolderStore.getState().getFolder(id);
    if (!existing) throw new Error(`Folder not found: ${id}`);

    const updated: FolderMetadata = {
      ...existing,
      worktreeId,
      updatedAt: Date.now(),
    };

    await this.persistUpdate(id, updated);
    eventBus.emit(EventName.FOLDER_UPDATED, { folderId: id });
  }

  /**
   * Update the icon on a folder.
   * Read-modify-write pattern following disk-as-truth.
   */
  async updateIcon(id: string, icon: string): Promise<void> {
    const existing = useFolderStore.getState().getFolder(id);
    if (!existing) throw new Error(`Folder not found: ${id}`);

    const updated: FolderMetadata = {
      ...existing,
      icon,
      updatedAt: Date.now(),
    };

    await this.persistUpdate(id, updated);
    eventBus.emit(EventName.FOLDER_UPDATED, { folderId: id });
  }

  /**
   * Update visualSettings on a folder.
   * Called by DnD drop handler and "Move to..." context menu via
   * the shared updateVisualSettings() dispatcher.
   */
  async updateVisualSettings(
    id: string,
    patch: Partial<VisualSettings>,
  ): Promise<void> {
    const existing = useFolderStore.getState().getFolder(id);
    if (!existing) throw new Error(`Folder not found: ${id}`);

    const merged: VisualSettings = { ...existing.visualSettings, ...patch };
    const updated: FolderMetadata = {
      ...existing,
      visualSettings: merged,
      updatedAt: Date.now(),
    };

    await this.persistUpdate(id, updated);
    eventBus.emit(EventName.FOLDER_UPDATED, { folderId: id });
  }

  /**
   * Delete a folder permanently.
   * Removes the folder directory from disk and the entity from the store.
   */
  async delete(id: string): Promise<void> {
    const folder = useFolderStore.getState().getFolder(id);
    if (!folder) return;

    const rollback = useFolderStore.getState()._applyDelete(id);

    try {
      await appData.removeDir(`${FOLDERS_DIR}/${id}`);
      eventBus.emit(EventName.FOLDER_DELETED, { folderId: id });
      logger.info(`[folderService:delete] Deleted folder ${id}`);
    } catch (err) {
      rollback();
      logger.error(`[folderService:delete] Failed to delete folder ${id}:`, err);
      throw err;
    }
  }

  /**
   * Refresh a single folder from disk by ID.
   * Called by event listeners for cross-window sync (disk-as-truth pattern).
   */
  async refreshById(id: string): Promise<void> {
    const metadataPath = `${FOLDERS_DIR}/${id}/metadata.json`;
    const raw = await appData.readJson(metadataPath);
    const result = raw ? FolderMetadataSchema.safeParse(raw) : null;

    if (result?.success) {
      const existing = useFolderStore.getState().getFolder(id);
      if (existing) {
        useFolderStore.getState()._applyUpdate(id, result.data);
      } else {
        useFolderStore.getState()._applyCreate(result.data);
      }
    } else {
      // Folder was deleted or corrupted — remove from store
      const existing = useFolderStore.getState().getFolder(id);
      if (existing) {
        useFolderStore.getState()._applyDelete(id);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Archive Methods (delegated to ./archive.ts)
  // ═══════════════════════════════════════════════════════════════════════

  /** Archive a folder. Moves to archive/folders/{id}/. */
  async archive(id: string): Promise<void> {
    await archiveFolder(id);
  }

  /** Unarchive a folder. Restores from archive/folders/{id}/. */
  async unarchive(id: string): Promise<void> {
    await unarchiveFolder(id);
  }

  /** List all archived folders. */
  async listArchived(): Promise<FolderMetadata[]> {
    return listArchivedFolders();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Shared read-modify-write persistence for update operations.
   * Reads current disk state, merges with the new data, and writes back.
   */
  private async persistUpdate(id: string, updated: FolderMetadata): Promise<void> {
    await optimistic(
      updated,
      (f) => useFolderStore.getState()._applyUpdate(id, f),
      async (f) => {
        const metadataPath = `${FOLDERS_DIR}/${id}/metadata.json`;
        const raw = await appData.readJson(metadataPath);
        const diskState = raw ? FolderMetadataSchema.safeParse(raw) : null;
        const merged = diskState?.success
          ? { ...diskState.data, ...f, updatedAt: Date.now() }
          : f;
        await appData.writeJson(metadataPath, merged);
      },
    );
  }
}

export const folderService = new FolderService();
