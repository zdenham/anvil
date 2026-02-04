import { create } from 'zustand';
import type { QuickActionMetadata } from './types.js';

interface QuickActionsState {
  actions: Record<string, QuickActionMetadata>;  // Keyed by ID for O(1) lookups
  _hydrated: boolean;

  // Selectors
  getAction: (id: string) => QuickActionMetadata | undefined;
  getByHotkey: (hotkey: number) => QuickActionMetadata | undefined;
  getForContext: (context: 'thread' | 'plan' | 'empty') => QuickActionMetadata[];
  getAll: () => QuickActionMetadata[];

  // Mutations (called by service)
  hydrate: (actions: Record<string, QuickActionMetadata>) => void;
  _applyUpdate: (id: string, action: QuickActionMetadata) => void;
  _applyReorder: (orderedIds: string[]) => void;
  _setHydrated: (hydrated: boolean) => void;
}

export const useQuickActionsStore = create<QuickActionsState>((set, get) => ({
  actions: {},
  _hydrated: false,

  getAction: (id) => get().actions[id],

  getByHotkey: (hotkey) => {
    return Object.values(get().actions).find(a => a.hotkey === hotkey && a.enabled);
  },

  getForContext: (context) => {
    return Object.values(get().actions)
      .filter(a => a.enabled && (a.contexts.includes(context) || a.contexts.includes('all')))
      .sort((a, b) => a.order - b.order);
  },

  getAll: () => {
    return Object.values(get().actions).sort((a, b) => a.order - b.order);
  },

  hydrate: (actions) => set({ actions, _hydrated: true }),

  _applyUpdate: (id, action) => set((s) => ({
    actions: { ...s.actions, [id]: action }
  })),

  _applyReorder: (orderedIds) => set((s) => {
    const updated = { ...s.actions };
    orderedIds.forEach((id, index) => {
      if (updated[id]) {
        updated[id] = { ...updated[id], order: index };
      }
    });
    return { actions: updated };
  }),

  _setHydrated: (hydrated) => set({ _hydrated: hydrated }),
}));
