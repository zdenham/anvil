import type { ThreadMetadata } from "./types.js";
import type { RepositorySettings } from "@core/types/repositories.js";

/**
 * Derives the working directory for a thread from repo/worktree lookup.
 *
 * @param thread - The thread metadata containing repoId and worktreeId
 * @param repoSettings - The repository settings containing worktree paths
 * @returns The absolute path to the working directory
 */
export function deriveWorkingDirectory(
  thread: ThreadMetadata,
  repoSettings: RepositorySettings
): string {
  // Find the worktree by matching worktreeId
  const worktree = repoSettings.worktrees.find(
    (wt) => wt.id === thread.worktreeId
  );

  if (worktree) {
    return worktree.path;
  }

  // Fallback to main repo source path
  return repoSettings.sourcePath;
}
