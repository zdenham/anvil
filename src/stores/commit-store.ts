import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { z } from "zod";
import { logger } from "@/lib/logger-client";
import { GitCommitSchema, type GitCommit } from "@/hooks/use-git-commits";

const GitCommitArraySchema = z.array(GitCommitSchema);

/** Per-worktree debounce timers for fetchCommits */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounce delay for commit fetching (ms) */
const DEBOUNCE_MS = 300;

/** Maximum commits to fetch per worktree */
const COMMIT_LIMIT = 20;

interface CommitStoreState {
  /** Per-worktree commit lists, keyed by worktreeId (bare UUID) */
  commitsByWorktree: Record<string, GitCommit[]>;
  /** Per-worktree loading state */
  loadingByWorktree: Record<string, boolean>;
  /** Fetch commits for a worktree. Debounced internally per-worktree. */
  fetchCommits: (worktreeId: string, worktreePath: string, branchName: string) => void;
}

export const useCommitStore = create<CommitStoreState>((set) => ({
  commitsByWorktree: {},
  loadingByWorktree: {},

  fetchCommits: (worktreeId: string, worktreePath: string, branchName: string) => {
    // Clear any pending debounce for this worktree
    const existingTimer = debounceTimers.get(worktreeId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      debounceTimers.delete(worktreeId);

      set((state) => ({
        loadingByWorktree: { ...state.loadingByWorktree, [worktreeId]: true },
      }));

      try {
        const rawResult = await invoke<unknown>("git_get_branch_commits", {
          branchName,
          workingDirectory: worktreePath,
          limit: COMMIT_LIMIT,
        });
        const commits = GitCommitArraySchema.parse(rawResult);

        set((state) => ({
          commitsByWorktree: { ...state.commitsByWorktree, [worktreeId]: commits },
          loadingByWorktree: { ...state.loadingByWorktree, [worktreeId]: false },
        }));
      } catch (err) {
        logger.error("[commit-store] Failed to fetch commits", {
          worktreeId,
          branchName,
          worktreePath,
          error: err,
        });
        // Stale-while-revalidate: leave previous cached data in place
        set((state) => ({
          loadingByWorktree: { ...state.loadingByWorktree, [worktreeId]: false },
        }));
      }
    }, DEBOUNCE_MS);

    debounceTimers.set(worktreeId, timer);
  },
}));
