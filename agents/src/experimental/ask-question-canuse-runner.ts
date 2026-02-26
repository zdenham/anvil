/**
 * Phase 0.5 spike: Validate the two-phase hook + canUseTool approach for
 * intercepting AskUserQuestion and injecting user answers.
 *
 * Tests the critical questions:
 *   1. Does canUseTool fire in bypassPermissions mode?
 *   2. Does permissionDecision: "ask" from a hook override bypass mode?
 *   3. Does updatedInput.answers work via the canUseTool path?
 *   4. Does toolUseID match between hook and canUseTool?
 *
 * Environment variables:
 *   APPROACH - Which approach to test:
 *     "two_phase"         (default) hook returns "ask" → canUseTool delivers answers
 *     "canuse_only"       no hook, canUseTool only (tests if canUseTool fires in bypass)
 *     "deny_fallback"     hook returns "deny" with formatted answers (validated fallback)
 *
 * Stdout protocol (JSON lines):
 *   { "type": "hook_fired", ... }      - PreToolUse hook invoked
 *   { "type": "hook_returned", ... }   - Hook returned decision
 *   { "type": "canuse_fired", ... }    - canUseTool callback invoked
 *   { "type": "canuse_returned", ... } - canUseTool returned result
 *   { "type": "post_tool", ... }       - PostToolUse fired (tool executed)
 *   { "type": "message", ... }         - SDK message from stream
 *   { "type": "result", ... }          - Final summary
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

type Approach = "two_phase" | "canuse_only" | "deny_fallback";
const APPROACH = (process.env.APPROACH ?? "two_phase") as Approach;

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function main(): Promise<void> {
  let hookFired = false;
  let hookToolUseId: string | undefined;
  let canUseFired = false;
  let canUseToolUseId: string | undefined;
  let postToolFired = false;
  let capturedToolInput: Record<string, unknown> | null = null;
  let capturedToolResult: unknown = null;

  // Shared stash: hook writes answers, canUseTool reads them
  const answerStash = new Map<string, Record<string, string>>();

  // Pre-defined answers
  const MOCK_ANSWERS: Record<string, string> = {
    "Which color do you prefer?": "Blue",
  };

  const hooks =
    APPROACH === "canuse_only"
      ? {} // No hooks — test if canUseTool fires alone in bypass mode
      : {
          PreToolUse: [
            {
              matcher: "AskUserQuestion" as const,
              timeout: 60,
              hooks: [
                async (
                  hookInput: unknown,
                  toolUseId: string | null,
                  { signal: _signal }: { signal: AbortSignal },
                ) => {
                  const input = hookInput as {
                    tool_name: string;
                    tool_input: Record<string, unknown>;
                  };
                  hookFired = true;
                  hookToolUseId = toolUseId ?? undefined;
                  capturedToolInput = input.tool_input;

                  const questions = input.tool_input.questions as Array<{
                    question: string;
                  }>;
                  const answers: Record<string, string> = {};
                  for (const q of questions) {
                    answers[q.question] =
                      MOCK_ANSWERS[q.question] ?? "default";
                  }

                  emit({
                    type: "hook_fired",
                    approach: APPROACH,
                    toolUseId: toolUseId ?? null,
                    toolInput: input.tool_input,
                    answers,
                  });

                  if (APPROACH === "deny_fallback") {
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

                  // two_phase: stash answers and return "ask" to force canUseTool
                  if (toolUseId) {
                    answerStash.set(toolUseId, answers);
                  }

                  emit({
                    type: "hook_returned",
                    approach: APPROACH,
                    decision: "ask",
                    toolUseId: toolUseId ?? null,
                    stashedAnswers: Object.fromEntries(answerStash),
                  });

                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "ask" as const,
                    },
                  };
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "AskUserQuestion" as const,
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
        };

  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      toolUseID: string;
      decisionReason?: string;
      [key: string]: unknown;
    },
  ) => {
    if (toolName === "AskUserQuestion") {
      canUseFired = true;
      canUseToolUseId = options.toolUseID;

      emit({
        type: "canuse_fired",
        toolName,
        toolUseID: options.toolUseID,
        decisionReason: options.decisionReason ?? null,
        input,
        hookToolUseIdMatch: hookToolUseId === options.toolUseID,
      });

      // Try to get stashed answers from the hook
      const stashedAnswers = answerStash.get(options.toolUseID);

      if (stashedAnswers) {
        answerStash.delete(options.toolUseID);
        const result = {
          behavior: "allow" as const,
          updatedInput: { ...input, answers: stashedAnswers },
        };
        emit({ type: "canuse_returned", result });
        return result;
      }

      // No stashed answers — use hardcoded answers (for canuse_only approach)
      const questions = input.questions as
        | Array<{ question: string }>
        | undefined;
      if (questions) {
        const answers: Record<string, string> = {};
        for (const q of questions) {
          answers[q.question] = MOCK_ANSWERS[q.question] ?? "default";
        }
        const result = {
          behavior: "allow" as const,
          updatedInput: { ...input, answers },
        };
        emit({ type: "canuse_returned", result });
        return result;
      }

      emit({ type: "canuse_returned", result: { behavior: "deny" } });
      return {
        behavior: "deny" as const,
        message: "No answers available",
      };
    }

    // Auto-allow all other tools (replicates bypass behavior)
    return { behavior: "allow" as const, updatedInput: input };
  };

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
      hooks,
      canUseTool,
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
    success: true,
    approach: APPROACH,
    hookFired,
    hookToolUseId: hookToolUseId ?? null,
    canUseFired,
    canUseToolUseId: canUseToolUseId ?? null,
    toolUseIdMatch:
      hookToolUseId != null && canUseToolUseId != null
        ? hookToolUseId === canUseToolUseId
        : null,
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
