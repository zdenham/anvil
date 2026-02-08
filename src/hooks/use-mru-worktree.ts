/**
 * useMRUWorktree Hook
 *
 * Loads and sorts worktrees by most recently used (MRU) across all repositories.
 * Used by:
 * - Spotlight: For selecting the default worktree when creating threads
 * - EmptyPaneContent: For determining which worktree to use for new threads
 *
 * The hook returns the full list of worktrees sorted by lastAccessedAt,
 * as well as convenience accessors for the most recently used worktree.
 */

import { useState, useEffect, useCallback } from "react";
import type { RepoWorktree } from "@core/types/repositories";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { loadSettings } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";

/**
 * Slugifies a repository name for use in paths.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface MRUWorktreeResult {
  /** All worktrees sorted by MRU (most recent first) */
  repoWorktrees: RepoWorktree[];
  /** The most recently used worktree, or null if none available */
  mruWorktree: RepoWorktree | null;
  /** Working directory path of the MRU worktree, or null if none available */
  workingDirectory: string | null;
  /** The UUID of the MRU repository, or null if none available */
  repoId: string | null;
  /** The UUID of the MRU worktree, or null if none available */
  worktreeId: string | null;
  /** Refresh worktrees from disk */
  refresh: () => Promise<void>;
  /** Whether worktrees are currently loading */
  isLoading: boolean;
}

/**
 * Hook to get worktrees sorted by most recently used (MRU).
 *
 * @returns MRU worktree data and helper accessors
 */
export function useMRUWorktree(): MRUWorktreeResult {
  const [repoWorktrees, setRepoWorktrees] = useState<RepoWorktree[]>([]);
  const [repoSettings, setRepoSettings] = useState<Map<string, { id: string; worktrees: { id: string; path: string }[] }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const loadWorktrees = useCallback(async () => {
    const repos = repoService.getAll();

    if (repos.length === 0) {
      logger.debug("[useMRUWorktree] No repositories configured");
      setRepoWorktrees([]);
      setRepoSettings(new Map());
      setIsLoading(false);
      return;
    }

    const allRepoWorktrees: RepoWorktree[] = [];
    const settingsMap = new Map<string, { id: string; worktrees: { id: string; path: string }[] }>();

    for (const repo of repos) {
      try {
        // Sync worktrees from git
        const worktrees = await worktreeService.sync(repo.name);

        // Load settings to get UUIDs
        const slug = slugify(repo.name);
        const settings = await loadSettings(slug);
        settingsMap.set(repo.name, {
          id: settings.id,
          worktrees: settings.worktrees.map((w) => ({ id: w.id, path: w.path })),
        });

        for (const wt of worktrees) {
          allRepoWorktrees.push({
            repoName: repo.name,
            repoId: repo.name, // We'll look up the UUID from settings when needed
            worktree: wt,
          });
        }
      } catch (err) {
        logger.error(`[useMRUWorktree] Failed to load worktrees for ${repo.name}:`, err);
      }
    }

    // Sort by MRU across ALL repos
    allRepoWorktrees.sort(
      (a, b) => (b.worktree.lastAccessedAt ?? 0) - (a.worktree.lastAccessedAt ?? 0)
    );

    logger.debug("[useMRUWorktree] Loaded worktrees", {
      count: allRepoWorktrees.length,
      repoCount: repos.length,
      mru: allRepoWorktrees[0]
        ? `${allRepoWorktrees[0].repoName}/${allRepoWorktrees[0].worktree.name}`
        : "none",
    });

    setRepoWorktrees(allRepoWorktrees);
    setRepoSettings(settingsMap);
    setIsLoading(false);
  }, []);

  // Load worktrees on mount
  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  // Compute derived values
  const mruWorktree = repoWorktrees[0] ?? null;
  const workingDirectory = mruWorktree?.worktree.path ?? null;

  // Look up UUIDs from settings
  let repoId: string | null = null;
  let worktreeId: string | null = null;

  if (mruWorktree) {
    const settings = repoSettings.get(mruWorktree.repoName);
    if (settings) {
      repoId = settings.id;
      const worktreeSetting = settings.worktrees.find(
        (w) => w.path === mruWorktree.worktree.path
      );
      worktreeId = worktreeSetting?.id ?? null;
    }
  }

  return {
    repoWorktrees,
    mruWorktree,
    workingDirectory,
    repoId,
    worktreeId,
    refresh: loadWorktrees,
    isLoading,
  };
}
