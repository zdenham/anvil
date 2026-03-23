import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { parseCommentResolution } from "@core/lib/hooks/comment-resolution.js";
import { EventName } from "@core/types/events.js";

interface CommentHookDeps {
  worktreeId: string | undefined;
  emitEvent: (name: string, payload: Record<string, unknown>) => void;
}

/**
 * Creates a PreToolUse hook that intercepts `mort-resolve-comment` Bash calls.
 * Thin wrapper: parses with shared helper, then emits events + returns deny.
 */
export function createCommentResolutionHook(deps: CommentHookDeps) {
  return async (hookInput: unknown) => {
    const input = hookInput as PreToolUseHookInput;
    const command = (input.tool_input as Record<string, unknown>).command as string;

    const parsed = parseCommentResolution(command);
    if (!parsed) {
      return { continue: true };
    }

    if (parsed.ids.length === 0) {
      return {
        reason: "Usage: mort-resolve-comment \"<comma-separated-ids>\"",
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "Invalid mort-resolve-comment usage — no IDs provided",
        },
      };
    }

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

    for (const commentId of parsed.ids) {
      deps.emitEvent(EventName.COMMENT_RESOLVED, {
        worktreeId: deps.worktreeId,
        commentId,
      });
    }

    return {
      reason: `Resolved ${parsed.ids.length} comment(s): ${parsed.ids.join(", ")}. Comments have been marked as resolved internally — no Bash execution needed.`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: `Successfully resolved ${parsed.ids.length} comment(s). This is a virtual command handled by the system.`,
      },
    };
  };
}
