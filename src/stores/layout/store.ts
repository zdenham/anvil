import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { LayoutPersistedState } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// State Interface
// ═══════════════════════════════════════════════════════════════════════════

interface LayoutState {
  /** Panel widths keyed by persist key */
  panelWidths: Record<string, number>;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions Interface
// ═══════════════════════════════════════════════════════════════════════════

interface LayoutActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: LayoutPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetPanelWidth: (key: string, width: number) => Rollback;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════════════════

export const useLayoutStore = create<LayoutState & LayoutActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  panelWidths: {},
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (state: LayoutPersistedState) => {
    set({
      panelWidths: state.panelWidths,
      _hydrated: true,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════

  _applySetPanelWidth: (key: string, width: number): Rollback => {
    const prev = get().panelWidths[key];
    set((state) => ({
      panelWidths: { ...state.panelWidths, [key]: width },
    }));
    return () => {
      if (prev !== undefined) {
        set((state) => ({
          panelWidths: { ...state.panelWidths, [key]: prev },
        }));
      } else {
        set((state) => {
          const { [key]: _, ...rest } = state.panelWidths;
          return { panelWidths: rest };
        });
      }
    };
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a specific panel width.
 */
export function getPanelWidth(key: string, defaultWidth: number): number {
  const { panelWidths } = useLayoutStore.getState();
  return panelWidths[key] ?? defaultWidth;
}
