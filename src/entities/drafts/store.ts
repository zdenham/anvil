import { create } from 'zustand';

interface DraftsState {
  threadDrafts: Record<string, string>;
  planDrafts: Record<string, string>;
  emptyDraft: string;
  _hydrated: boolean;

  // Mutations (called by service)
  hydrate: (data: {
    threads: Record<string, string>;
    plans: Record<string, string>;
    empty: string;
  }) => void;
  _setThreadDraft: (threadId: string, content: string) => void;
  _setPlanDraft: (planId: string, content: string) => void;
  _setEmptyDraft: (content: string) => void;
  _clearThreadDraft: (threadId: string) => void;
  _clearPlanDraft: (planId: string) => void;
  _clearEmptyDraft: () => void;
}

export const useDraftsStore = create<DraftsState>((set) => ({
  threadDrafts: {},
  planDrafts: {},
  emptyDraft: '',
  _hydrated: false,

  hydrate: (data) => set({
    threadDrafts: data.threads,
    planDrafts: data.plans,
    emptyDraft: data.empty,
    _hydrated: true,
  }),

  _setThreadDraft: (threadId, content) => set((s) => ({
    threadDrafts: { ...s.threadDrafts, [threadId]: content },
  })),

  _setPlanDraft: (planId, content) => set((s) => ({
    planDrafts: { ...s.planDrafts, [planId]: content },
  })),

  _setEmptyDraft: (content) => set({ emptyDraft: content }),

  _clearThreadDraft: (threadId) => set((s) => {
    const { [threadId]: _, ...rest } = s.threadDrafts;
    return { threadDrafts: rest };
  }),

  _clearPlanDraft: (planId) => set((s) => {
    const { [planId]: _, ...rest } = s.planDrafts;
    return { planDrafts: rest };
  }),

  _clearEmptyDraft: () => set({ emptyDraft: '' }),
}));
