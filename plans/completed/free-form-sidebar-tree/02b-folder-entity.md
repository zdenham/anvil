# 02b — Folder Entity

**Layer 1 — parallel with 02a, 02c, 02d. Depends on 01.**

## Summary

Create the `FolderMetadata` entity type with Zod schema in `core/types/`, a re-export `types.ts` in `src/entities/folders/`, a Zustand store (`useFolderStore`), a folder service class with CRUD and disk persistence, event listeners, startup hydration, and barrel exports. Follows the exact same patterns as plans and pull-requests.

## Dependencies

- **01-visual-settings-foundation** — `VisualSettingsSchema` must exist in `core/types/visual-settings.ts`

## Key Files

| File | Change |
| --- | --- |
| `core/types/folders.ts` | **New** — `FolderMetadataSchema`, `FolderMetadata`, `CreateFolderInput` |
| `core/types/index.ts` | Add `export * from "./folders.js";` |
| `core/types/events.ts` | Add `FOLDER_CREATED`, `FOLDER_UPDATED`, `FOLDER_DELETED` event names and payloads |
| `src/entities/folders/types.ts` | **New** — re-export from `@core/types/folders.js` |
| `src/entities/folders/store.ts` | **New** — `useFolderStore` Zustand entity store |
| `src/entities/folders/service.ts` | **New** — `FolderService` class with CRUD + disk persistence |
| `src/entities/folders/listeners.ts` | **New** — `setupFolderListeners()` for cross-window sync |
| `src/entities/folders/index.ts` | **New** — barrel export |
| `src/entities/index.ts` | Wire up hydration + listeners |

## Implementation

### 1. Schema — `core/types/folders.ts`

```typescript
import { z } from "zod";
import { VisualSettingsSchema } from "./visual-settings.js";

// ═══════════════════════════════════════════════════════════════════════════
// Folder Entity Types - Zod schemas with derived types
// Storage: ~/.mort/folders/{id}/metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for folder metadata persisted to disk.
 * Validated when loading from JSON files.
 */
export const FolderMetadataSchema = z.object({
  /** Stable ID: UUID */
  id: z.string().uuid(),
  /** User-visible folder name */
  name: z.string(),
  /** Lucide icon identifier (e.g., "folder", "bug", "zap") */
  icon: z.string(),
  /** Set when folder is inside a worktree (for boundary enforcement) */
  worktreeId: z.string().uuid().optional(),
  /** Visual tree placement and sort ordering */
  visualSettings: VisualSettingsSchema.optional(),
  /** Unix milliseconds */
  createdAt: z.number(),
  /** Unix milliseconds */
  updatedAt: z.number(),
});

/** Folder metadata persisted to disk */
export type FolderMetadata = z.infer<typeof FolderMetadataSchema>;

/** Input for creating a new folder (plain interface — internal code) */
export interface CreateFolderInput {
  name: string;
  icon?: string;           // defaults to "folder"
  worktreeId?: string;     // set when folder is inside a worktree
  parentId?: string;       // visual parent (sets visualSettings.parentId)
}
```

### 2. Re-export from `core/types/index.ts`

Add the following line to `core/types/index.ts` (after the pull-request export):

```typescript
// Folder types - sidebar folder entities
export * from "./folders.js";
```

### 3. Event Names — `core/types/events.ts`

Add to the `EventName` const object (after the `PLAN_ARCHIVED` entry):

```typescript
  // Folder lifecycle
  FOLDER_CREATED: "folder:created",
  FOLDER_UPDATED: "folder:updated",
  FOLDER_DELETED: "folder:deleted",
```

Add to the `EventPayloads` interface:

```typescript
  // Folder events
  [EventName.FOLDER_CREATED]: { folderId: string };
  [EventName.FOLDER_UPDATED]: { folderId: string };
  [EventName.FOLDER_DELETED]: { folderId: string };
```

Add to the `EventNameSchema` `z.enum([...])` array:

```typescript
  EventName.FOLDER_CREATED,
  EventName.FOLDER_UPDATED,
  EventName.FOLDER_DELETED,
```

### 4. Types re-export — `src/entities/folders/types.ts`

```typescript
/**
 * Folder types - re-exported from core for convenience.
 * The canonical source of truth is @core/types/folders.js
 */
export {
  // Schemas
  FolderMetadataSchema,
  // Types derived from schemas
  type FolderMetadata,
  // Input interfaces
  type CreateFolderInput,
} from "@core/types/folders.js";
```

### 5. Store — `src/entities/folders/store.ts`

