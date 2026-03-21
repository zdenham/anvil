import { z } from 'zod';
import { TokenUsageSchema } from './events.js';
import { VisualSettingsSchema } from './visual-settings.js';

export type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused" | "cancelled";

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
  id: z.string().uuid(),
  repoId: z.string().uuid(),           // Repository this thread belongs to
  worktreeId: z.string().uuid(),       // Required - main repo is also a worktree
  status: z.enum(["idle", "running", "completed", "error", "paused", "cancelled"]),
  turns: z.array(ThreadTurnSchema),
  git: z.object({
    branch: z.string(),
    initialCommitHash: z.string().optional(),
    commitHash: z.string().optional(),
  }).optional(),
  changedFilePaths: z.array(z.string()).optional(),
  isRead: z.boolean().optional(),
  markedUnreadAt: z.number().optional(), // Timestamp when marked unread (for navigation cooldown)
  pid: z.number().nullable().optional(),
  name: z.string().optional(),           // Auto-generated thread name
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
  _isOptimistic: z.boolean().optional(), // Internal flag - true if optimistic thread not yet confirmed from disk

  // Sub-agent fields (only present for sub-agent threads)
  parentThreadId: z.string().uuid().optional(),   // Parent thread ID (presence implies sub-agent)
  parentToolUseId: z.string().optional(),         // Task tool_use ID that spawned this
  agentType: z.string().optional(),               // "Explore", "Plan", "general-purpose", etc.

  // Token usage (written by agent SDK, read by frontend for cost display)
  lastCallUsage: TokenUsageSchema.optional(),
  cumulativeUsage: TokenUsageSchema.optional(),

  // Cost tracking (written on completion, used for budget caps)
  totalCostUsd: z.number().optional(),           // This thread's own USD cost (written on completion)
  cumulativeCostUsd: z.number().optional(),       // All descendants' cost (rolled up on child completion)
  budgetCapUsd: z.number().positive().optional(), // Budget cap (only on budget root threads)

  // Permission mode for the agent (default: "implement")
  permissionMode: z.enum(["plan", "implement", "approve"]).optional().default("implement"),

  /**
   * Thread kind discriminator. undefined = standard GUI thread.
   * "claude-tui" = Claude CLI running in a PTY terminal.
   * Open string type so new kinds can be added without schema migration.
   */
  threadKind: z.string().optional(),

  /** PTY session ID — only present for TUI threads (threadKind set). */
  terminalId: z.string().uuid().optional(),

  /** Claude CLI session ID for --resume. */
  claudeSessionId: z.string().optional(),

  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
});

/**
 * Schema for thread metadata persisted to disk.
 * Validated when loading from JSON files.
 */
export const ThreadMetadataSchema = ThreadMetadataBaseSchema.transform((data) => ({
  ...data,
  isRead: data.isRead ?? true,
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
  id?: string;                         // Optional pre-generated ID
  repoId: string;                      // Required
  worktreeId: string;                  // Required
  prompt: string;
  parentThreadId?: string;             // Parent thread ID for sub-agent threads
  threadKind?: string;                 // "claude-tui" for TUI threads, undefined for standard GUI
  git?: {
    branch: string;
  };
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
  pid?: number | null;
  changedFilePaths?: string[];
  name?: string;
  permissionMode?: "plan" | "implement" | "approve";
  terminalId?: string;
  claudeSessionId?: string;
  visualSettings?: z.infer<typeof VisualSettingsSchema>;
}

/**
 * Get the folder name for a thread.
 * Thread folders are stored at ~/.mort/threads/{threadId}/
 * The folder name is simply the thread's UUID.
 */
export function getThreadFolderName(id: string): string {
  return id;
}

/**
 * Parse a thread folder name to extract the thread ID.
 * Returns the folder name directly as it is the thread UUID.
 */
export function parseThreadFolderName(folderName: string): string {
  return folderName;
}
