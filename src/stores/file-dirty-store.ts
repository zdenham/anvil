/**
 * FileDirtyStore
 *
 * Tracks which file paths have unsaved modifications.
 * Used by FileContent to report dirty state and by TabItem to display it.
 */

import { create } from "zustand";

interface FileDirtyState {
  dirtyFiles: Set<string>;
  setDirty: (filePath: string, isDirty: boolean) => void;
}

export const useFileDirtyStore = create<FileDirtyState>((set) => ({
  dirtyFiles: new Set(),
  setDirty: (filePath, isDirty) =>
    set((s) => {
      const has = s.dirtyFiles.has(filePath);
      if (isDirty === has) return s;
      const next = new Set(s.dirtyFiles);
      if (isDirty) next.add(filePath);
      else next.delete(filePath);
      return { dirtyFiles: next };
    }),
}));