Follows `usePlanStore` pattern exactly: `Record<string, FolderMetadata>` state, `_foldersArray` cached array, hydration, selectors, and `_apply*` optimistic methods returning `Rollback`.

```typescript
import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { FolderMetadata } from "./types";

interface FolderStoreState {
  /** All folder metadata keyed by UUID (single copy per entity) */
  folders: Record<string, FolderMetadata>;
  /** Cached array of all folders (avoids Object.values() in selectors) */
  _foldersArray: FolderMetadata[];
  _hydrated: boolean;
}

interface FolderStoreActions {
  /** Hydration (called once at app start) */
  hydrate(folders: Record<string, FolderMetadata>): void;

  /** Selectors */
  getFolder(id: string): FolderMetadata | undefined;
  getAll(): FolderMetadata[];
  getByWorktree(worktreeId: string): FolderMetadata[];

  /** Optimistic apply methods — return rollback for use with optimistic() */
  _applyCreate(folder: FolderMetadata): Rollback;
  _applyUpdate(id: string, folder: FolderMetadata): Rollback;
  _applyDelete(id: string): Rollback;
}

export const useFolderStore = create<FolderStoreState & FolderStoreActions>(
  (set, get) => ({
    // ═══════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════
    folders: {},
    _foldersArray: [],
    _hydrated: false,

    // ═══════════════════════════════════════════════════════════════════════
    // Hydration
    // ═══════════════════════════════════════════════════════════════════════
    hydrate: (folders) => {
      set({
        folders,
        _foldersArray: Object.values(folders),
        _hydrated: true,
      });
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Selectors
    // ═══════════════════════════════════════════════════════════════════════
    getFolder: (id) => get().folders[id],

    getAll: () => get()._foldersArray,

    getByWorktree: (worktreeId) =>
      get()._foldersArray.filter((f) => f.worktreeId === worktreeId),

    // ═══════════════════════════════════════════════════════════════════════
    // Optimistic Apply Methods
    // ═══════════════════════════════════════════════════════════════════════
    _applyCreate: (folder: FolderMetadata): Rollback => {
      set((state) => {
        const newFolders = { ...state.folders, [folder.id]: folder };
        return {
          folders: newFolders,
          _foldersArray: Object.values(newFolders),
        };
      });
      return () =>
        set((state) => {
          const { [folder.id]: _, ...rest } = state.folders;
          return {
            folders: rest,
            _foldersArray: Object.values(rest),
          };
        });
    },

    _applyUpdate: (id: string, folder: FolderMetadata): Rollback => {
      const prev = get().folders[id];
      set((state) => {
        const newFolders = { ...state.folders, [id]: folder };
        return {
          folders: newFolders,
          _foldersArray: Object.values(newFolders),
        };
      });
      return () =>
        set((state) => {
          const restored = prev
            ? { ...state.folders, [id]: prev }
            : state.folders;
          return {
            folders: restored,
            _foldersArray: Object.values(restored),
          };
        });
    },

    _applyDelete: (id: string): Rollback => {
      const prev = get().folders[id];
      set((state) => {
        const { [id]: _, ...rest } = state.folders;
        return {
          folders: rest,
          _foldersArray: Object.values(rest),
        };
      });
      return () =>
        set((state) => {
          const restored = prev
            ? { ...state.folders, [id]: prev }
            : state.folders;
          return {
            folders: restored,
            _foldersArray: Object.values(restored),
          };
        });
    },
  })
);
```

### 6. Service — `src/entities/folders/service.ts`

Follows `PlanService` class pattern: singleton class exported as `folderService`, uses `appData` for disk I/O, `optimistic()` helper for create/update, Zod `safeParse` for hydration.

```typescript
import { optimistic } from "@/lib/optimistic";
import { appData } from "@/lib/app-data-store";
import { useFolderStore } from "./store";
import { FolderMetadataSchema } from "./types";
import type { FolderMetadata, CreateFolderInput } from "./types";
import type { VisualSettings } from "@core/types/visual-settings.js";
import { logger } from "@/lib/logger-client";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";

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

    await optimistic(
      updated,
      (f) => useFolderStore.getState()._applyUpdate(id, f),
      async (f) => {
        const metadataPath = `${FOLDERS_DIR}/${id}/metadata.json`;
        const raw = await appData.readJson(metadataPath);
        const diskState = raw ? FolderMetadataSchema.safeParse(raw) : null;
        const mergedDisk = diskState?.success
          ? { ...diskState.data, ...f, updatedAt: Date.now() }
          : f;
        await appData.writeJson(metadataPath, mergedDisk);
      },
    );

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
}

export const folderService = new FolderService();
```

