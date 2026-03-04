import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { z } from "zod";
import { logger } from "@/lib/logger-client";
import { GitCommitSchema, type GitCommit } from "@/hooks/use-git-commits";

const GitCommitArraySchema = z.array(GitCommitSchema);

/** Per-section debounce timers for fetchCommits */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounce delay for commit fetching (ms) */
const DEBOUNCE_MS = 300;

/** Maximum commits to fetch per section */
const COMMIT_LIMIT = 20;

interface CommitStoreState {
  /** Per-section commit lists, keyed by sectionId ("repoId:worktreeId") */
  commitsBySection: Record<string, GitCommit[]>;
  /** Per-section loading state */
  loadingBySection: Record<string, boolean>;
  /** Fetch commits for a section. Debounced internally per-section. */
  fetchCommits: (sectionId: string, worktreePath: string, branchName: string) => void;
}

export const useCommitStore = create<CommitStoreState>((set) => ({
  commitsBySection: {},
  loadingBySection: {},

  fetchCommits: (sectionId: string, worktreePath: string, branchName: string) => {
    // Clear any pending debounce for this section
    const existingTimer = debounceTimers.get(sectionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      debounceTimers.delete(sectionId);

      set((state) => ({
        loadingBySection: { ...state.loadingBySection, [sectionId]: true },
      }));

      try {
        const rawResult = await invoke<unknown>("git_get_branch_commits", {
          branchName,
          workingDirectory: worktreePath,
          limit: COMMIT_LIMIT,
        });
        const commits = GitCommitArraySchema.parse(rawResult);

        set((state) => ({
          commitsBySection: { ...state.commitsBySection, [sectionId]: commits },
          loadingBySection: { ...state.loadingBySection, [sectionId]: false },
        }));
      } catch (err) {
        logger.error("[commit-store] Failed to fetch commits", {
          sectionId,
          branchName,
          worktreePath,
          error: err,
        });
        // Stale-while-revalidate: leave previous cached data in place
        set((state) => ({
          loadingBySection: { ...state.loadingBySection, [sectionId]: false },
        }));
      }
    }, DEBOUNCE_MS);

    debounceTimers.set(sectionId, timer);
  },
}));
