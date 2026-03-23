import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { evaluateGitCommand } from "@core/lib/hooks/git-safety.js";

/**
 * Creates a PreToolUse hook that blocks destructive git commands.
 * Thin wrapper around shared evaluateGitCommand() logic.
 */
export function createSafeGitHook() {
  return async (hookInput: unknown) => {
    const input = hookInput as PreToolUseHookInput;
    const command = (input.tool_input as Record<string, unknown>)
      .command as string;

    if (!command) {
      return { continue: true };
    }

    const result = evaluateGitCommand(command);
    if (!result.allowed) {
      return {
        reason: `[BLOCKED] ${result.reason}.\n\nSuggestion: ${result.suggestion}`,
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: `Destructive git command blocked: ${result.reason}`,
        },
      };
    }

    return { continue: true };
  };
}
