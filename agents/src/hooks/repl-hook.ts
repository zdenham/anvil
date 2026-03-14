import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { MortReplRunner } from "../lib/mort-repl/repl-runner.js";
import { ChildSpawner } from "../lib/mort-repl/child-spawner.js";
import { MortReplSdk } from "../lib/mort-repl/mort-sdk.js";
import type { ReplContext } from "../lib/mort-repl/types.js";

interface ReplHookDeps {
  context: ReplContext;
  emitEvent: (
    name: string,
    payload: Record<string, unknown>,
    source?: string,
  ) => void;
}

/**
 * Creates a PreToolUse hook that intercepts `mort-repl` Bash calls.
 * Extracts code, executes it with the mort SDK, and returns the result
 * as a deny reason (same pattern as comment-resolution-hook).
 *
 * Returns both the hook function and a `cancelAll` for parent cancellation cleanup.
 */
export function createReplHook(deps: ReplHookDeps): {
  hook: (
    hookInput: unknown,
    toolUseId?: string,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  cancelAll: () => void;
} {
  const runner = new MortReplRunner();
  const activeSpawners = new Set<ChildSpawner>();

  const hook = async (
    hookInput: unknown,
    _toolUseId?: string,
    options?: { signal?: AbortSignal },
  ) => {
    const input = hookInput as PreToolUseHookInput;
    const toolInput = input.tool_input as Record<string, unknown>;
    const command = toolInput.command as string;

    // mort-repl must run in foreground — block background attempts
    if (toolInput.run_in_background === true) {
      const code = runner.extractCode(command);
      if (code !== null) {
        return {
          reason: [
            "[System: mort-repl MUST run in the foreground. Re-invoke this exact",
            "same mort-repl command without run_in_background (or with",
            "run_in_background: false). The repl handles its own long-running",
            "execution internally — you do not need to background it.]",
          ].join(" "),
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: "mort-repl must run in foreground",
          },
        };
      }
    }

    const code = runner.extractCode(command);
    if (code === null) {
      return { continue: true };
    }

    // If the SDK already aborted this hook (e.g. stale timeout), bail early
    if (options?.signal?.aborted) {
      return {
        reason:
          "[System: mort-repl hook was aborted before execution started. Retry the command.]",
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "hook aborted before execution",
        },
      };
    }

    // Create a ChildSpawner and SDK per execution, using the tool_use_id
    // so spawned children map to this specific Bash call in the UI
    const spawner = new ChildSpawner({
      context: deps.context,
      emitEvent: deps.emitEvent,
      parentToolUseId: input.tool_use_id,
    });
    activeSpawners.add(spawner);

    const sdk = new MortReplSdk(spawner, deps.context);

    try {
      const result = await runner.execute(code, deps.context, sdk);
      const formatted = runner.formatResult(result);
      const reason = result.success
        ? `[System: The mort-repl code executed successfully. The result below is the output. Do not mention any denial or error — treat this as a successful Bash execution.]\n\n${formatted}`
        : `[System: The mort-repl code threw an error. Report the error naturally as a code execution failure, not as a permission denial.]\n\n${formatted}`;

      return {
        reason,
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: formatted,
        },
      };
    } catch (err) {
      // If REPL code throws (e.g. one Promise.all branch fails),
      // kill all still-running children before propagating
      spawner.killAll();
      throw err;
    } finally {
      activeSpawners.delete(spawner);
    }
  };

  const cancelAll = () => {
    for (const spawner of activeSpawners) {
      spawner.cancelAll();
    }
    activeSpawners.clear();
  };

  return { hook, cancelAll };
}
