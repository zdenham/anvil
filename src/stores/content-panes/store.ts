import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { ContentPaneView } from "@/components/content-pane/types";
import type { ContentPanesPersistedState, ContentPaneData } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// State Interface
// ═══════════════════════════════════════════════════════════════════════════

interface ContentPanesState {
  /** Content panes keyed by UUID */
  panes: Record<string, ContentPaneData>;
  /** Currently active pane ID */
  activePaneId: string | null;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions Interface
// ═══════════════════════════════════════════════════════════════════════════

interface ContentPanesActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: ContentPanesPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applyCreatePane: (pane: ContentPaneData) => Rollback;
  _applyClosePane: (paneId: string) => Rollback;
  _applySetPaneView: (paneId: string, view: ContentPaneView) => Rollback;
  _applySetActivePane: (paneId: string | null) => Rollback;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════════════════

export const useContentPanesStore = create<ContentPanesState & ContentPanesActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  panes: {},
  activePaneId: null,
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (state: ContentPanesPersistedState) => {
    set({
      panes: state.panes,
      activePaneId: state.activePaneId,
      _hydrated: true,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════

  _applyCreatePane: (pane: ContentPaneData): Rollback => {
    set((state) => ({
      panes: { ...state.panes, [pane.id]: pane },
    }));
    return () =>
      set((state) => {
        const { [pane.id]: _, ...rest } = state.panes;
        return { panes: rest };
      });
  },

  _applyClosePane: (paneId: string): Rollback => {
    const prevPane = get().panes[paneId];
    const prevActivePaneId = get().activePaneId;

    set((state) => {
      const { [paneId]: _, ...rest } = state.panes;
      const newActivePaneId = state.activePaneId === paneId ? null : state.activePaneId;
      return { panes: rest, activePaneId: newActivePaneId };
    });

    return () => {
      if (prevPane) {
        set((state) => ({
          panes: { ...state.panes, [paneId]: prevPane },
          activePaneId: prevActivePaneId,
        }));
      }
    };
  },

  _applySetPaneView: (paneId: string, view: ContentPaneView): Rollback => {
    const prevView = get().panes[paneId]?.view;

    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      return {
        panes: {
          ...state.panes,
          [paneId]: { ...pane, view },
        },
      };
    });

    return () => {
      if (prevView) {
        set((state) => {
          const pane = state.panes[paneId];
          if (!pane) return state;
          return {
            panes: {
              ...state.panes,
              [paneId]: { ...pane, view: prevView },
            },
          };
        });
      }
    };
  },

  _applySetActivePane: (paneId: string | null): Rollback => {
    const prev = get().activePaneId;
    set({ activePaneId: paneId });
    return () => set({ activePaneId: prev });
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current content panes state (non-reactive, for use outside React).
 */
export function getContentPanesState(): Pick<ContentPanesState, "panes" | "activePaneId"> {
  const { panes, activePaneId } = useContentPanesStore.getState();
  return { panes, activePaneId };
}

/**
 * Get the active pane.
 */
export function getActivePane(): ContentPaneData | null {
  const { panes, activePaneId } = useContentPanesStore.getState();
  return activePaneId ? panes[activePaneId] ?? null : null;
}
