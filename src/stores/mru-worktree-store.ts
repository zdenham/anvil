/**
 * MRU Worktree Store
 *
 * Centralized zustand store for Most Recently Used worktree tracking.
 * Owns MRU timestamps and sorted order. References the lookup store
 * for resolving worktree IDs to paths/names.
 */

import { create } from "zustand";
import { useRepoWorktreeLookupStore } from "./repo-worktree-lookup-store";
import { worktreeService } from "@/entities/worktrees";
import { logger } from "@/lib/logger-client";

interface MRUWorktreeState {
  /** worktreeId → lastAccessedAt timestamp (ms) */
  mruTimestamps: Map<string, number>;

  /** Sorted worktreeIds by MRU (most recent first), recomputed on touch */
  mruOrder: string[];

  _hydrated: boolean;

  /** Hydrate from lookup store's worktree settings (reads lastAccessedAt) */
  hydrate: () => void;

  /** Update timestamp, recompute order, fire-and-forget to Rust */
  touchMRU: (worktreeId: string) => void;

  /** Get the most recently used worktree, or null */
  getMRUWorktree: () => { repoId: string; worktreeId: string } | null;

  /** Get all worktrees sorted by MRU */
  getMRUWorktrees: () => Array<{ repoId: string; worktreeId: string }>;
}

function computeOrder(timestamps: Map<string, number>): string[] {
  return [...timestamps.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

export const useMRUWorktreeStore = create<MRUWorktreeState>((set, get) => ({
  mruTimestamps: new Map(),
  mruOrder: [],
  _hydrated: false,

  hydrate: () => {
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const timestamps = new Map<string, number>();

    for (const [, repo] of lookupStore.repos) {
      for (const [wtId, wt] of repo.worktrees) {
        // Include all worktrees — unaccessed ones get 0 so they sort last
        timestamps.set(wtId, wt.lastAccessedAt ?? 0);
      }
    }

    const mruOrder = computeOrder(timestamps);
    set({ mruTimestamps: timestamps, mruOrder, _hydrated: true });
    logger.debug(`[MRUWorktreeStore] Hydrated ${timestamps.size} timestamps, order: ${mruOrder.length}`);
  },

  touchMRU: (worktreeId: string) => {
    const now = Date.now();
    const timestamps = new Map(get().mruTimestamps);
    timestamps.set(worktreeId, now);
    set({ mruTimestamps: timestamps, mruOrder: computeOrder(timestamps) });

    // Fire-and-forget to Rust backend
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const repoId = lookupStore.getRepoIdByWorktreeId(worktreeId);
    if (repoId) {
      const repoName = lookupStore.getRepoName(repoId);
      const path = lookupStore.getWorktreePath(repoId, worktreeId);
      if (repoName !== "Unknown" && path) {
        worktreeService.touch(repoName, path).catch(() => {});
      }
    }
  },

  getMRUWorktree: () => {
    const { mruOrder } = get();
    if (mruOrder.length === 0) return null;

    const lookupStore = useRepoWorktreeLookupStore.getState();
    for (const wtId of mruOrder) {
      const repoId = lookupStore.getRepoIdByWorktreeId(wtId);
      if (repoId) return { repoId, worktreeId: wtId };
    }
    return null;
  },

  getMRUWorktrees: () => {
    const { mruOrder } = get();
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const results: Array<{ repoId: string; worktreeId: string }> = [];

    for (const wtId of mruOrder) {
      const repoId = lookupStore.getRepoIdByWorktreeId(wtId);
      if (repoId) results.push({ repoId, worktreeId: wtId });
    }
    return results;
  },
}));
