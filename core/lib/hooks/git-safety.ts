/**
 * Shared git safety evaluation logic.
 * Importable by both agents/ (SDK hooks) and sidecar/ (HTTP hooks).
 */

export const BANNED_COMMANDS: Array<{
  pattern: RegExp;
  reason: string;
  suggestion: string;
}> = [
  {
    pattern: /\bgit\s+stash\b(?!\s+(list|show))/,
    reason: "git stash captures ALL tracked modifications — catastrophic in shared worktrees with concurrent agents",
    suggestion: "Use `git diff > /tmp/patch.diff` to save changes, then `git apply /tmp/patch.diff` to restore",
  },
  {
    pattern: /\bgit\s+checkout\s+.*(-f\b|--force\b)/,
    reason: "git checkout --force silently discards uncommitted changes",
    suggestion: "Use `git checkout` without --force and handle conflicts explicitly",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    reason: "git reset --hard discards all uncommitted changes",
    suggestion: "Commit or stash changes first, or use `git diff > /tmp/backup.diff` before resetting",
  },
  {
    pattern: /\bgit\s+clean\s+.*-[a-zA-Z]*f/,
    reason: "git clean -f deletes untracked files permanently",
    suggestion: "Review untracked files with `git clean -n` first, or selectively remove specific files",
  },
  {
    pattern: /\bgit\s+checkout\s+--\s+\.\s*$/,
    reason: "git checkout -- . discards all working tree changes",
    suggestion: "Use `git checkout -- <specific-file>` to discard changes in specific files only",
  },
  {
    pattern: /\bgit\s+restore\s+\.\s*$/,
    reason: "git restore . discards all working tree changes",
    suggestion: "Use `git restore <specific-file>` to restore specific files only",
  },
];

export type GitEvalResult =
  | { allowed: true }
  | { allowed: false; reason: string; suggestion: string };

/**
 * Evaluate a shell command for destructive git patterns.
 * Returns allow/deny with reason and suggestion if blocked.
 */
export function evaluateGitCommand(command: string): GitEvalResult {
  if (!command) {
    return { allowed: true };
  }

  for (const { pattern, reason, suggestion } of BANNED_COMMANDS) {
    if (pattern.test(command)) {
      return { allowed: false, reason, suggestion };
    }
  }

  return { allowed: true };
}
