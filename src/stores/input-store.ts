import { create } from 'zustand';

interface InputState {
  // Current active input content
  content: string;

  // For focusing from outside
  focusRequested: boolean;

  // Actions
  setContent: (content: string) => void;
  appendContent: (content: string) => void;
  clearContent: () => void;
  requestFocus: () => void;
  clearFocusRequest: () => void;
}

export const useInputStore = create<InputState>((set) => ({
  content: '',
  focusRequested: false,

  setContent: (content) => set({ content }),

  appendContent: (content) => set((s) => ({ content: s.content + content })),

  clearContent: () => set({ content: '' }),

  requestFocus: () => set({ focusRequested: true }),

  clearFocusRequest: () => set({ focusRequested: false }),
}));
