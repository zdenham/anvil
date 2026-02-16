/**
 * Minimal test runner to verify PreToolUse hook long-timeout behavior.
 *
 * This runner calls query() directly with a PreToolUse hook that delays
 * for a configurable duration before returning allow/deny. It's used by
 * the integration test to verify that the SDK respects custom timeout
 * values on HookMatcher (i.e., hooks can block longer than the default 60s).
 *
 * Environment variables:
 *   HOOK_DELAY_MS     - How long the hook should delay (default: 90000)
 *   HOOK_DECISION     - "allow" or "deny" (default: "allow")
 *   HOOK_TIMEOUT_S    - Timeout value on the HookMatcher in seconds (default: 120)
 *
 * Exit codes:
 *   0 - Agent completed normally
 *   1 - Error
 *
 * Stdout protocol (JSON lines):
 *   { "type": "hook_fired" }              - PreToolUse hook was invoked
 *   { "type": "hook_resolved" }           - Hook finished its delay and returned
 *   { "type": "hook_aborted" }            - Hook's AbortSignal fired before delay completed
 *   { "type": "tool_executed" }           - PostToolUse fired (tool actually ran)
 *   { "type": "result", "success": bool } - Final result
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const HOOK_DELAY_MS = parseInt(process.env.HOOK_DELAY_MS ?? "90000", 10);
const HOOK_DECISION = (process.env.HOOK_DECISION ?? "allow") as "allow" | "deny";
const HOOK_TIMEOUT_S = parseInt(process.env.HOOK_TIMEOUT_S ?? "120", 10);

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function main(): Promise<void> {
  let hookFired = false;
  let hookResolved = false;
  let hookAborted = false;
  let toolExecuted = false;

  const result = query({
    prompt: "Read the file at /dev/null. Do nothing else after that.",
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 2,
      hooks: {
        PreToolUse: [
          {
            matcher: "Read",
            timeout: HOOK_TIMEOUT_S,
            hooks: [
              async (
                _input: unknown,
                _toolUseId: string | null,
                { signal }: { signal: AbortSignal }
              ) => {
                hookFired = true;
                emit({ type: "hook_fired" });

                // Wait for the configured delay, respecting abort signal
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(resolve, HOOK_DELAY_MS);
                  signal.addEventListener(
                    "abort",
                    () => {
                      clearTimeout(timer);
                      hookAborted = true;
                      emit({ type: "hook_aborted" });
                      resolve();
                    },
                    { once: true }
                  );
                });

                hookResolved = true;
                emit({ type: "hook_resolved" });

                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    permissionDecision: HOOK_DECISION,
                    permissionDecisionReason: `Test: ${HOOK_DECISION} after ${HOOK_DELAY_MS}ms delay`,
                  },
                };
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Read",
            hooks: [
              async () => {
                toolExecuted = true;
                emit({ type: "tool_executed" });
                return {};
              },
            ],
          },
        ],
      },
    },
  });

  try {
    for await (const _message of result) {
      // Drain the stream
    }
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  emit({
    type: "result",
    success: true,
    hookFired,
    hookResolved,
    hookAborted,
    toolExecuted,
    decision: HOOK_DECISION,
    delayMs: HOOK_DELAY_MS,
    timeoutS: HOOK_TIMEOUT_S,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    emit({
      type: "result",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
