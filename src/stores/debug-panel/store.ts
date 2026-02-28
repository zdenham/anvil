import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { DebugPanelTab, DebugPanelPersistedState } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// State Interface
// ═══════════════════════════════════════════════════════════════════════════

interface DebugPanelState {
  isOpen: boolean;
  activeTab: DebugPanelTab;
  panelHeight: number;
  _hydrated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions Interface
// ═══════════════════════════════════════════════════════════════════════════

interface DebugPanelActions {
  hydrate: (state: DebugPanelPersistedState) => void;
  _applyToggle: () => Rollback;
  _applyOpen: (tab?: DebugPanelTab) => Rollback;
  _applyClose: () => Rollback;
  _applySetActiveTab: (tab: DebugPanelTab) => Rollback;
  _applySetPanelHeight: (height: number) => Rollback;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════════════════

export const useDebugPanelStore = create<DebugPanelState & DebugPanelActions>((set, get) => ({
  isOpen: false,
  activeTab: "logs",
  panelHeight: 300,
  _hydrated: false,

  hydrate: (state: DebugPanelPersistedState) => {
    set({
      activeTab: state.activeTab,
      panelHeight: state.panelHeight,
      _hydrated: true,
    });
  },

  _applyToggle: (): Rollback => {
    const prev = get().isOpen;
    set({ isOpen: !prev });
    return () => set({ isOpen: prev });
  },

  _applyOpen: (tab?: DebugPanelTab): Rollback => {
    const prev = { isOpen: get().isOpen, activeTab: get().activeTab };
    set({ isOpen: true, ...(tab ? { activeTab: tab } : {}) });
    return () => set(prev);
  },

  _applyClose: (): Rollback => {
    const prev = get().isOpen;
    set({ isOpen: false });
    return () => set({ isOpen: prev });
  },

  _applySetActiveTab: (tab: DebugPanelTab): Rollback => {
    const prev = get().activeTab;
    set({ activeTab: tab });
    return () => set({ activeTab: prev });
  },

  _applySetPanelHeight: (height: number): Rollback => {
    const prev = get().panelHeight;
    set({ panelHeight: height });
    return () => set({ panelHeight: prev });
  },
}));
