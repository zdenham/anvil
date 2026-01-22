import { create } from "zustand";
import type { ControlPanelViewType } from "@/entities/events";

interface ControlPanelState {
  /** Current view being displayed */
  view: ControlPanelViewType | null;

  /** Set the current view */
  setView: (view: ControlPanelViewType) => void;

  /** Clear the current view */
  clearView: () => void;
}

/**
 * Store for managing control panel view state.
 *
 * This store manages which content (thread or plan) is currently being
 * displayed in the control panel. Tab state is managed locally within
 * the thread view component, not in this store.
 */
export const useControlPanelStore = create<ControlPanelState>((set) => ({
  view: null,

  setView: (view) => set({ view }),

  clearView: () => set({ view: null }),
}));
