/**
 * Platform-agnostic adapter interfaces for the orchestration layer.
 * All methods are synchronous for simpler control flow.
 *
 * Implementations:
 * - Node: Uses fs, simple-git, proper-lockfile
 * - Tauri: Uses Tauri fs/shell commands
 */

// =============================================================================
// FileSystemAdapter
// =============================================================================

/**
 * Synchronous filesystem operations adapter.
 * Provides platform-agnostic file operations for the orchestration layer.
 */
export interface FileSystemAdapter {
  /**
   * Read the entire contents of a file as a UTF-8 string.
   * @param path - Absolute path to the file
   * @returns File contents as string
   * @throws If file does not exist or cannot be read
   */
  readFile(path: string): string;

  /**
   * Write content to a file, creating it if it doesn't exist.
   * Overwrites existing content.
   * @param path - Absolute path to the file
   * @param content - String content to write
   * @throws If file cannot be written
   */
  writeFile(path: string, content: string): void;

  /**
   * Create a directory. Parent directories are created if recursive is true.
   * @param path - Absolute path to the directory
   * @param options - Optional settings (recursive: create parent dirs)
   * @throws If directory cannot be created
   */
  mkdir(path: string, options?: { recursive?: boolean }): void;

  /**
   * Check if a file or directory exists at the given path.
   * @param path - Absolute path to check
   * @returns true if path exists, false otherwise
   */
  exists(path: string): boolean;

  /**
   * Remove a file or directory. For directories, removes recursively.
   * @param path - Absolute path to remove
   * @throws If path cannot be removed
   */
  remove(path: string): void;

  /**
   * Read the contents of a directory.
   * @param path - Absolute path to the directory
   * @returns Array of entry names (files and directories)
   * @throws If directory does not exist or cannot be read
   */
  readDir(path: string): string[];

  /**
   * Find files matching a glob pattern.
   * Required for thread resolution fallback in ResolutionService.scanForThread().
   * @param pattern - Glob pattern (e.g., "**\/*.json")
   * @param cwd - Directory to search from
   * @returns Array of matching file paths relative to cwd
   */
  glob(pattern: string, cwd: string): string[];

  /**
   * List directory contents with metadata.
   * @param path - Absolute path to the directory
   * @returns Array of entries with name, path, isDirectory, isFile
   * @throws If directory does not exist or cannot be read
   */
  listDirWithMetadata(path: string): Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    isFile: boolean;
  }>;

  /**
   * Join path segments using platform-appropriate separator.
   * @param segments - Path segments to join
   * @returns Joined path
   */
  joinPath(...segments: string[]): string;
}

// =============================================================================
// GitAdapter
// =============================================================================

/**
 * Information about a git worktree.
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name if checked out, null if detached HEAD */
  branch: string | null;
  /** Current commit SHA */
  commit: string;
  /** True if this is the bare/main repository */
  bare: boolean;
}

/**
 * Synchronous git operations adapter.
 * Provides platform-agnostic git operations for worktree management.
 */
export interface GitAdapter {
  /**
   * Create a new worktree from the repository.
   * @param repoPath - Path to the main repository
   * @param worktreePath - Path where the worktree will be created
   * @param options - Optional branch or commit to checkout
   * @throws If worktree cannot be created
   */
  createWorktree(
    repoPath: string,
    worktreePath: string,
    options?: { branch?: string; commit?: string }
  ): void;

  /**
   * Remove an existing worktree.
   * @param repoPath - Path to the main repository
   * @param worktreePath - Path to the worktree to remove
   * @param options - Optional force flag to remove even with local changes
   * @throws If worktree cannot be removed
   */
  removeWorktree(
    repoPath: string,
    worktreePath: string,
    options?: { force?: boolean }
  ): void;

  /**
   * List all worktrees for a repository.
   * @param repoPath - Path to the main repository
   * @returns Array of worktree information
   * @throws If worktrees cannot be listed
   */
  listWorktrees(repoPath: string): WorktreeInfo[];

  /**
   * Get the default branch name for a repository (e.g., "main" or "master").
   * @param repoPath - Path to the repository
   * @returns Default branch name
   * @throws If default branch cannot be determined
   */
  getDefaultBranch(repoPath: string): string;

  /**
   * Get the commit SHA that a branch points to.
   * @param repoPath - Path to the repository
   * @param branch - Branch name
   * @returns Commit SHA
   * @throws If branch does not exist
   */
  getBranchCommit(repoPath: string, branch: string): string;

  /**
   * Checkout a specific commit in a worktree (detached HEAD).
   * @param worktreePath - Path to the worktree
   * @param commit - Commit SHA to checkout
   * @throws If checkout fails
   */
  checkoutCommit(worktreePath: string, commit: string): void;

