import { create } from "zustand";

interface ChangesViewState {
  /** Worktree ID that has an active Changes view, or null */
  activeWorktreeId: string | null;
  /** Set of changed file paths (relative to worktree root) in the active diff */
  changedFilePaths: Set<string>;
  /** Currently selected file path for scroll-to, or null */
  selectedFilePath: string | null;
  /** Whether the inline file list sidebar is open */
  isFilePaneOpen: boolean;
}

interface ChangesViewActions {
  /** Called by ChangesView on mount / when diff data changes */
  setActive: (worktreeId: string, changedPaths: string[]) => void;
  /** Called by ChangesView on unmount */
  clearActive: () => void;
  /** Called by FileBrowserPanel when a file is clicked during Changes view */
  selectFile: (filePath: string | null) => void;
  /** Toggle the inline file list sidebar */
  toggleFilePane: () => void;
}

export const useChangesViewStore = create<ChangesViewState & ChangesViewActions>((set) => ({
  activeWorktreeId: null,
  changedFilePaths: new Set(),
  selectedFilePath: null,
  isFilePaneOpen: true,

  setActive: (worktreeId: string, changedPaths: string[]) => {
    set({
      activeWorktreeId: worktreeId,
      changedFilePaths: new Set(changedPaths),
      selectedFilePath: null,
    });
  },

  clearActive: () => {
    set({
      activeWorktreeId: null,
      changedFilePaths: new Set(),
      selectedFilePath: null,
      isFilePaneOpen: true,
    });
  },

  selectFile: (filePath: string | null) => {
    set({ selectedFilePath: filePath });
  },

  toggleFilePane: () => {
    set((state) => ({ isFilePaneOpen: !state.isFilePaneOpen }));
  },
}));
