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
  /** ID of the node currently in inline rename mode, or null */
  renamingNodeId: string | null;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

interface TreeMenuActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: TreeMenuPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetExpanded: (nodeId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
  _applySetPinned: (worktreeId: string | null) => Rollback;
  _applySetRenaming: (nodeId: string | null) => Rollback;
}

export const useTreeMenuStore = create<TreeMenuState & TreeMenuActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  expandedSections: {},
  selectedItemId: null,
  pinnedWorktreeId: null,
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
      _hydrated: true,
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

  _applySetRenaming: (nodeId: string | null): Rollback => {
    const prev = get().renamingNodeId;
    set({ renamingNodeId: nodeId });
    return () => set({ renamingNodeId: prev });
  },
}));

/**
 * Get current tree menu state (non-reactive, for use outside React).
 */
export function getTreeMenuState(): Pick<TreeMenuState, "expandedSections" | "selectedItemId" | "pinnedWorktreeId"> {
  const { expandedSections, selectedItemId, pinnedWorktreeId } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedWorktreeId };
}
