/**
 * Utilities for pull request entity operations.
 */

import { appData } from "@/lib/app-data-store";
import { RepositorySettingsSchema, type WorktreeState } from "@/entities/repositories/types";
import { logger } from "@/lib/logger-client";

const REPOS_DIR = "repositories";

/**
 * Find a worktree in a repository whose currentBranch matches the given branch name.
 *
 * Reads the repository's settings.json and iterates worktrees to find a match.
 * Returns null if no matching worktree is found.
 *
 * @param repoId - The repository UUID to search within
 * @param branchName - The branch name to match (e.g. "feature/auth")
 */
export async function findWorktreeByBranch(
  repoId: string,
  branchName: string,
): Promise<WorktreeState | null> {
  if (!branchName) return null;

  try {
    // Iterate repo directories to find the one matching repoId
    const repoDirs = await appData.listDir(REPOS_DIR);

    for (const repoSlug of repoDirs) {
      const settingsPath = `${REPOS_DIR}/${repoSlug}/settings.json`;
      const raw = await appData.readJson(settingsPath);
      if (!raw) continue;

      const result = RepositorySettingsSchema.safeParse(raw);
      if (!result.success) continue;

      if (result.data.id !== repoId) continue;

      // Found the repo -- search its worktrees for the branch
      const match = result.data.worktrees.find(
        (wt) => wt.currentBranch === branchName,
      );

      return match ?? null;
    }
  } catch (error) {
    logger.warn("[findWorktreeByBranch] Failed to look up worktree", {
      repoId,
      branchName,
      error,
    });
  }

  return null;
}
