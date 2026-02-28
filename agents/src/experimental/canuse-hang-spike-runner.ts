/**
 * Spike: Investigate what causes the agent process to hang after
 * the for-await-of loop breaks on `result:success`.
 *
 * Environment variables:
 *   VARIANT - Which variant to run:
 *     "control"          - No canUseTool, no hooks (baseline)
 *     "canuse_only"      - canUseTool callback, no hooks
 *     "canuse_hooks"     - canUseTool + PreToolUse hooks (matches production)
 *     "hooks_only"       - Hooks but no canUseTool
 *     "async_prompt"     - canUseTool + hooks + AsyncIterable prompt
 *   USE_CLOSE           - "true" to call result.close() after loop
 *
 * Stdout protocol (JSON lines):
 *   { "type": "message", ... }     - Each SDK message received
 *   { "type": "result_seen", ... } - result message yielded by iterator
 *   { "type": "loop_exited", ... } - for-await-of loop has exited
 *   { "type": "close_called", ...} - result.close() was called
 *   { "type": "exiting", ... }     - about to call process.exit(0)
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

type Variant = "control" | "canuse_only" | "canuse_hooks" | "hooks_only" | "async_prompt";
const VARIANT = (process.env.VARIANT ?? "control") as Variant;
const useClose = process.env.USE_CLOSE === "true";

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Simple async generator that yields a single prompt then closes */
async function* asyncPrompt(): AsyncGenerator<{ type: "user"; content: string }> {
  yield { type: "user", content: "Reply with the single word DONE. Do not use any tools." };
}

async function main(): Promise<void> {
  const useCanUseTool = ["canuse_only", "canuse_hooks", "async_prompt"].includes(VARIANT);
  const useHooks = ["canuse_hooks", "hooks_only", "async_prompt"].includes(VARIANT);
  const useAsyncPrompt = VARIANT === "async_prompt";

  const canUseTool = useCanUseTool
    ? async (
        _toolName: string,
        input: Record<string, unknown>,
      ) => ({
        behavior: "allow" as const,
        updatedInput: input,
      })
    : undefined;

  const hooks = useHooks
    ? {
        PreToolUse: [
          {
            matcher: undefined as string | undefined, // Match all tools
            timeout: 120,
            hooks: [
              async (hookInput: unknown) => {
                emit({ type: "hook_fired", input: hookInput });
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    permissionDecision: "allow" as const,
                  },
                };
              },
            ],
          },
        ],
      }
    : undefined;

  // CLAUDECODE must be unset to avoid "nested session" guard in the SDK CLI
  const { CLAUDECODE: _, ...cleanEnv } = process.env;

  const prompt = useAsyncPrompt
    ? asyncPrompt()
    : "Reply with the single word DONE. Do not use any tools.";

  const result = query({
    prompt: prompt as string,
    options: {
      env: cleanEnv as Record<string, string>,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 1,
      ...(canUseTool && { canUseTool }),
      ...(hooks && { hooks }),
    },
  });

  const start = Date.now();

  emit({ type: "started", variant: VARIANT, useClose, elapsed: 0 });

  for await (const message of result) {
    const msg = message as Record<string, unknown>;
    emit({
      type: "message",
      kind: msg.type,
      subtype: msg.subtype ?? null,
      elapsed: Date.now() - start,
    });

    if (msg.type === "result") {
      emit({ type: "result_seen", elapsed: Date.now() - start });
      break;
    }
  }

  emit({ type: "loop_exited", elapsed: Date.now() - start });

  if (useClose && typeof (result as { close?: () => void }).close === "function") {
    (result as { close: () => void }).close();
    emit({ type: "close_called", elapsed: Date.now() - start });
  }

  emit({ type: "exiting", elapsed: Date.now() - start });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
