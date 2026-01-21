import { z } from 'zod';

export type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused" | "cancelled";

export type AgentType = "entrypoint" | "execution" | "review" | "merge" | "research" | "simple";

// ============================================================================
// Zod Schemas - Source of truth for persisted types
// ============================================================================

/**
 * Schema for a single turn within a thread.
 */
export const ThreadTurnSchema = z.object({
  index: z.number(),
  prompt: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  exitCode: z.number().optional(),
  costUsd: z.number().optional(),
});

/**
 * Base schema for thread metadata before any transformations.
 * Exported for derivation by other schemas that need to omit/extend fields.
 */
export const ThreadMetadataBaseSchema = z.object({
  id: z.string(),
  taskId: z.string(), // Required - every thread must belong to a task
  agentType: z.string(),
  workingDirectory: z.string(),
  status: z.enum(["idle", "running", "completed", "error", "paused", "cancelled"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  ttlMs: z.number().optional(),
  git: z.object({
    branch: z.string(),
    initialCommitHash: z.string().optional(),  // Captured at thread start for diffing
    commitHash: z.string().optional(),
  }).optional(),
  /** File paths modified by Edit/Write tools during this thread - persisted for diff generation */
  changedFilePaths: z.array(z.string()).optional(),
  turns: z.array(ThreadTurnSchema),
  /** Whether the user has viewed this thread's output/activity (defaults to true for new threads) */
  isRead: z.boolean().optional(),
  /** Process ID when agent is running, null otherwise */
  pid: z.number().nullable().optional(),
  /** Path to the worktree this thread is using (for explicit worktree management) */
  worktreePath: z.string().optional(),
  /** Plan ID this thread is associated with (UUID) */
  planId: z.string().uuid().optional(),
});

/**
 * Schema for thread metadata persisted to disk.
 * Validated when loading from JSON files.
 */
export const ThreadMetadataSchema = ThreadMetadataBaseSchema.transform((data) => ({
  ...data,
  isRead: data.isRead ?? true, // Default to true for backwards compatibility
}));

// ============================================================================
// Types derived from schemas - NOT separate interface definitions
// ============================================================================

/** A single turn within a thread */
export type ThreadTurn = z.infer<typeof ThreadTurnSchema>;

/** Thread metadata persisted to disk */
export type ThreadMetadata = z.infer<typeof ThreadMetadataSchema>;

/** Input for creating a new thread */
export interface CreateThreadInput {
  /** Optional pre-generated ID (used for optimistic UI) */
  id?: string;
  taskId: string; // Required - every thread must belong to a task
  agentType: string;
  workingDirectory: string;
  prompt: string;
  git?: {
    branch: string;
  };
  /** Path to the worktree this thread is using (for explicit worktree management) */
  worktreePath?: string;
}

/** Input for updating a thread */
export interface UpdateThreadInput {
  status?: ThreadStatus;
  turns?: ThreadTurn[];
  git?: {
    branch: string;
    initialCommitHash?: string;
    commitHash?: string;
  };
  isRead?: boolean;
  /** Process ID when agent is running, null to clear */
  pid?: number | null;
  /** File paths modified by Edit/Write tools during this thread */
  changedFilePaths?: string[];
  /** Path to the worktree this thread is using (for explicit worktree management) */
  worktreePath?: string;
  /** Plan ID to associate with thread, or null to explicitly unset */
  planId?: string | null;
}

/**
 * Get the folder name for a thread.
 * Format: {agentType}-{uuid}
 */
export function getThreadFolderName(agentType: string, id: string): string {
  return `${agentType}-${id}`;
}

/**
 * Parse a thread folder name to extract agent type and UUID.
 * Returns null if the folder name doesn't match the expected format.
 */
export function parseThreadFolderName(folderName: string): { agentType: string; id: string } | null {
  // Match any agent type followed by a UUID
  const match = folderName.match(/^([a-z]+)-(.+)$/);
  if (!match) return null;
  return { agentType: match[1], id: match[2] };
}
