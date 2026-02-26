/**
 * Phase 0.5 spike: Validate the two-phase hook + canUseTool approach for
 * intercepting AskUserQuestion and injecting user answers.
 *
 * Tests three approaches:
 *   1. two_phase:     hook returns "ask" → canUseTool delivers answers via updatedInput
 *   2. canuse_only:   no hook, canUseTool alone — does it fire in bypass mode?
 *   3. deny_fallback: hook returns "deny" with answers in reason text (already validated)
 *
 * Key questions to answer:
 *   Q1: Does canUseTool fire in bypassPermissions mode?
 *   Q2: Does permissionDecision: "ask" from a hook force canUseTool?
 *   Q3: Does updatedInput.answers via canUseTool work (proper AskUserQuestionOutput)?
 *   Q4: Does toolUseID match between hook and canUseTool?
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(
  currentDir,
  "..",
  "ask-question-canuse-runner.ts",
);

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

describeWithApi("Phase 0.5: Two-phase hook + canUseTool spike", () => {
  it("Approach 1 (two_phase): hook returns 'ask', canUseTool delivers answers", async () => {
    const output = await runRunner(
      { APPROACH: "two_phase" },
      120_000,
    );

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[two_phase] Duration: ${output.durationMs}ms`);
    console.log(`[two_phase] Exit code: ${output.exitCode}`);
    console.log(`[two_phase] Messages:`);
    for (const m of output.messages) {
      console.log(`  ${JSON.stringify(m)}`);
    }
    console.log(`${"=".repeat(60)}\n`);

    // Should not hang
    expect(output.exitCode).not.toBe(-1);

    const hookFired = findMessage(output.messages, "hook_fired");
    const hookReturned = findMessage(output.messages, "hook_returned");
    const canUseFired = findMessage(output.messages, "canuse_fired");
    const canUseReturned = findMessage(output.messages, "canuse_returned");
    const postTool = findMessage(output.messages, "post_tool");
    const result = findMessage(output.messages, "result");

    // === Q1/Q2: Did canUseTool fire? ===
    console.log(`[two_phase] Hook fired: ${!!hookFired}`);
    console.log(`[two_phase] Hook returned: ${JSON.stringify(hookReturned)}`);
    console.log(`[two_phase] canUseTool fired: ${!!canUseFired}`);
    console.log(`[two_phase] canUseTool returned: ${JSON.stringify(canUseReturned)}`);

    // === Q3: Did PostToolUse fire (meaning tool actually executed)? ===
    console.log(`[two_phase] PostToolUse fired: ${!!postTool}`);
    if (postTool) {
      console.log(`[two_phase] Tool result: ${JSON.stringify(postTool.toolResult)}`);
    }

    // === Q4: Do toolUseIDs match? ===
    if (canUseFired) {
      console.log(`[two_phase] toolUseID match: ${canUseFired.hookToolUseIdMatch}`);
    }

    // === Agent final text ===
    const agentText = extractAgentFinalText(output.messages);
    console.log(`[two_phase] Agent final text: "${agentText}"`);

    // === Summary result ===
    console.log(`[two_phase] Result: ${JSON.stringify(result)}`);

    // Assertions
    expect(hookFired).toBeDefined();
  }, 150_000);

  it("Approach 2 (canuse_only): canUseTool alone in bypass mode (no hooks)", async () => {
    const output = await runRunner(
      { APPROACH: "canuse_only" },
      120_000,
    );

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[canuse_only] Duration: ${output.durationMs}ms`);
    console.log(`[canuse_only] Exit code: ${output.exitCode}`);
    console.log(`[canuse_only] Messages:`);
    for (const m of output.messages) {
      console.log(`  ${JSON.stringify(m)}`);
    }
    console.log(`${"=".repeat(60)}\n`);

    expect(output.exitCode).not.toBe(-1);

    const canUseFired = findMessage(output.messages, "canuse_fired");
    const result = findMessage(output.messages, "result");

    // === Q1: Does canUseTool fire WITHOUT a hook in bypass mode? ===
    console.log(`[canuse_only] canUseTool fired: ${!!canUseFired}`);
    console.log(`[canuse_only] Result: ${JSON.stringify(result)}`);

    const agentText = extractAgentFinalText(output.messages);
    console.log(`[canuse_only] Agent final text: "${agentText}"`);
  }, 150_000);

  it("Approach 3 (deny_fallback): hook returns deny with answers in reason", async () => {
    const output = await runRunner(
      { APPROACH: "deny_fallback" },
      120_000,
    );

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[deny_fallback] Duration: ${output.durationMs}ms`);
    console.log(`[deny_fallback] Exit code: ${output.exitCode}`);
    console.log(`[deny_fallback] Messages:`);
    for (const m of output.messages) {
      console.log(`  ${JSON.stringify(m)}`);
    }
    console.log(`${"=".repeat(60)}\n`);

    expect(output.exitCode).not.toBe(-1);

    const hookFired = findMessage(output.messages, "hook_fired");
    const canUseFired = findMessage(output.messages, "canuse_fired");
    const result = findMessage(output.messages, "result");

    console.log(`[deny_fallback] Hook fired: ${!!hookFired}`);
    console.log(`[deny_fallback] canUseTool fired: ${!!canUseFired}`);
    console.log(`[deny_fallback] Result: ${JSON.stringify(result)}`);

    const agentText = extractAgentFinalText(output.messages);
    console.log(`[deny_fallback] Agent final text: "${agentText}"`);

    // deny_fallback is our proven approach — agent should extract "Blue"
    if (agentText) {
      expect(agentText).toContain("Blue");
    }
  }, 150_000);
});
