import { invoke } from "@tauri-apps/api/core";
import type { WorktreeState } from "@core/types/repositories";
import { logger } from "@/lib/logger-client";

class WorktreeServiceClient {
  /**
   * Create a new named worktree.
   */
  async create(repoName: string, name: string): Promise<WorktreeState> {
    return invoke("worktree_create", { repoName, name });
  }

  /**
   * Delete a worktree by name.
   */
  async delete(repoName: string, name: string): Promise<void> {
    logger.log(`[WorktreeService] Starting delete for worktree "${name}" in repo "${repoName}"`);
    try {
      await invoke("worktree_delete", { repoName, name });
      logger.log(`[WorktreeService] Successfully deleted worktree "${name}"`);
    } catch (error) {
      logger.error(`[WorktreeService] Failed to delete worktree "${name}":`, error);
      throw error;
    }
  }

  /**
   * Rename a worktree (metadata only, path stays the same).
   */
  async rename(repoName: string, oldName: string, newName: string): Promise<void> {
    return invoke("worktree_rename", { repoName, oldName, newName });
  }

  /**
   * Update lastAccessedAt timestamp (called when task uses worktree).
   */
  async touch(repoName: string, worktreePath: string): Promise<void> {
    return invoke("worktree_touch", { repoName, worktreePath });
  }

  /**
   * Sync worktrees from git: discover existing worktrees and merge with settings.
   * - Adds worktrees that exist in git but not in settings
   * - Removes worktrees from settings that no longer exist on disk
   * - Preserves names and metadata for known worktrees
   */
  async sync(repoName: string): Promise<WorktreeState[]> {
    return invoke("worktree_sync", { repoName });
  }
}

export const worktreeService = new WorktreeServiceClient();
