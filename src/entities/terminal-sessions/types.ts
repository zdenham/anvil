/**
 * Terminal session types.
 * Terminals are PTY processes managed by the Rust backend.
 */
import { z } from "zod";
import { VisualSettingsSchema } from "@core/types/visual-settings.js";

/**
 * Schema for terminal session metadata persisted to disk.
 * Uses UUID as the primary ID (stable across restarts).
 * The ptyId is the Rust-assigned numeric ID (runtime-only, not persisted).
 */
export const TerminalSessionSchema = z.object({
  /** Stable UUID identifier */
  id: z.string().uuid(),
  /** Rust-assigned PTY ID (null for sessions loaded from disk after restart) */
  ptyId: z.number().nullable().optional(),
  /** Associated worktree ID */
  worktreeId: z.string(),
  /** Working directory path */
  worktreePath: z.string(),
  /** Last executed command (for sidebar display) */
  lastCommand: z.string().optional(),
  /** User-assigned label (overrides lastCommand in sidebar) */
  label: z.string().optional(),
  /** Whether the label was set by the user (true) vs auto-generated (false/undefined) */
  isUserLabel: z.boolean().optional(),
  /** When the terminal was created */
  createdAt: z.number(),
  /** Whether the PTY process is still running */
  isAlive: z.boolean(),
  /** Whether the terminal has been archived (killed) */
  isArchived: z.boolean(),
  /** Visual tree settings (parent, sort key) */
  visualSettings: VisualSettingsSchema.optional(),
});

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

/**
 * Maximum lines to keep in the output buffer for scrollback.
 */
export const OUTPUT_BUFFER_MAX_LINES = 10_000;
