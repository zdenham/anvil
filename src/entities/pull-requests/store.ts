import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { RepoMergeSettings } from "@/lib/gh-cli";
import type { PullRequestMetadata, PullRequestDetails } from "./types";

interface PullRequestStoreState {
  /** All PR metadata keyed by UUID (single copy per entity) */
  pullRequests: Record<string, PullRequestMetadata>;
  /** Cached array of all PRs (avoids Object.values() in selectors) */
  _prsArray: PullRequestMetadata[];
  /** Cached display data, keyed by PR entity ID. Ephemeral, never persisted. */
  prDetails: Record<string, PullRequestDetails>;
  /** Loading state per PR (for skeleton display on first load) */
  prDetailsLoading: Record<string, boolean>;
  /** Cached repo merge settings, keyed by repoSlug */
  repoMergeSettings: Record<string, RepoMergeSettings>;
  _hydrated: boolean;
}

interface PullRequestStoreActions {
  /** Hydration (called once at app start) */
  hydrate(prs: Record<string, PullRequestMetadata>): void;

  /** Selectors */
  getPr(id: string): PullRequestMetadata | undefined;
  getPrByRepoAndNumber(
    repoId: string,
    prNumber: number,
  ): PullRequestMetadata | undefined;
  getPrsByWorktree(worktreeId: string): PullRequestMetadata[];
  getPrsByRepo(repoId: string): PullRequestMetadata[];
  getPrDetails(id: string): PullRequestDetails | undefined;

  /** Optimistic apply methods -- return rollback for use with optimistic() */
  _applyCreate(pr: PullRequestMetadata): Rollback;
  _applyUpdate(id: string, pr: PullRequestMetadata): Rollback;
  _applyDelete(id: string): Rollback;

  /** Display data cache management */
  setPrDetails(id: string, details: PullRequestDetails): void;
  setPrDetailsLoading(id: string, loading: boolean): void;
  clearPrDetails(id: string): void;
  setRepoMergeSettings(repoSlug: string, settings: RepoMergeSettings): void;
}

export const usePullRequestStore = create<
  PullRequestStoreState & PullRequestStoreActions
>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  pullRequests: {},
  _prsArray: [],
  prDetails: {},
  prDetailsLoading: {},
  repoMergeSettings: {},
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (prs) => {
    set({
      pullRequests: prs,
      _prsArray: Object.values(prs),
      _hydrated: true,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Selectors
  // ═══════════════════════════════════════════════════════════════════════════
  getPr: (id) => get().pullRequests[id],

  getPrByRepoAndNumber: (repoId, prNumber) =>
    get()._prsArray.find(
      (pr) => pr.repoId === repoId && pr.prNumber === prNumber,
    ),

  getPrsByWorktree: (worktreeId) =>
    get()._prsArray.filter((pr) => pr.worktreeId === worktreeId),

  getPrsByRepo: (repoId) =>
    get()._prsArray.filter((pr) => pr.repoId === repoId),

  getPrDetails: (id) => get().prDetails[id],

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applyCreate: (pr: PullRequestMetadata): Rollback => {
    set((state) => {
      const newPrs = { ...state.pullRequests, [pr.id]: pr };
      return {
        pullRequests: newPrs,
        _prsArray: Object.values(newPrs),
      };
    });
    return () =>
      set((state) => {
        const { [pr.id]: _, ...rest } = state.pullRequests;
        return {
          pullRequests: rest,
          _prsArray: Object.values(rest),
        };
      });
  },

  _applyUpdate: (id: string, pr: PullRequestMetadata): Rollback => {
    const prev = get().pullRequests[id];
    set((state) => {
      const newPrs = { ...state.pullRequests, [id]: pr };
      return {
        pullRequests: newPrs,
        _prsArray: Object.values(newPrs),
      };
    });
    return () =>
      set((state) => {
        const restored = prev
          ? { ...state.pullRequests, [id]: prev }
          : state.pullRequests;
        return {
          pullRequests: restored,
          _prsArray: Object.values(restored),
        };
      });
  },

  _applyDelete: (id: string): Rollback => {
    const prev = get().pullRequests[id];
    const prevDetails = get().prDetails[id];
    const prevLoading = get().prDetailsLoading[id];
    set((state) => {
      const { [id]: _, ...rest } = state.pullRequests;
      const { [id]: __, ...restDetails } = state.prDetails;
      const { [id]: ___, ...restLoading } = state.prDetailsLoading;
      return {
        pullRequests: rest,
        _prsArray: Object.values(rest),
        prDetails: restDetails,
        prDetailsLoading: restLoading,
      };
    });
    return () =>
      set((state) => {
        const restored = prev
          ? { ...state.pullRequests, [id]: prev }
          : state.pullRequests;
        const restoredDetails = prevDetails
          ? { ...state.prDetails, [id]: prevDetails }
          : state.prDetails;
        const restoredLoading =
          prevLoading !== undefined
            ? { ...state.prDetailsLoading, [id]: prevLoading }
            : state.prDetailsLoading;
        return {
          pullRequests: restored,
          _prsArray: Object.values(restored),
          prDetails: restoredDetails,
          prDetailsLoading: restoredLoading,
        };
      });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Display Data Management
  // ═══════════════════════════════════════════════════════════════════════════
  setPrDetails: (id, details) => {
    set((state) => ({
      prDetails: { ...state.prDetails, [id]: details },
    }));
  },

  setPrDetailsLoading: (id, loading) => {
    set((state) => ({
      prDetailsLoading: { ...state.prDetailsLoading, [id]: loading },
    }));
  },

  clearPrDetails: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.prDetails;
      return { prDetails: rest };
    });
  },

  setRepoMergeSettings: (repoSlug, settings) => {
    set((state) => ({
      repoMergeSettings: { ...state.repoMergeSettings, [repoSlug]: settings },
    }));
  },
}));
