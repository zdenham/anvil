/**
 * Minimal test runner to validate approaches for intercepting AskUserQuestion
 * via PreToolUse hooks and injecting user answers.
 *
 * Phase 0 experimental spike for the ask-question-hook-gate plan.
 *
 * Environment variables:
 *   APPROACH - "allow_updated" (default) or "deny_reason"
 *     allow_updated: return allow + updatedInput with answers
 *     deny_reason:   return deny + permissionDecisionReason with answers as text
 *
 * Stdout protocol (JSON lines):
 *   { "type": "hook_fired", ... }     - PreToolUse hook invoked
 *   { "type": "hook_returned", ... }  - Hook returned decision
 *   { "type": "post_tool", ... }      - PostToolUse fired (tool executed)
 *   { "type": "message", ... }        - SDK message from stream
 *   { "type": "result", ... }         - Final summary
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

type Approach = "allow_updated" | "deny_reason";
const APPROACH = (process.env.APPROACH ?? "allow_updated") as Approach;

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function main(): Promise<void> {
  let hookFired = false;
  let hookReturned = false;
  let postToolFired = false;
  let capturedToolInput: Record<string, unknown> | null = null;
  let capturedToolResult: unknown = null;

  const result = query({
    prompt: [
      "Use the AskUserQuestion tool to ask the user exactly ONE question.",
      'The question text must be: "Which color do you prefer?"',
      'The header must be: "Color"',
      "Provide exactly two options:",
      '  1. label: "Blue", description: "A cool color"',
      '  2. label: "Red", description: "A warm color"',
      "Set multiSelect to false.",
      "After receiving the answer, respond with ONLY the text: ANSWER_RECEIVED:<the answer>",
      "Do not use any other tools. Do not do anything else.",
    ].join("\n"),
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 4,
      hooks: {
        PreToolUse: [
          {
            matcher: "AskUserQuestion",
            timeout: 60,
            hooks: [
              async (
                hookInput: unknown,
                _toolUseId: string | null,
                { signal: _signal }: { signal: AbortSignal },
              ) => {
                const input = hookInput as {
                  tool_name: string;
                  tool_input: Record<string, unknown>;
                };
                hookFired = true;
                capturedToolInput = input.tool_input;

                // Build the answers map: question text -> selected label
                const questions = input.tool_input.questions as Array<{
                  question: string;
                }>;
                const answers: Record<string, string> = {};
                for (const q of questions) {
                  answers[q.question] = "Blue";
                }

                emit({
                  type: "hook_fired",
                  approach: APPROACH,
                  toolInput: input.tool_input,
                  answers,
                });

                hookReturned = true;

                if (APPROACH === "allow_updated") {
                  // Approach 1: allow + updatedInput with answers injected
                  emit({
                    type: "hook_returned",
                    approach: APPROACH,
                    decision: "allow",
                    updatedInput: { ...input.tool_input, answers },
                  });
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "allow" as const,
                      updatedInput: { ...input.tool_input, answers },
                    },
                  };
                } else {
                  // Approach 2: deny with answers formatted in reason string
                  const reason = [
                    "The user has already answered this question in the UI.",
                    "User answers:",
                    ...Object.entries(answers).map(
                      ([q, a]) => `  Q: "${q}" → A: "${a}"`,
                    ),
                    "Use these answers directly. Do not ask again.",
                  ].join("\n");

                  emit({
                    type: "hook_returned",
                    approach: APPROACH,
                    decision: "deny",
                    reason,
                  });
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "deny" as const,
                      permissionDecisionReason: reason,
                    },
                  };
                }
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "AskUserQuestion",
            hooks: [
              async (hookInput: unknown) => {
                const input = hookInput as {
                  tool_name: string;
                  tool_result: unknown;
                };
                postToolFired = true;
                capturedToolResult = input.tool_result;
                emit({ type: "post_tool", toolResult: input.tool_result });
                return {};
              },
            ],
          },
        ],
      },
    },
  });

  const messages: Array<{ role: string; content: unknown }> = [];

  try {
    for await (const message of result) {
      const msg = message as Record<string, unknown>;
      if (
        msg.type === "assistant" ||
        msg.type === "user" ||
        msg.type === "result"
      ) {
        emit({ type: "message", messageType: msg.type, content: msg });
        messages.push({ role: msg.type as string, content: msg });
      }
    }
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  emit({
    type: "result",
    success: hookFired && hookReturned,
    approach: APPROACH,
    hookFired,
    hookReturned,
    postToolFired,
    capturedToolInput,
    capturedToolResult,
    messageCount: messages.length,
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
