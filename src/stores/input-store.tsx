import { createStore, useStore } from 'zustand';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

export interface InputState {
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

export type InputStore = ReturnType<typeof createInputStore>;

export const createInputStore = () =>
  createStore<InputState>((set) => ({
    content: '',
    focusRequested: false,
    setContent: (content) => set({ content }),
    appendContent: (content) => set((s) => ({ content: s.content + content })),
    clearContent: () => set({ content: '' }),
    requestFocus: () => set({ focusRequested: true }),
    clearFocusRequest: () => set({ focusRequested: false }),
  }));

const InputStoreContext = createContext<InputStore | null>(null);

interface InputStoreProviderProps {
  children: ReactNode;
  /** When true, registers this store as the active one for imperative access. */
  active?: boolean;
}

export function InputStoreProvider({ children, active = false }: InputStoreProviderProps) {
  const storeRef = useRef<InputStore | null>(null);
  if (!storeRef.current) storeRef.current = createInputStore();

  useEffect(() => {
    if (active) {
      activeStore = storeRef.current;
      return () => {
        if (activeStore === storeRef.current) {
          activeStore = null;
        }
      };
    }
  }, [active]);

  return (
    <InputStoreContext.Provider value={storeRef.current}>
      {children}
    </InputStoreContext.Provider>
  );
}

/**
 * Hook for React components — reads from nearest provider.
 */
export function useInputStore<T>(selector: (s: InputState) => T): T {
  const store = useContext(InputStoreContext);
  if (!store) throw new Error('useInputStore must be used within InputStoreProvider');
  return useStore(store, selector);
}

/**
 * Hook to get the raw store instance (for refs in cleanup callbacks).
 */
export function useInputStoreInstance(): InputStore {
  const store = useContext(InputStoreContext);
  if (!store) throw new Error('useInputStoreInstance must be used within InputStoreProvider');
  return store;
}

// ═══════════════════════════════════════════════════════════════════
// Active store registry for imperative (non-React) access
// ═══════════════════════════════════════════════════════════════════

let activeStore: InputStore | null = null;

export function setActiveInputStore(store: InputStore | null) {
  activeStore = store;
}

export function getActiveInputStore(): InputStore | null {
  return activeStore;
}
