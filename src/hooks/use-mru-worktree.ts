/**
 * useMRUWorktree Hook
 *
 * Thin selector over useMRUWorktreeStore.
 * Used by:
 * - EmptyPaneContent: For determining which worktree to use for new threads
 * - useActiveWorktreeContext: Fallback when active tab has no worktree context
 */

import { useMRUWorktreeStore } from "@/stores/mru-worktree-store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

export interface MRUWorktreeResult {
  /** The most recently used worktree info, or null if none available */
  mruWorktree: { repoId: string; worktreeId: string } | null;
  /** Working directory path of the MRU worktree, or null if none available */
  workingDirectory: string | null;
  /** The UUID of the MRU repository, or null if none available */
  repoId: string | null;
  /** The UUID of the MRU worktree, or null if none available */
  worktreeId: string | null;
  /** Whether the store has finished hydrating */
  isLoading: boolean;
}

export function useMRUWorktree(): MRUWorktreeResult {
  const hydrated = useMRUWorktreeStore((s) => s._hydrated);
  // Subscribe to mruOrder so we re-render when MRU changes
  const firstWorktreeId = useMRUWorktreeStore((s) => s.mruOrder[0] ?? null);
  const lookupHydrated = useRepoWorktreeLookupStore((s) => s._hydrated);

  const mruWorktree = firstWorktreeId
    ? useMRUWorktreeStore.getState().getMRUWorktree()
    : null;

  const workingDirectory =
    mruWorktree
      ? useRepoWorktreeLookupStore.getState().getWorktreePath(mruWorktree.repoId, mruWorktree.worktreeId) || null
      : null;

  return {
    mruWorktree,
    workingDirectory,
    repoId: mruWorktree?.repoId ?? null,
    worktreeId: mruWorktree?.worktreeId ?? null,
    isLoading: !hydrated || !lookupHydrated,
  };
}
