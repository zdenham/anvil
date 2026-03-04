import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { EventName } from "@core/types/events.js";

interface CommentHookDeps {
  worktreeId: string | undefined;
  emitEvent: (name: string, payload: Record<string, unknown>) => void;
}

/**
 * Creates a PreToolUse hook that intercepts `mort-resolve-comment` Bash calls.
 * Parses comment IDs, emits COMMENT_RESOLVED events, rewrites command to echo.
 */
export function createCommentResolutionHook(deps: CommentHookDeps) {
  return async (hookInput: unknown) => {
    const input = hookInput as PreToolUseHookInput;
    const command = (input.tool_input as Record<string, unknown>).command as string;

    if (!command.trimStart().startsWith("mort-resolve-comment")) {
      // Not our command — pass through to other hooks
      return { continue: true };
    }

    // Parse: mort-resolve-comment "id1,id2,id3"
    const argsMatch = command.match(/mort-resolve-comment\s+["']?([^"']+)["']?/);
    if (!argsMatch) {
      // Invalid usage — deny with reason (agent sees this as the tool error)
      return {
        reason: "Usage: mort-resolve-comment \"<comma-separated-ids>\"",
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "Invalid mort-resolve-comment usage — no IDs provided",
        },
      };
    }

    const ids = argsMatch[1].split(",").map((id) => id.trim()).filter(Boolean);

    if (!deps.worktreeId) {
      return {
        reason: "Cannot resolve comments: no worktreeId in runner context",
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "No worktreeId available",
        },
      };
    }

    // Emit COMMENT_RESOLVED events for each ID
    for (const commentId of ids) {
      deps.emitEvent(EventName.COMMENT_RESOLVED, {
        worktreeId: deps.worktreeId,
        commentId,
      });
    }

    // Deny the command (prevents any Bash execution) but with a success reason
    // so the agent understands the comments were resolved, not that something failed.
    return {
      reason: `Resolved ${ids.length} comment(s): ${ids.join(", ")}. Comments have been marked as resolved internally — no Bash execution needed.`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: `Successfully resolved ${ids.length} comment(s). This is a virtual command handled by the system.`,
      },
    };
  };
}
