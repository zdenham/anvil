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
