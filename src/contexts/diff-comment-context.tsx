import { createContext, useContext, useRef, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

interface DiffCommentState {
  worktreeId: string;
  threadId: string | null;
}

function createDiffCommentStore(
  worktreeId: string,
  threadId: string | null,
): StoreApi<DiffCommentState> {
  return createStore<DiffCommentState>(() => ({
    worktreeId,
    threadId,
  }));
}

const DiffCommentStoreContext =
  createContext<StoreApi<DiffCommentState> | null>(null);

export function DiffCommentProvider({
  worktreeId,
  threadId,
  children,
}: {
  worktreeId: string;
  threadId?: string | null;
  children: ReactNode;
}) {
  const storeRef = useRef<StoreApi<DiffCommentState>>(null);
  if (storeRef.current === null) {
    storeRef.current = createDiffCommentStore(worktreeId, threadId ?? null);
  }
  return (
    <DiffCommentStoreContext.Provider value={storeRef.current}>
      {children}
    </DiffCommentStoreContext.Provider>
  );
}

/** Hook with selector support. Throws if not inside a DiffCommentProvider. */
export function useDiffCommentStore<T>(
  selector: (state: DiffCommentState) => T,
): T {
  const store = useContext(DiffCommentStoreContext);
  if (!store) {
    throw new Error(
      "useDiffCommentStore must be used within DiffCommentProvider",
    );
  }
  return useStore(store, selector);
}

/** Returns null if not inside a DiffCommentProvider (for optional usage). */
export function useOptionalDiffCommentStore(): StoreApi<DiffCommentState> | null {
  return useContext(DiffCommentStoreContext);
}
