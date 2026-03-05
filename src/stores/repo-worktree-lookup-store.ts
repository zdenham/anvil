import { create } from "zustand";
import { appData } from "@/lib/app-data-store";
import { RepositorySettingsSchema } from "@core/types/repositories.js";
import { logger } from "@/lib/logger-client";

interface WorktreeLookupInfo {
  name: string;
  path: string;
  currentBranch: string | null;
}

interface RepoInfo {
  name: string;
  defaultBranch: string;
  worktrees: Map<string, WorktreeLookupInfo>;
}

interface RepoWorktreeLookupState {
  /** Map of repoId -> repo info */
  repos: Map<string, RepoInfo>;
  _hydrated: boolean;

  /** Hydrate from all repository settings files */
  hydrate: () => Promise<void>;

  /** Get repository name by ID. Returns "Unknown" if not found. */
  getRepoName: (repoId: string) => string;

  /** Get worktree name by repo ID and worktree ID. Returns "main" if not found. */
  getWorktreeName: (repoId: string, worktreeId: string) => string;

  /** Get worktree path by repo ID and worktree ID. Returns empty string if not found. */
  getWorktreePath: (repoId: string, worktreeId: string) => string;

  /** Get default branch for a repo. Returns "main" if not found. */
  getDefaultBranch: (repoId: string) => string;

  /** Get current branch for a worktree. Returns null if not found. */
  getCurrentBranch: (repoId: string, worktreeId: string) => string | null;

  /** Find repoId by repo name. Returns undefined if not found. */
  getRepoIdByName: (repoName: string) => string | undefined;

  /** Insert a placeholder worktree before the backend creates it */
  addOptimisticWorktree: (repoId: string, tempWorktreeId: string, name: string) => void;

  /** Replace the temp entry with the real one after backend success */
  reconcileWorktree: (repoId: string, tempWorktreeId: string) => void;

  /** Remove placeholder on error/rollback */
  removeOptimisticWorktree: (repoId: string, tempWorktreeId: string) => void;
}

const REPOS_DIR = "repositories";

export const useRepoWorktreeLookupStore = create<RepoWorktreeLookupState>((set, get) => ({
  repos: new Map(),
  _hydrated: false,

  hydrate: async () => {
    const repos = new Map<string, RepoInfo>();

    try {
      const repoDirs = await appData.listDir(REPOS_DIR);

      for (const repoSlug of repoDirs) {
        try {
          const settingsPath = `${REPOS_DIR}/${repoSlug}/settings.json`;
          const raw = await appData.readJson(settingsPath);
          const result = raw ? RepositorySettingsSchema.safeParse(raw) : null;

          if (result?.success) {
            const settings = result.data;
            const worktreeMap = new Map<string, WorktreeLookupInfo>();

            for (const wt of settings.worktrees) {
              worktreeMap.set(wt.id, {
                name: wt.name,
                path: wt.path,
                currentBranch: wt.currentBranch ?? null,
              });
            }

            repos.set(settings.id, {
              name: settings.name,
              defaultBranch: settings.defaultBranch,
              worktrees: worktreeMap,
            });
          }
        } catch (err) {
          logger.warn(`[RepoWorktreeLookup] Failed to load settings for ${repoSlug}:`, err);
        }
      }

      set({ repos, _hydrated: true });
      logger.debug(`[RepoWorktreeLookup] Hydrated ${repos.size} repositories`);
    } catch (err) {
      logger.error("[RepoWorktreeLookup] Failed to hydrate:", err);
      set({ _hydrated: true });
    }
  },

  getRepoName: (repoId: string): string => {
    return get().repos.get(repoId)?.name ?? "Unknown";
  },

  getWorktreeName: (repoId: string, worktreeId: string): string => {
    const repo = get().repos.get(repoId);
    return repo?.worktrees.get(worktreeId)?.name ?? "main";
  },

  getWorktreePath: (repoId: string, worktreeId: string): string => {
    const repo = get().repos.get(repoId);
    return repo?.worktrees.get(worktreeId)?.path ?? "";
  },

  getDefaultBranch: (repoId: string): string => {
    return get().repos.get(repoId)?.defaultBranch ?? "main";
  },

  getCurrentBranch: (repoId: string, worktreeId: string): string | null => {
    const repo = get().repos.get(repoId);
    return repo?.worktrees.get(worktreeId)?.currentBranch ?? null;
  },

  getRepoIdByName: (repoName: string): string | undefined => {
    for (const [repoId, info] of get().repos) {
      if (info.name === repoName) return repoId;
    }
    return undefined;
  },

  addOptimisticWorktree: (repoId: string, tempWorktreeId: string, name: string) => {
    const repos = new Map(get().repos);
    const repo = repos.get(repoId);
    if (!repo) return;

    const worktrees = new Map(repo.worktrees);
    worktrees.set(tempWorktreeId, { name, path: "", currentBranch: null });
    repos.set(repoId, { ...repo, worktrees });
    set({ repos });
  },

  reconcileWorktree: (repoId: string, tempWorktreeId: string) => {
    const repos = new Map(get().repos);
    const repo = repos.get(repoId);
    if (!repo) return;

    const worktrees = new Map(repo.worktrees);
    worktrees.delete(tempWorktreeId);
    repos.set(repoId, { ...repo, worktrees });
    set({ repos });
  },

  removeOptimisticWorktree: (repoId: string, tempWorktreeId: string) => {
    const repos = new Map(get().repos);
    const repo = repos.get(repoId);
    if (!repo) return;

    const worktrees = new Map(repo.worktrees);
    worktrees.delete(tempWorktreeId);
    repos.set(repoId, { ...repo, worktrees });
    set({ repos });
  },
}));
