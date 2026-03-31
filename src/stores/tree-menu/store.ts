import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { TreeMenuPersistedState } from "./types";

interface TreeMenuState {
  /** Expansion state for each node, keyed by expand key */
  expandedSections: Record<string, boolean>;
  /** Currently selected thread or plan id */
  selectedItemId: string | null;
  /** UUID of pinned worktree node, or null if none pinned */
  pinnedWorktreeId: string | null;
  /** Worktree IDs hidden by the user */
  hiddenWorktreeIds: string[];
  /** Repo IDs hidden by the user */
  hiddenRepoIds: string[];
  /** ID of the node currently in inline rename mode, or null */
  renamingNodeId: string | null;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

interface TreeMenuActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: TreeMenuPersistedState) => void;

  /** Refresh tree data from disk without overwriting selectedItemId */
  refreshTree: (state: TreeMenuPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetExpanded: (nodeId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
  _applySetPinned: (worktreeId: string | null) => Rollback;
  _applySetHiddenWorktrees: (ids: string[]) => Rollback;
  _applySetHiddenRepos: (ids: string[]) => Rollback;
  _applySetRenaming: (nodeId: string | null) => Rollback;
}

export const useTreeMenuStore = create<TreeMenuState & TreeMenuActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  expandedSections: {},
  selectedItemId: null,
  pinnedWorktreeId: null,
  hiddenWorktreeIds: [],
  hiddenRepoIds: [],
  renamingNodeId: null,
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (state: TreeMenuPersistedState) => {
    set({
      expandedSections: state.expandedSections,
      selectedItemId: state.selectedItemId,
      pinnedWorktreeId: state.pinnedWorktreeId ?? null,
      hiddenWorktreeIds: state.hiddenWorktreeIds ?? [],
      hiddenRepoIds: state.hiddenRepoIds ?? [],
      _hydrated: true,
    });
  },

  refreshTree: (state: TreeMenuPersistedState) => {
    set({
      expandedSections: state.expandedSections,
      pinnedWorktreeId: state.pinnedWorktreeId ?? null,
      hiddenWorktreeIds: state.hiddenWorktreeIds ?? [],
      hiddenRepoIds: state.hiddenRepoIds ?? [],
      // selectedItemId intentionally NOT overwritten
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applySetExpanded: (nodeId: string, expanded: boolean): Rollback => {
    const prev = get().expandedSections[nodeId];
    set((state) => ({
      expandedSections: {
        ...state.expandedSections,
        [nodeId]: expanded,
      },
    }));
    return () =>
      set((state) => ({
        expandedSections: prev !== undefined
          ? { ...state.expandedSections, [nodeId]: prev }
          : (() => {
              const { [nodeId]: _, ...rest } = state.expandedSections;
              return rest;
            })(),
      }));
  },

  _applySetSelectedItem: (itemId: string | null): Rollback => {
    const prev = get().selectedItemId;
    set({ selectedItemId: itemId });
    return () => set({ selectedItemId: prev });
  },

  _applySetPinned: (worktreeId: string | null): Rollback => {
    const prev = get().pinnedWorktreeId;
    set({ pinnedWorktreeId: worktreeId });
    return () => set({ pinnedWorktreeId: prev });
  },

  _applySetHiddenWorktrees: (ids: string[]): Rollback => {
    const prev = get().hiddenWorktreeIds;
    set({ hiddenWorktreeIds: ids });
    return () => set({ hiddenWorktreeIds: prev });
  },

  _applySetHiddenRepos: (ids: string[]): Rollback => {
    const prev = get().hiddenRepoIds;
    set({ hiddenRepoIds: ids });
    return () => set({ hiddenRepoIds: prev });
  },

  _applySetRenaming: (nodeId: string | null): Rollback => {
    const prev = get().renamingNodeId;
    set({ renamingNodeId: nodeId });
    return () => set({ renamingNodeId: prev });
  },
}));

/**
 * Get current tree menu state (non-reactive, for use outside React).
 */
export function getTreeMenuState(): Pick<TreeMenuState, "expandedSections" | "selectedItemId" | "pinnedWorktreeId" | "hiddenWorktreeIds" | "hiddenRepoIds"> {
  const { expandedSections, selectedItemId, pinnedWorktreeId, hiddenWorktreeIds, hiddenRepoIds } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedWorktreeId, hiddenWorktreeIds, hiddenRepoIds };
}
