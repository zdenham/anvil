import { create } from "zustand";
import { appData } from "@/lib/app-data-store";
import { RepositorySettingsSchema } from "@core/types/repositories.js";
import { logger } from "@/lib/logger-client";

interface RepoInfo {
  name: string;
  worktrees: Map<string, { name: string; path: string }>;
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
            const worktreeMap = new Map<string, { name: string; path: string }>();

            for (const wt of settings.worktrees) {
              worktreeMap.set(wt.id, { name: wt.name, path: wt.path });
            }

            repos.set(settings.id, {
              name: settings.name,
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
}));