### 7. Listeners — `src/entities/folders/listeners.ts`

```typescript
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
```

### 8. Barrel Export — `src/entities/folders/index.ts`

```typescript
export { useFolderStore } from "./store";
export { folderService } from "./service";
export { setupFolderListeners } from "./listeners";
export * from "./types";
```

### 9. Wire Up in `src/entities/index.ts`

**Add exports** (after the Comments exports section):

```typescript
// Folders
export { useFolderStore } from "./folders/store";
export { folderService } from "./folders/service";
export type { FolderMetadata, CreateFolderInput } from "./folders/types";
```

**Add imports** (in the hydration/listeners import block):

```typescript
import { folderService } from "./folders/service";
import { setupFolderListeners } from "./folders/listeners";
```

**Add to `hydrateEntities()`** — add `folderService.hydrate()` to the core parallel hydration block:

```typescript
// In the Promise.all array inside hydrateEntities():
timed("folderService.hydrate", () => folderService.hydrate()),
```

**Add to `setupEntityListeners()`** — add after `setupCommentListeners()`:

```typescript
setupFolderListeners();
```

## Disk Persistence

```
~/.mort/folders/{id}/metadata.json
```

Exact same pattern as `~/.mort/plans/{id}/metadata.json` and `~/.mort/threads/{id}/metadata.json`. Each folder gets its own directory with a single `metadata.json` file. The directory name is the folder UUID.

## ID Generation

Use `crypto.randomUUID()` (same as `planService.create()` and `pullRequestService.create()` in the existing codebase). The parent plan says "nanoid" but the frontend codebase consistently uses `crypto.randomUUID()` for entity IDs.

## Interaction with `updateVisualSettings()` Dispatcher

Sub-plan 01 creates a shared `updateVisualSettings()` dispatcher in `src/lib/visual-settings.ts` with a `"folder"` case that calls:

```typescript
case "folder": {
  const { folderService } = await import("@/entities/folders/service");
  await folderService.updateVisualSettings(entityId, patch);
  break;
}
```

This sub-plan provides the `folderService.updateVisualSettings()` method that the dispatcher calls. The service method is defined in step 6 above.

## Acceptance Criteria

- [x] `FolderMetadataSchema` in `core/types/folders.ts` validates correctly (Zod safeParse round-trips)

- [x] `core/types/index.ts` re-exports folder types

- [x] `FOLDER_CREATED`, `FOLDER_UPDATED`, `FOLDER_DELETED` events exist in `core/types/events.ts` with typed payloads

- [x] `src/entities/folders/types.ts` re-exports from `@core/types/folders.js`

- [x] `useFolderStore` follows entity store patterns (Record + cached array + `_apply*` methods returning `Rollback`)

- [x] CRUD operations persist to `~/.mort/folders/{id}/metadata.json`

- [x] All disk writes use read-modify-write pattern (disk-as-truth)

- [x] Hydration on startup loads all folders via glob + Zod safeParse

- [x] `folderService.hydrate()` is called in `hydrateEntities()` parallel block

- [x] `setupFolderListeners()` is called in `setupEntityListeners()`

- [x] Barrel exports in `src/entities/folders/index.ts` and `src/entities/index.ts`

- [x] Creating a folder with `parentId` sets `visualSettings.parentId`

- [x] Creating a folder inside a worktree sets `worktreeId`

- [x] `folderService.updateVisualSettings()` exists for the shared dispatcher (from 01)

- [ ] TypeScript compiles: `pnpm tsc --noEmit`

- [ ] Existing tests pass: `pnpm test`

## Phases

- [x] Create `FolderMetadataSchema` and types in `core/types/folders.ts`; add re-export to `core/types/index.ts`

- [x] Add `FOLDER_CREATED`, `FOLDER_UPDATED`, `FOLDER_DELETED` to `core/types/events.ts` (EventName, EventPayloads, EventNameSchema)

- [x] Create `src/entities/folders/types.ts` with re-exports from core

- [x] Create `useFolderStore` Zustand store in `src/entities/folders/store.ts`

- [x] Create `FolderService` class with CRUD, disk persistence, and `refreshById()` in `src/entities/folders/service.ts`

- [x] Create `setupFolderListeners()` in `src/entities/folders/listeners.ts`

- [x] Create barrel export in `src/entities/folders/index.ts`

- [x] Wire up in `src/entities/index.ts`: add exports, hydration call in `hydrateEntities()`, listener call in `setupEntityListeners()`

- [ ] Verify: `pnpm tsc --noEmit` and `pnpm test` pass

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
