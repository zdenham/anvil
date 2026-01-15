/**
 * Tauri Commands
 *
 * This module provides typed wrappers around Tauri's invoke API for all
 * backend commands. It is the ONLY way to interact with the filesystem,
 * git operations, and other system resources.
 *
 * IMPORTANT: Do NOT use @tauri-apps/plugin-fs or any other Tauri plugins
 * for filesystem operations. All filesystem access must go through the
 * commands defined here (fsCommands), which use our custom Rust backend
 * that properly handles permissions and paths.
 */

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { ThreadStatus, ThreadMetadata } from "@/entities/threads/types";

// Re-export invoke for convenience
export { invoke };

// Re-export types for backward compatibility
export type { ThreadStatus, ThreadMetadata };

// ═══════════════════════════════════════════════════════════════════════════
// Types with Zod Schemas (IPC boundary validation)
// ═══════════════════════════════════════════════════════════════════════════

export const WorktreeInfoSchema = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  isBare: z.boolean(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Git Commands
// ═══════════════════════════════════════════════════════════════════════════

export const gitCommands = {
  /**
   * Detect the repository's default branch.
   * Uses multiple strategies: origin/HEAD, git config, common names, current branch.
   */
  getDefaultBranch: (repoPath: string) =>
    invoke<string>("git_get_default_branch", { repoPath }),

  /**
   * Get the commit hash of a branch.
   */
  getBranchCommit: (repoPath: string, branch: string) =>
    invoke<string>("git_get_branch_commit", { repoPath, branch }),

  /**
   * Create a new git branch from a base branch.
   * Throws if branch already exists.
   */
  createGitBranch: (repoPath: string, branchName: string, baseBranch: string) =>
    invoke<void>("git_create_branch", { repoPath, branchName, baseBranch }),

  /**
   * Checkout a branch in a worktree (with force to discard uncommitted changes).
   */
  checkoutBranch: (worktreePath: string, branch: string) =>
    invoke<void>("git_checkout_branch", { worktreePath, branch }),

  /**
   * Checkout a specific commit in detached HEAD mode.
   * Useful when the branch is already checked out elsewhere.
   */
  checkoutCommit: (worktreePath: string, commit: string) =>
    invoke<void>("git_checkout_commit", { worktreePath, commit }),

  /**
   * Delete a git branch (force delete).
   */
  deleteGitBranch: (repoPath: string, branch: string) =>
    invoke<void>("git_delete_branch", { repoPath, branch }),

  /**
   * Check if a branch exists.
   */
  branchExists: (repoPath: string, branch: string) =>
    invoke<boolean>("git_branch_exists", { repoPath, branch }),

  /**
   * List all mort/* branches.
   */
  listMortBranches: (repoPath: string) =>
    invoke<string[]>("git_list_mort_branches", { repoPath }),

  /**
   * Create a new worktree with detached HEAD, then checkout a branch.
   */
  createWorktree: (repoPath: string, worktreePath: string, branch: string) =>
    invoke<void>("git_create_worktree", { repoPath, worktreePath, branch }),

  /**
   * Remove a worktree.
   */
  removeWorktree: (repoPath: string, worktreePath: string) =>
    invoke<void>("git_remove_worktree", { repoPath, worktreePath }),

  /**
   * List all worktrees.
   */
  listWorktrees: async (repoPath: string): Promise<WorktreeInfo[]> => {
    const raw = await invoke<unknown>("git_list_worktrees", { repoPath });
    return z.array(WorktreeInfoSchema).parse(raw);
  },

  /**
   * List all tracked files in the repository using git ls-files.
   * Returns relative paths from the repository root.
   */
  lsFiles: (repoPath: string) =>
    invoke<string[]>("git_ls_files", { repoPath }),

  /**
   * List all untracked files in the repository using git ls-files --others --exclude-standard.
   * Returns relative paths from the repository root, respecting .gitignore and git excludes.
   */
  lsFilesUntracked: (repoPath: string) =>
    invoke<string[]>("git_ls_files_untracked", { repoPath }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Filesystem Commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filesystem commands using our custom Rust backend.
 *
 * WARNING: Do NOT use @tauri-apps/plugin-fs for file operations.
 * That plugin is not configured and will fail with "Plugin not found".
 * Always use these commands instead.
 */
export const fsCommands = {
  /**
   * Check if a path exists.
   */
  pathExists: (path: string) => invoke<boolean>("fs_exists", { path }),

  /**
   * Read a file's contents.
   */
  readFile: (path: string) => invoke<string>("fs_read_file", { path }),

  /**
   * Write content to a file (creates parent directories if needed).
   */
  writeFile: (path: string, contents: string) =>
    invoke<void>("fs_write_file", { path, contents }),

  /**
   * Get the mort repository directory for a repo (~/.mort/repositories/{repo-name}).
   */
  getRepoDir: (repoName: string) =>
    invoke<string>("fs_get_repo_dir", { repoName }),

  /**
   * Get the source path for a repository (where the actual git repo is).
   */
  getRepoSourcePath: (repoName: string) =>
    invoke<string>("fs_get_repo_source_path", { repoName }),

  /**
   * Get the user's home directory.
   */
  getHomeDir: () => invoke<string>("fs_get_home_dir"),

  /**
   * List file/directory names in a directory (just names, not full entries).
   */
  listDir: (path: string) => invoke<string[]>("fs_list_dir_names", { path }),

  /**
   * Delete a file.
   */
  deleteFile: (path: string) => invoke<void>("fs_remove", { path }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Process Commands
// ═══════════════════════════════════════════════════════════════════════════

export const processCommands = {
  /**
   * Get the path to the runner script.
   */
  getRunnerPath: () => invoke<string>("get_runner_path"),

  /**
   * Spawn an agent process.
   */
  spawnAgentProcess: (args: string[], threadId: string) =>
    invoke<void>("spawn_agent_process", { args, threadId }),

  /**
   * Terminate an agent process.
   */
  terminateAgentProcess: (threadId: string) =>
    invoke<void>("terminate_agent_process", { threadId }),

  /**
   * Check if a process is still running.
   */
  isProcessRunning: (threadId: string) =>
    invoke<boolean>("is_process_running", { threadId }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Thread Commands
// ═══════════════════════════════════════════════════════════════════════════

export const threadCommands = {
  /**
   * Get the status of a thread.
   */
  getThreadStatus: (threadId: string) =>
    invoke<ThreadStatus | null>("get_thread_status", {
      threadId,
    }),

  /**
   * Get full thread metadata.
   */
  getThread: (threadId: string) =>
    invoke<ThreadMetadata | null>("get_thread", {
      threadId,
    }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Lock Commands
// ═══════════════════════════════════════════════════════════════════════════

export const lockCommands = {
  /**
   * Acquire an exclusive lock for a repository.
   * Returns a lock ID that must be passed to releaseLock.
   */
  acquireRepoLock: (repoName: string) =>
    invoke<string>("lock_acquire_repo", { repoName }),

  /**
   * Release a repository lock.
   */
  releaseRepoLock: (lockId: string) =>
    invoke<void>("lock_release_repo", { lockId }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Agent Commands
// ═══════════════════════════════════════════════════════════════════════════

export const agentCommands = {
  /**
   * Get the list of available agent types.
   * Returns: ['research', 'execution', 'review', 'merge']
   */
  getAgentTypes: () => invoke<string[]>("get_agent_types"),
};

// ═══════════════════════════════════════════════════════════════════════════
// Panel Commands
// ═══════════════════════════════════════════════════════════════════════════

export const panelCommands = {
  /**
   * Check if any nspanel is currently visible.
   * Returns true if any panel (spotlight, clipboard, task, error, simple-task, tasks-list) is visible.
   */
  isAnyPanelVisible: () => invoke<boolean>("is_any_panel_visible"),

  /**
   * Check if a specific panel is currently visible.
   * Returns true if the specified panel is visible, false otherwise.
   * @param panelLabel The panel label to check (e.g., "simple-task", "task", "spotlight")
   */
  isPanelVisible: (panelLabel: string) => invoke<boolean>("is_panel_visible", { panelLabel }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Spotlight Shortcut Commands (macOS only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Spotlight shortcut management commands.
 *
 * These commands allow disabling the system Spotlight keyboard shortcut
 * so Mort can use Cmd+Space instead. Requires accessibility permission.
 */
export const spotlightShortcutCommands = {
  /**
   * Disable the system Spotlight keyboard shortcut.
   * Opens System Settings and programmatically navigates to disable the shortcut.
   * Requires accessibility permission to be granted first.
   */
  disableSystemSpotlightShortcut: () =>
    invoke<void>("disable_system_spotlight_shortcut"),

  /**
   * Check if the system Spotlight shortcut is enabled.
   * Returns true if the shortcut is enabled, false if disabled.
   */
  isSystemSpotlightEnabled: () =>
    invoke<boolean>("is_system_spotlight_enabled"),

  /**
   * Check if the app has accessibility permission.
   * This is required before disabling the Spotlight shortcut.
   */
  checkAccessibilityPermission: () =>
    invoke<boolean>("check_accessibility_permission"),

  /**
   * Open System Settings to the Accessibility pane.
   * Use this to guide the user to grant accessibility permission.
   */
  requestAccessibilityPermission: () =>
    invoke<void>("request_accessibility_permission"),
};

// ═══════════════════════════════════════════════════════════════════════════
// Accessibility Status Types and Helpers
// ═══════════════════════════════════════════════════════════════════════════

export interface AccessibilityStatus {
  has_permission: boolean;
  app_name: string | null;
  exe_path: string | null;
  bundle_id: string | null;
}

export async function getAccessibilityStatus(): Promise<AccessibilityStatus> {
  return invoke('get_accessibility_status');
}

export async function checkAccessibilityWithPrompt(prompt: boolean): Promise<boolean> {
  return invoke('check_accessibility_permission_with_prompt', { prompt });
}

// ═══════════════════════════════════════════════════════════════════════════
// Update Commands
// ═══════════════════════════════════════════════════════════════════════════

export const updateCommands = {
  /**
   * Run the internal update script in the background.
   * The script downloads a new version and restarts the app.
   */
  runInternalUpdate: () => invoke<void>("run_internal_update"),
};

// ═══════════════════════════════════════════════════════════════════════════
// Shell Environment Commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Commands for shell environment initialization.
 * Running the login shell may trigger macOS Documents permission prompt
 * if the user's shell config files access ~/Documents.
 */
export const shellEnvironmentCommands = {
  /**
   * Initialize shell environment by running the login shell.
   * This may trigger macOS Documents permission prompt.
   * Should be called after user explicitly clicks "Grant Documents Access".
   * Returns true if a valid PATH was captured from the shell.
   */
  initializeShellEnvironment: () => invoke<boolean>("initialize_shell_environment"),

  /**
   * Check if shell environment has been initialized (login shell has been run).
   */
  isShellInitialized: () => invoke<boolean>("is_shell_initialized"),

  /**
   * Check if the app has Documents folder access.
   * Returns true if we can access ~/Documents, false otherwise.
   *
   * WARNING: This WILL trigger the macOS permission prompt if Documents access
   * hasn't been determined yet. Do NOT call this proactively on UI mount.
   * Use `isShellInitialized()` to check if permission has been granted previously.
   */
  checkDocumentsAccess: () => invoke<boolean>("check_documents_access"),
};
