/**
 * Worktree naming service — thin wrapper around core naming logic.
 * Re-exports the shared implementation for backward compatibility.
 */

export {
  generateWorktreeName,
  sanitizeWorktreeName,
  type WorktreeNameResult,
} from "@core/lib/naming/worktree-name.js";
