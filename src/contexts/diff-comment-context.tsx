import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

interface DiffCommentState {
  worktreeId: string;
  repoId: string;
  worktreePath: string;
  threadId: string | null;
}

function createDiffCommentStore(
  worktreeId: string,
  repoId: string,
  worktreePath: string,
  threadId: string | null,
): StoreApi<DiffCommentState> {
  return createStore<DiffCommentState>(() => ({
    worktreeId,
    repoId,
    worktreePath,
    threadId,
  }));
}

const DiffCommentStoreContext =
  createContext<StoreApi<DiffCommentState> | null>(null);

export function DiffCommentProvider({
  worktreeId,
  repoId,
  worktreePath,
  threadId,
  children,
}: {
  worktreeId: string;
  repoId: string;
  worktreePath: string;
  threadId?: string | null;
  children: ReactNode;
}) {
  // Create store once per worktreeId+threadId combination
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(
    () => createDiffCommentStore(worktreeId, repoId, worktreePath, threadId ?? null),
    [worktreeId, repoId, worktreePath, threadId],
  );
  return (
    <DiffCommentStoreContext.Provider value={store}>
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
