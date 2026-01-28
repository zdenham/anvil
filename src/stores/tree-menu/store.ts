import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { TreeMenuPersistedState } from "./types";

interface TreeMenuState {
  /** Expansion state for each section, keyed by section id */
  expandedSections: Record<string, boolean>;
  /** Currently selected thread or plan id */
  selectedItemId: string | null;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

interface TreeMenuActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: TreeMenuPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetExpanded: (sectionId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
}

export const useTreeMenuStore = create<TreeMenuState & TreeMenuActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  expandedSections: {},
  selectedItemId: null,
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (state: TreeMenuPersistedState) => {
    set({
      expandedSections: state.expandedSections,
      selectedItemId: state.selectedItemId,
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
}));

/**
 * Get current tree menu state (non-reactive, for use outside React).
 */
export function getTreeMenuState(): Pick<TreeMenuState, "expandedSections" | "selectedItemId"> {
  const { expandedSections, selectedItemId } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId };
}
