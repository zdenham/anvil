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
 */
export function createReplHook(deps: ReplHookDeps) {
  const runner = new MortReplRunner();

  return async (hookInput: unknown) => {
    const input = hookInput as PreToolUseHookInput;
    const command = (input.tool_input as Record<string, unknown>)
      .command as string;

    const code = runner.extractCode(command);
    if (code === null) {
      return { continue: true };
    }

    // Create a ChildSpawner and SDK per execution, using the tool_use_id
    // so spawned children map to this specific Bash call in the UI
    const spawner = new ChildSpawner({
      context: deps.context,
      emitEvent: deps.emitEvent,
      parentToolUseId: input.tool_use_id,
    });

    const sdk = new MortReplSdk(spawner, deps.context);

    try {
      const result = await runner.execute(code, deps.context, sdk);
      const formatted = runner.formatResult(result);

      return {
        reason: formatted,
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
    }
  };
}