  /**
   * Checkout a branch in a worktree.
   * @param worktreePath - Path to the worktree
   * @param branch - Branch name to checkout
   * @throws If checkout fails
   */
  checkoutBranch(worktreePath: string, branch: string): void;

  /**
   * Find the merge base (common ancestor) of two refs.
   * @param repoPath - Path to the repository
   * @param ref1 - First ref (branch, tag, or commit)
   * @param ref2 - Second ref (branch, tag, or commit)
   * @returns Commit SHA of the merge base
   * @throws If merge base cannot be found
   */
  getMergeBase(repoPath: string, ref1: string, ref2: string): string;

  /**
   * Fetch from a remote to update refs.
   * @param repoPath - Path to the repository
   * @param remote - Remote name (default: "origin")
   */
  fetch(repoPath: string, remote?: string): void;

  /**
   * Check if a branch exists in the repository.
   * @param repoPath - Path to the repository
   * @param branch - Branch name to check
   * @returns true if branch exists, false otherwise
   */
  branchExists(repoPath: string, branch: string): boolean;

  /**
   * Create a new branch at the current HEAD or specified commit.
   * @param worktreePath - Path to the worktree
   * @param branch - Branch name to create
   * @param startPoint - Optional commit/branch to start from (defaults to HEAD)
   * @throws If branch already exists or creation fails
   */
  createBranch(worktreePath: string, branch: string, startPoint?: string): void;

  /**
   * Get the current branch name, or null if in detached HEAD state.
   * @param worktreePath - Path to the worktree
   * @returns Branch name or null if detached
   */
  getCurrentBranch(worktreePath: string): string | null;

  /**
   * List all local branches in the repository.
   * @param repoPath - Path to the repository
   * @returns Array of branch names
   */
  listBranches(repoPath: string): string[];

  /**
   * Get the diff between a base commit and HEAD.
   * @param repoPath - Path to the repository
   * @param baseCommit - The base commit to diff from
   * @returns The diff as a string
   */
  getDiff(repoPath: string, baseCommit: string): string;

  /**
   * Get the HEAD commit hash.
   * @param repoPath - Path to the repository
   * @returns The full commit SHA of HEAD
   */
  getHeadCommit(repoPath: string): string;
}

// =============================================================================
// PathLock
// =============================================================================

/**
 * Information about a held lock.
 */
export interface LockInfo {
  /** Unix timestamp when the lock was acquired */
  acquiredAt: number;
  /** Process ID that holds the lock */
  pid: number;
  /** Hostname of the machine holding the lock */
  hostname: string;
}

/**
 * Options for acquiring a lock.
 */
export interface AcquireOptions {
  /** Maximum number of retry attempts (default: 10) */
  maxRetries?: number;
  /** Delay between retries in milliseconds (default: 100, uses exponential backoff) */
  retryDelayMs?: number;
}

/**
 * Platform-agnostic logger interface.
 * Implementations can pipe to console, file, or remote logging.
 */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/**
 * File-based path locking for exclusive access to worktrees.
 * Uses file-based locking with 30s stale TTL for orphan cleanup.
 */
export interface PathLock {
  /**
   * Acquire an exclusive lock on a path.
   * Blocks until lock is acquired or max retries exceeded.
   * Uses exponential backoff between retries.
   * @param lockPath - Path to the lock file
   * @param options - Optional retry configuration
   * @throws If lock cannot be acquired after retries
   */
  acquire(lockPath: string, options?: AcquireOptions): void;

  /**
   * Release a held lock.
   * @param lockPath - Path to the lock file
   * @throws If lock is not held or cannot be released
   */
  release(lockPath: string): void;

  /**
   * Check if a lock is currently held (by any process).
   * @param lockPath - Path to the lock file
   * @returns true if lock is held, false otherwise
   */
  isHeld(lockPath: string): boolean;
}

// =============================================================================
// FilesystemAdapter (Skills System)
// =============================================================================

/**
 * Low-level filesystem operations adapter.
 *
 * This interface defines ONLY filesystem primitives. High-level business logic
 * (discovery, parsing, priority ordering) belongs in SkillsService, which
 * accepts this adapter as a dependency.
 *
 * Pattern:
 *   SkillsService (one implementation, all business logic)
 *       └── depends on FilesystemAdapter (interface)
 *              ├── NodeFilesystemAdapter (Node.js fs)
 *              └── TauriFilesystemAdapter (Tauri IPC)
 *
 * All methods are async for consistency, even if the underlying implementation
 * uses synchronous operations (e.g., Node.js fs).
 */
export interface FilesystemAdapter {
  /**
   * Read file content as string.
   * @param filePath - Absolute path to file
   * @returns File content or null if not found/unreadable
   */
  readFile(filePath: string): Promise<string | null>;

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * List directory contents.
   */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>>;

  /**
   * Join path segments.
   */
  joinPath(...segments: string[]): string;
}
