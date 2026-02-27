import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted Types - Zod schemas with derived types
// These are loaded from settings.json on disk
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Information about a thread's git branch.
 * Stored in repository settings, keyed by thread ID.
 */
export const ThreadBranchInfoSchema = z.object({
  /** Branch name, e.g., "mort/thread-abc123" */
  branch: z.string(),
  /** Base branch this was created from, e.g., "main" or "mort/thread-parent" */
  baseBranch: z.string(),
  /** Commit hash at branch creation - used for accurate diffs */
  mergeBase: z.string(),
  /** For child threads, the parent thread ID */
  parentThreadId: z.string().optional(),
  /** Timestamp of branch creation */
  createdAt: z.number(),
});
export type ThreadBranchInfo = z.infer<typeof ThreadBranchInfoSchema>;

/**
 * State of a single worktree.
 */
export const WorktreeStateSchema = z.object({
  /** UUID for worktree identification */
  id: z.string().uuid(),
  /** Absolute path to the worktree directory */
  path: z.string(),
  /** Name of the worktree */
  name: z.string(),
  /** Creation timestamp (ms since epoch). Defaults to lastAccessedAt for migration. */
  createdAt: z.number().nullable().optional(),
  /** Last access timestamp */
  lastAccessedAt: z.number().nullable().optional(),
  /** Currently checked out branch, or null */
  currentBranch: z.string().nullable().optional(),
  /** Whether this worktree has been renamed from its initial animal name */
  isRenamed: z.boolean().optional(),
});
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/**
 * A worktree combined with its repository context.
 * Used for unified MRU navigation across all repositories.
 */
export interface RepoWorktree {
  repoName: string;
  repoId: string;
  worktree: WorktreeState;
}

/**
 * Repository settings file structure.
 * Location: ~/.mort/repositories/{repo-slug}/settings.json
 *
 * Includes migration support for older formats:
 * - Adds defaultBranch if missing (defaults to 'main')
 * - Adds worktrees array if missing (defaults to [])
 */
export const RepositorySettingsSchema = z.object({
  /** UUID for repository identification */
  id: z.string().uuid(),
  /** Schema version for migrations */
  schemaVersion: z.literal(1),
  /** Repository name */
  name: z.string(),
  /** Original remote URL if cloned, null if local */
  originalUrl: z.string().nullable(),
  /** Path to source repository */
  sourcePath: z.string(),
  /** Whether worktrees are enabled for this repo */
  useWorktrees: z.boolean(),
  /** Default branch name (e.g., "main", "master") */
  defaultBranch: z.string().default('main'),
  /** When this repo was added to mort */
  createdAt: z.number(),
  /** Pool of available worktrees */
  worktrees: z.array(WorktreeStateSchema).default([]),
  /** Thread branch tracking, keyed by thread ID */
  threadBranches: z.record(z.string(), ThreadBranchInfoSchema),
  /** Last modification timestamp */
  lastUpdated: z.number(),
  /** Directory where plan files are stored (relative to repo root) */
  plansDirectory: z.string().default('plans/'),
  /** Directory for completed/archived plans (relative to repo root) */
  completedDirectory: z.string().default('plans/completed/'),
  /** Optional prompt sent to an agent to set up new worktrees (install deps, copy env vars, etc.) */
  worktreeSetupPrompt: z.string().nullable().optional(),
});
export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Repository Metadata - persisted to metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Repository metadata stored in metadata.json.
 * Note: createdAt uses number (Unix timestamp) for consistency with rest of codebase.
 */
export const RepositoryMetadataSchema = z.object({
  name: z.string(),
  originalUrl: z.string().nullable(),
  /** Original source path (needed for worktree operations) */
  sourcePath: z.string().nullable(),
  /** Whether versions are git worktrees (faster) or full copies */
  useWorktrees: z.boolean(),
  createdAt: z.number(),
});
export type RepositoryMetadata = z.infer<typeof RepositoryMetadataSchema>;

/**
 * Repository version info.
 */
export const RepositoryVersionSchema = z.object({
  version: z.number(),
  createdAt: z.number(),
  path: z.string(),
});
export type RepositoryVersion = z.infer<typeof RepositoryVersionSchema>;

/**
 * Full repository with versions.
 */
export const RepositorySchema = RepositoryMetadataSchema.extend({
  versions: z.array(RepositoryVersionSchema),
});
export type Repository = z.infer<typeof RepositorySchema>;

/** Input for creating a new repository */
export interface CreateRepositoryInput {
  name: string;
  originalUrl?: string;
  sourcePath?: string;
  useWorktrees?: boolean;
}

/** Input for updating a repository */
export interface UpdateRepositoryInput {
  name?: string;
  useWorktrees?: boolean;
  /** Update the source path (for relocating moved repositories) */
  sourcePath?: string;
}
