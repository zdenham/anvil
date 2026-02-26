/**
 * Phase 0 spike: Validate approaches for intercepting AskUserQuestion via
 * PreToolUse hooks and injecting user answers back to the agent.
 *
 * Tests two approaches:
 *   1. allow + updatedInput.answers - SDK's documented mechanism
 *   2. deny + permissionDecisionReason with answers as text - fallback
 *
 * The critical question: does the agent receive the user's answer and use it?
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(currentDir, "..", "ask-question-updatedinput-runner.ts");

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

interface RunnerMessage {
  type: string;
  [key: string]: unknown;
}

function runRunner(
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{
  messages: RunnerMessage[];
  exitCode: number;
  stderr: string;
  durationMs: number;
}> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const messages: RunnerMessage[] = [];
    let stderr = "";
    let killed = false;

    const proc = spawn("tsx", [runnerPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        messages.push(JSON.parse(line));
      } catch {
        if (process.env.DEBUG) {
          process.stderr.write(`[runner stdout] ${line}\n`);
        }
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (process.env.DEBUG) {
        process.stderr.write(`[runner stderr] ${data.toString()}`);
      }
    });

    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
      }
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        messages,
        exitCode: killed ? -1 : (code ?? 1),
        stderr: killed
          ? `${stderr}\n[Killed: timeout after ${timeoutMs}ms]`
          : stderr,
        durationMs: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function findMessage(
  messages: RunnerMessage[],
  type: string,
): RunnerMessage | undefined {
  return messages.find((m) => m.type === type);
}

function findAllMessages(
  messages: RunnerMessage[],
  type: string,
): RunnerMessage[] {
  return messages.filter((m) => m.type === type);
}

/** Extract the agent's final text response from message stream */
function extractAgentFinalText(messages: RunnerMessage[]): string | null {
  const assistantMsgs = findAllMessages(messages, "message").filter(
    (m) => m.messageType === "assistant",
  );
  // Get the last assistant message
  const last = assistantMsgs[assistantMsgs.length - 1];
  if (!last) return null;

  const content = last.content as Record<string, unknown>;
  const message = content.message as Record<string, unknown>;
  const contentBlocks = message.content as Array<{
    type: string;
    text?: string;
  }>;
  const textBlock = contentBlocks?.find((b) => b.type === "text");
  return textBlock?.text ?? null;
}

describeWithApi("AskUserQuestion hook spike", () => {
  it("Approach 1: allow + updatedInput.answers", async () => {
    const output = await runRunner(
      { APPROACH: "allow_updated" },
      120_000,
    );

    console.log(`[allow_updated] Duration: ${output.durationMs}ms`);
    console.log(`[allow_updated] Exit code: ${output.exitCode}`);
    console.log(
      `[allow_updated] Messages:\n${output.messages.map((m) => JSON.stringify(m)).join("\n")}`,
    );

    // Should not hang (killed = exitCode -1)
    expect(output.exitCode).not.toBe(-1);

    const hookFired = findMessage(output.messages, "hook_fired");
    expect(hookFired).toBeDefined();

    const result = findMessage(output.messages, "result");
    console.log(`[allow_updated] Result:`, JSON.stringify(result));

    // Check if the agent received and used the answer
    const agentText = extractAgentFinalText(output.messages);
    console.log(`[allow_updated] Agent final text: "${agentText}"`);

    // Key findings to report:
    console.log(`[allow_updated] PostToolUse fired: ${result?.postToolFired}`);
    console.log(`[allow_updated] Tool result: ${JSON.stringify(result?.capturedToolResult)}`);
  }, 150_000);

  it("Approach 2: deny + permissionDecisionReason with answers", async () => {
    const output = await runRunner(
      { APPROACH: "deny_reason" },
      120_000,
    );

    console.log(`[deny_reason] Duration: ${output.durationMs}ms`);
    console.log(`[deny_reason] Exit code: ${output.exitCode}`);
    console.log(
      `[deny_reason] Messages:\n${output.messages.map((m) => JSON.stringify(m)).join("\n")}`,
    );

    // Should not hang
    expect(output.exitCode).not.toBe(-1);

    const hookFired = findMessage(output.messages, "hook_fired");
    expect(hookFired).toBeDefined();

    const result = findMessage(output.messages, "result");
    console.log(`[deny_reason] Result:`, JSON.stringify(result));

    // Check if the agent received and used the answer from the deny reason
    const agentText = extractAgentFinalText(output.messages);
    console.log(`[deny_reason] Agent final text: "${agentText}"`);

    // The deny reason should contain the answer and the agent should extract it
    if (agentText) {
      const hasBlue = agentText.includes("Blue");
      console.log(
        `[deny_reason] Agent response contains "Blue": ${hasBlue}`,
      );
      // The agent should have extracted "Blue" from the deny reason
      expect(hasBlue).toBe(true);
    }
  }, 150_000);
});
