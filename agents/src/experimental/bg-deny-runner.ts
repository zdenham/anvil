/**
 * Spike runner to verify PreToolUse hook deny behavior with run_in_background.
 *
 * Calls query() with a prompt that forces the model to invoke Bash with
 * run_in_background: true. A PreToolUse hook denies background Bash calls
 * using the same reason+hookSpecificOutput pattern as repl-hook.ts.
 *
 * A second foreground Bash call is also prompted to confirm hooks still allow
 * normal tool execution.
 *
 * Stdout protocol (JSON lines):
 *   { "type": "hook_fired", "bg": bool, "command": string }
 *   { "type": "deny_returned", "command": string }
 *   { "type": "allow_returned", "command": string }
 *   { "type": "tool_executed", "command": string, "result": string }
 *   { "type": "tool_failed", "command": string, "error": string }
 *   { "type": "message", "role": string, "content": string }
 *   { "type": "result", ... }
 */
// Must unset CLAUDECODE before importing SDK — otherwise the spawned
// claude subprocess refuses to start ("cannot be launched inside another session").
delete process.env.CLAUDECODE;

import { query } from "@anthropic-ai/claude-agent-sdk";

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// Capture stderr from the claude subprocess for debugging
const stderrChunks: string[] = [];

async function main(): Promise<void> {
  let bgHookFired = false;
  let bgDenyReturned = false;
  let fgHookFired = false;
  let fgAllowReturned = false;
  let bgToolExecuted = false;
  let fgToolExecuted = false;
  const toolResults: Array<{ command: string; result: string; bg: boolean }> = [];

  const result = query({
    stderr: (chunk: string) => {
      stderrChunks.push(chunk);
    },
    prompt: [
      "Do these two things in order:",
      "",
      "1. Run this exact bash command with run_in_background set to true and description set to 'bg canary':",
      '   echo "BG_CANARY_12345"',
      "",
      "2. Then run this exact bash command normally (no run_in_background) with description set to 'fg canary':",
      '   echo "FG_CANARY_67890"',
      "",
      "Do not modify the echo commands. Do not add any other commands.",
    ].join("\n"),
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 4,
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            timeout: 30,
            hooks: [
              async (hookInput: unknown) => {
                const input = hookInput as {
                  tool_name: string;
                  tool_input: Record<string, unknown>;
                  tool_use_id: string;
                };
                const toolInput = input.tool_input;
                const command = (toolInput.command as string) ?? "";
                const isBg = toolInput.run_in_background === true;

                emit({ type: "hook_fired", bg: isBg, command });

                if (isBg) {
                  bgHookFired = true;

                  // Return deny with the same pattern as repl-hook.ts
                  const reason =
                    "[System: DENIED_BG — background execution is not allowed for this command. " +
                    "Re-run without run_in_background.]";

                  emit({ type: "deny_returned", command });
                  bgDenyReturned = true;

                  return {
                    reason,
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "deny" as const,
                      permissionDecisionReason: "background denied by spike test",
                    },
                  };
                }

                // Allow foreground calls
                fgHookFired = true;
                fgAllowReturned = true;
                emit({ type: "allow_returned", command });
                return { continue: true };
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [
              async (hookInput: unknown) => {
                const input = hookInput as {
                  tool_name: string;
                  tool_input: Record<string, unknown>;
                  tool_response: unknown;
                };
                const command = (input.tool_input.command as string) ?? "";
                const isBg = input.tool_input.run_in_background === true;
                const response =
                  typeof input.tool_response === "string"
                    ? input.tool_response
                    : JSON.stringify(input.tool_response);

                emit({ type: "tool_executed", command, result: response, bg: isBg });
                toolResults.push({ command, result: response, bg: isBg });

                if (isBg) bgToolExecuted = true;
                else fgToolExecuted = true;

                return {};
              },
            ],
          },
        ],
      },
    },
  });

  try {
    for await (const message of result) {
      // Log assistant messages so we can see what the model said
      if (
        message.type === "assistant" &&
        "message" in message &&
        typeof message.message === "object" &&
        message.message !== null
      ) {
        const msg = message.message as { role?: string; content?: unknown };
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        emit({ type: "message", role: msg.role ?? "assistant", content: content?.slice(0, 500) });
      }
    }
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      stderr: stderrChunks.join("").slice(-2000),
    });
  }

  emit({
    type: "result",
    success: true,
    bgHookFired,
    bgDenyReturned,
    fgHookFired,
    fgAllowReturned,
    bgToolExecuted,
    fgToolExecuted,
    toolResults,
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
