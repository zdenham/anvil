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

import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger-client";
import { toast } from "@/lib/toast";
import { z } from "zod";
// Re-export invoke for convenience
export { invoke };

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
// Search Types
// ═══════════════════════════════════════════════════════════════════════════

export interface GrepMatch {
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

export interface GrepResponse {
  matches: GrepMatch[];
  truncated: boolean;
}

export interface ThreadContentMatch {
  threadId: string;
  lineContent: string;
  matchIndex: number;
}

export interface ThreadSearchResponse {
  matches: ThreadContentMatch[];
  truncated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Git Commands
// ═══════════════════════════════════════════════════════════════════════════

export const gitCommands = {
  /**
   * Initialize a new git repository at the given path.
   * Creates the directory (and parents) if it doesn't exist.
   */
  init: (path: string) =>
    invoke<void>("git_init", { path }),

  /**
   * Get the current branch name for a worktree.
   * Returns null for detached HEAD.
   */
  getCurrentBranch: (worktreePath: string) =>
    invoke<string | null>("git_get_current_branch", { worktreePath }),

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
   * Checkout a branch in a worktree.
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
   * List all anvil/* branches.
   */
  listAnvilBranches: (repoPath: string) =>
    invoke<string[]>("git_list_anvil_branches", { repoPath }),

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
    const result = z.array(WorktreeInfoSchema).safeParse(raw);
    if (!result.success) {
      logger.error("[tauri-commands] Failed to parse worktree list", {
        error: result.error.message,
        rawPreview: JSON.stringify(raw).slice(0, 200),
        repoPath,
      });
      toast.error("Failed to list worktrees — received corrupted data");
      return [];
    }
    return result.data;
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

  /**
   * Get the current HEAD commit hash.
   * Used to capture initial commit at thread start for diff generation.
   */
  getHeadCommit: (repoPath: string) =>
    invoke<string>("git_get_head_commit", { repoPath }),

  /**
   * Generate a git diff for specific files from a base commit.
   * Returns raw diff output that can be parsed by diff-parser.ts.
   *
   * @param repoPath - Path to the repository
   * @param baseCommit - Base commit hash to diff against
   * @param filePaths - Array of file paths (legacy, for backwards compatibility)
   * @param fileRequests - Array of file requests with operation info (preferred)
   */
  diffFiles: (
    repoPath: string,
    baseCommit: string,
    filePaths: string[],
    fileRequests?: Array<{ path: string; operation: string }>
  ) =>
    invoke<string>("git_diff_files", { repoPath, baseCommit, filePaths, fileRequests }),

  /**
   * Get branch commits for the commit list.
   * Note: useGitCommits hook calls invoke() directly with Zod validation,
   * but this wrapper is provided for other callers.
   */
  getBranchCommits: (workingDirectory: string, branchName: string, limit?: number) =>
    invoke<unknown>("git_get_branch_commits", { workingDirectory, branchName, limit }),

  /**
   * Get the diff introduced by a single commit.
   * Returns raw unified diff string for parseDiff().
   */
  diffCommit: (workingDirectory: string, commitHash: string) =>
    invoke<string>("git_diff_commit", { workingDirectory, commitHash }),

  /**
   * Get the diff between a base commit and the current working tree.
   * Includes staged, unstaged, and untracked file changes.
   */
  diffRange: (workingDirectory: string, baseCommit: string) =>
    invoke<string>("git_diff_range", { workingDirectory, baseCommit }),

  /**
   * Get the diff of uncommitted changes (HEAD to working tree).
   * Includes staged, unstaged, and untracked file changes.
   */
  diffUncommitted: (workingDirectory: string) =>
    invoke<string>("git_diff_uncommitted", { workingDirectory }),

  /**
   * Find the merge base between two branches.
   * Returns the commit hash of the common ancestor.
   */
  getMergeBase: (workingDirectory: string, branchA: string, branchB: string) =>
    invoke<string>("git_get_merge_base", { workingDirectory, branchA, branchB }),

  /**
   * Get the commit hash that a remote branch points to.
   * Used for GitHub-style fallback when on the default branch.
   */
  getRemoteBranchCommit: (workingDirectory: string, remote: string, branch: string) =>
    invoke<string>("git_get_remote_branch_commit", { workingDirectory, remote, branch }),

  /**
   * Get a file's contents at a specific git ref.
   * Used for viewing historical file versions in commit diffs.
   */
  showFile: (cwd: string, path: string, gitRef: string) =>
    invoke<string>("git_show_file", { cwd, path, gitRef }),

  /**
   * Fetch from a remote to update refs.
   */
  fetch: (repoPath: string, remote?: string) =>
    invoke<void>("git_fetch", { repoPath, remote }),

  /**
   * Fetch multiple file contents in a single git cat-file --batch call.
   * Each ref is an object identifier like "abc123:src/foo.ts".
   * Returns null for missing/binary objects, string content for found text files.
   */
  catFileBatch: (cwd: string, refs: string[]) =>
    invoke<(string | null)[]>("git_cat_file_batch", { cwd, refs }),
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
   * Write binary content (base64-encoded) to a file (creates parent directories if needed).
   */
  writeBinaryFile: (path: string, base64Data: string) =>
    invoke<void>("fs_write_binary", { path, base64Data }),

  /**
   * Get the anvil repository directory for a repo (~/.anvil/repositories/{repo-name}).
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
   * Get the anvil data directory (e.g., ~/.anvil or ~/.anvil-dev).
   * Uses the Tauri backend to resolve the suffix-aware path.
   */
  getDataDir: async (): Promise<string> => {
    const info = await invoke<{ data_dir: string }>("get_paths_info");
    return info.data_dir;
  },

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
// Spotlight Shortcut Commands (macOS only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Spotlight shortcut management commands.
 *
 * These commands allow disabling the system Spotlight keyboard shortcut
 * so Anvil can use Cmd+Space instead. Requires accessibility permission.
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

// ═══════════════════════════════════════════════════════════════════════════
// Repository Commands
// ═══════════════════════════════════════════════════════════════════════════

export interface RepoValidation {
  exists: boolean;
  is_git_repo: boolean;
  error: string | null;
}

export const repoCommands = {
  /**
   * Validate that a path exists and is a git repository.
   * Returns validation result with exists, is_git_repo flags and optional error.
   */
  validateRepository: (sourcePath: string) =>
    invoke<RepoValidation>("validate_repository", { sourcePath }),

  /**
   * Remove repository data from ~/.anvil/repositories/{repo_slug}.
   * Used when removing a repository from Anvil.
   */
  removeRepositoryData: async (repoSlug: string): Promise<void> => {
    const anvilDir = await fsCommands.getDataDir();
    return invoke<void>("remove_repository_data", { repoSlug, anvilDir });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Search Commands
// ═══════════════════════════════════════════════════════════════════════════

export const searchCommands = {
  /**
   * Search file contents using git grep.
   * Returns matches with file path, line number, and line content.
   * Uses fixed-string matching (literal, not regex).
   */
  grep: (repoPath: string, query: string, opts?: {
    maxResults?: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    caseSensitive?: boolean;
  }) =>
    invoke<GrepResponse>("git_grep", {
      repoPath,
      query,
      maxResults: opts?.maxResults,
      includePatterns: opts?.includePatterns,
      excludePatterns: opts?.excludePatterns,
      caseSensitive: opts?.caseSensitive,
    }),

  /**
   * Search thread conversation content by grepping state.json files.
   * Searches ~/.anvil/threads/ for the query string.
   * Returns matched snippets with thread IDs.
   */
  searchThreads: (anvilDir: string, query: string, opts?: {
    maxResults?: number;
    caseSensitive?: boolean;
  }) =>
    invoke<ThreadSearchResponse>("search_threads", {
      anvilDir,
      query,
      maxResults: opts?.maxResults,
      caseSensitive: opts?.caseSensitive,
    }),
};
