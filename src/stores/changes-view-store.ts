import { create } from "zustand";

export interface FileStats {
  additions: number;
  deletions: number;
}

interface ChangesViewState {
  /** Worktree ID that has an active Changes view, or null */
  activeWorktreeId: string | null;
  /** Set of changed file paths (relative to worktree root) in the active diff */
  changedFilePaths: Set<string>;
  /** Per-file diff stats keyed by relative path */
  fileStats: Map<string, FileStats>;
  /** Currently selected file path for scroll-to, or null */
  selectedFilePath: string | null;
}

interface ChangesViewActions {
  /** Called by ChangesView on mount / when diff data changes */
  setActive: (worktreeId: string, changedPaths: string[], fileStats: Map<string, FileStats>) => void;
  /** Called by ChangesView on unmount */
  clearActive: () => void;
  /** Called by FileBrowserPanel when a file is clicked during Changes view */
  selectFile: (filePath: string | null) => void;
}

export const useChangesViewStore = create<ChangesViewState & ChangesViewActions>((set) => ({
  activeWorktreeId: null,
  changedFilePaths: new Set(),
  fileStats: new Map(),
  selectedFilePath: null,

  setActive: (worktreeId: string, changedPaths: string[], fileStats: Map<string, FileStats>) => {
    set({
      activeWorktreeId: worktreeId,
      changedFilePaths: new Set(changedPaths),
      fileStats,
      selectedFilePath: null,
    });
  },

  clearActive: () => {
    set({
      activeWorktreeId: null,
      changedFilePaths: new Set(),
      fileStats: new Map(),
      selectedFilePath: null,
    });
  },

  selectFile: (filePath: string | null) => {
    set({ selectedFilePath: filePath });
  },
}));
