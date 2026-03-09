import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

/**
 * Banned git command patterns with corresponding suggestions.
 * Each entry maps a dangerous pattern to its reason and safe alternative.
 */
const BANNED_COMMANDS: Array<{
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

/**
 * Creates a PreToolUse hook that blocks destructive git commands.
 * Applies everywhere — main repo and agent worktrees alike,
 * since agents do real work in worktrees that shouldn't be destroyed.
 */
export function createSafeGitHook() {
  return async (hookInput: unknown) => {
    const input = hookInput as PreToolUseHookInput;
    const command = (input.tool_input as Record<string, unknown>)
      .command as string;

    if (!command) {
      return { continue: true };
    }

    for (const { pattern, reason, suggestion } of BANNED_COMMANDS) {
      if (pattern.test(command)) {
        return {
          reason: `[BLOCKED] ${reason}.\n\nSuggestion: ${suggestion}`,
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: `Destructive git command blocked: ${reason}`,
          },
        };
      }
    }

    return { continue: true };
  };
}
