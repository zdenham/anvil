import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted Types - Zod schemas with derived types
// These are loaded from settings.json on disk
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Active claim on a worktree.
 * Multiple threads on the same task can share a worktree concurrently.
 *
 * Includes migration support for old format: { threadId: string } -> { threadIds: string[] }
 */
export const WorktreeClaimSchema = z.preprocess(
  (data: unknown) => {
    if (data && typeof data === 'object' && 'threadId' in data) {
      // Old format: { threadId: string } -> migrate to { threadIds: string[] }
      const old = data as { threadId: string; taskId: string; claimedAt?: number };
      return {
        taskId: old.taskId,
        threadIds: [old.threadId],
        claimedAt: old.claimedAt ?? Date.now(),
      };
    }
    return data;
  },
  z.object({
    /** The task ID holding the claim */
    taskId: z.string(),
    /** All thread IDs actively using this worktree */
    threadIds: z.array(z.string()),
    /** When the claim was first made */
    claimedAt: z.number(),
  })
);
export type WorktreeClaim = z.infer<typeof WorktreeClaimSchema>;

/**
 * Information about a task's git branch.
 * Stored in repository settings, keyed by task ID.
 */
export const TaskBranchInfoSchema = z.object({
  /** Branch name, e.g., "mort/task-abc123" */
  branch: z.string(),
  /** Base branch this was created from, e.g., "main" or "mort/task-parent" */
  baseBranch: z.string(),
  /** Commit hash at branch creation - used for accurate diffs */
  mergeBase: z.string(),
  /** For subtasks, the parent task ID */
  parentTaskId: z.string().optional(),
  /** Timestamp of branch creation */
  createdAt: z.number(),
});
export type TaskBranchInfo = z.infer<typeof TaskBranchInfoSchema>;

/**
 * State of a single worktree in the pool.
 */
export const WorktreeStateSchema = z.object({
  /** Absolute path to the worktree directory */
  path: z.string(),
  /** Version number (for compatibility/migration) */
  version: z.number(),
  /** Currently checked out branch, or null */
  currentBranch: z.string().nullable(),
  /** Active claim, or null if available */
  claim: WorktreeClaimSchema.nullable(),
  /** When this worktree was last released (for LRU allocation) */
  lastReleasedAt: z.number().optional(),
  /** Last task that used this worktree (for task affinity) */
  lastTaskId: z.string().optional(),
});
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/**
 * Repository settings file structure.
 * Location: ~/.mort/repositories/{repo-slug}/settings.json
 *
 * Includes migration support for older formats:
 * - Adds defaultBranch if missing (defaults to 'main')
 * - Adds worktrees array if missing (defaults to [])
 */
export const RepositorySettingsSchema = z.object({
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
  /** Task branch tracking, keyed by task ID */
  taskBranches: z.record(z.string(), TaskBranchInfoSchema),
  /** Last modification timestamp */
  lastUpdated: z.number(),
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
}
