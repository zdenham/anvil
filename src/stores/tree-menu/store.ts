import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { TreeMenuPersistedState } from "./types";

interface TreeMenuState {
  /** Expansion state for each section, keyed by section id */
  expandedSections: Record<string, boolean>;
  /** Currently selected thread or plan id */
  selectedItemId: string | null;
  /** ID of pinned section ("repoId:worktreeId") or null if none pinned */
  pinnedSectionId: string | null;
  /** Array of hidden section IDs ("repoId:worktreeId") */
  hiddenSectionIds: string[];
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

interface TreeMenuActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: TreeMenuPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetExpanded: (sectionId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
  _applySetPinned: (sectionId: string | null) => Rollback;
  _applySetHidden: (sectionId: string, hidden: boolean) => Rollback;
  _applyUnhideAll: () => Rollback;
}

export const useTreeMenuStore = create<TreeMenuState & TreeMenuActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  expandedSections: {},
  selectedItemId: null,
  pinnedSectionId: null,
  hiddenSectionIds: [],
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (state: TreeMenuPersistedState) => {
    set({
      expandedSections: state.expandedSections,
      selectedItemId: state.selectedItemId,
      pinnedSectionId: state.pinnedSectionId ?? null,
      hiddenSectionIds: state.hiddenSectionIds ?? [],
      _hydrated: true,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applySetExpanded: (sectionId: string, expanded: boolean): Rollback => {
    const prev = get().expandedSections[sectionId];
    set((state) => ({
      expandedSections: {
        ...state.expandedSections,
        [sectionId]: expanded,
      },
    }));
    return () =>
      set((state) => ({
        expandedSections: prev !== undefined
          ? { ...state.expandedSections, [sectionId]: prev }
          : (() => {
              const { [sectionId]: _, ...rest } = state.expandedSections;
              return rest;
            })(),
      }));
  },

  _applySetSelectedItem: (itemId: string | null): Rollback => {
    const prev = get().selectedItemId;
    set({ selectedItemId: itemId });
    return () => set({ selectedItemId: prev });
  },

  _applySetPinned: (sectionId: string | null): Rollback => {
    const prev = get().pinnedSectionId;
    set({ pinnedSectionId: sectionId });
    return () => set({ pinnedSectionId: prev });
  },

  _applySetHidden: (sectionId: string, hidden: boolean): Rollback => {
    const prev = [...get().hiddenSectionIds];
    if (hidden) {
      // Add to hidden list if not already there
      if (!prev.includes(sectionId)) {
        set({ hiddenSectionIds: [...prev, sectionId] });
      }
    } else {
      // Remove from hidden list
      set({ hiddenSectionIds: prev.filter((id) => id !== sectionId) });
    }
    return () => set({ hiddenSectionIds: prev });
  },

  _applyUnhideAll: (): Rollback => {
    const prev = [...get().hiddenSectionIds];
    set({ hiddenSectionIds: [], pinnedSectionId: null });
    return () => set({ hiddenSectionIds: prev });
  },
}));

/**
 * Get current tree menu state (non-reactive, for use outside React).
 */
export function getTreeMenuState(): Pick<TreeMenuState, "expandedSections" | "selectedItemId" | "pinnedSectionId" | "hiddenSectionIds"> {
  const { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds };
}
