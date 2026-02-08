/**
 * Terminal session types.
 * Terminals are PTY processes managed by the Rust backend.
 */
import { z } from "zod";

/**
 * Schema for terminal session metadata.
 */
export const TerminalSessionSchema = z.object({
  /** Unique identifier (from Rust backend) */
  id: z.string(),
  /** Associated worktree ID */
  worktreeId: z.string(),
  /** Working directory path */
  worktreePath: z.string(),
  /** Last executed command (for sidebar display) */
  lastCommand: z.string().optional(),
  /** When the terminal was created */
  createdAt: z.number(),
  /** Whether the PTY process is still running */
  isAlive: z.boolean(),
  /** Whether the terminal has been archived (killed) */
  isArchived: z.boolean(),
});

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

/**
 * Maximum lines to keep in the output buffer for scrollback.
 */
export const OUTPUT_BUFFER_MAX_LINES = 5000;
