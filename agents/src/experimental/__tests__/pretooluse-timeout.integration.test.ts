/**
 * Feasibility test for PreToolUse hook long-timeout behavior.
 *
 * Validates the critical assumption behind the permissions-modes plan:
 * that PreToolUse hooks with custom `timeout` values on HookMatcher
 * actually block the agent for longer than the default 60 seconds.
 *
 * This test spawns a minimal runner (pretooluse-timeout-runner.ts) that
 * calls query() with a PreToolUse hook that delays for 90s before returning.
 * The hook has timeout: 120 (seconds) set on its matcher.
 *
 * If the SDK silently fails-open at 60s, the tool will execute before the
 * hook resolves and the test will fail — meaning we can't use this approach
 * for the permissions system and need a fallback.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(currentDir, "..", "pretooluse-timeout-runner.ts");

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

interface RunnerMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Spawn the timeout runner with given env overrides and collect its JSON output.
 */
function runTimeoutRunner(env: Record<string, string>, timeoutMs: number): Promise<{
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
        stderr: killed ? `${stderr}\n[Killed: timeout after ${timeoutMs}ms]` : stderr,
        durationMs: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function findMessage(messages: RunnerMessage[], type: string): RunnerMessage | undefined {
  return messages.find((m) => m.type === type);
}

describeWithApi("PreToolUse hook long-timeout feasibility", () => {

  it("hook blocking for 90s with timeout:120 allows tool after delay", async () => {
    const output = await runTimeoutRunner(
      {
        HOOK_DELAY_MS: "90000",
        HOOK_DECISION: "allow",
        HOOK_TIMEOUT_S: "120",
      },
      180_000 // 3 min subprocess kill timeout
    );

    console.log(`Duration: ${output.durationMs}ms`);
    console.log(`Exit code: ${output.exitCode}`);
    console.log(`Messages: ${JSON.stringify(output.messages, null, 2)}`);

    // Runner should exit cleanly
    expect(output.exitCode).toBe(0);

    // Hook should have fired and resolved (not aborted)
    expect(findMessage(output.messages, "hook_fired")).toBeDefined();
    expect(findMessage(output.messages, "hook_resolved")).toBeDefined();
    expect(findMessage(output.messages, "hook_aborted")).toBeUndefined();

    // Tool should have executed AFTER the hook allowed it
    expect(findMessage(output.messages, "tool_executed")).toBeDefined();

    // Duration should be at least 85s (90s delay minus some tolerance)
    // If it's under 65s, the SDK likely ignored our timeout and failed-open at 60s
    expect(output.durationMs).toBeGreaterThan(85_000);

    // Final result should confirm all flags
    const result = findMessage(output.messages, "result");
    expect(result?.hookFired).toBe(true);
    expect(result?.hookResolved).toBe(true);
    expect(result?.hookAborted).toBe(false);
    expect(result?.toolExecuted).toBe(true);
  }, 200_000); // 200s vitest timeout

  it("hook blocking for 90s with timeout:120 denies tool after delay", async () => {
    const output = await runTimeoutRunner(
      {
        HOOK_DELAY_MS: "90000",
        HOOK_DECISION: "deny",
        HOOK_TIMEOUT_S: "120",
      },
      180_000
    );

    console.log(`Duration: ${output.durationMs}ms`);
    console.log(`Exit code: ${output.exitCode}`);
    console.log(`Messages: ${JSON.stringify(output.messages, null, 2)}`);

    // Runner should exit cleanly
    expect(output.exitCode).toBe(0);

    // Hook should have fired and resolved (not aborted)
    expect(findMessage(output.messages, "hook_fired")).toBeDefined();
    expect(findMessage(output.messages, "hook_resolved")).toBeDefined();
    expect(findMessage(output.messages, "hook_aborted")).toBeUndefined();

    // Tool should NOT have executed (hook denied it)
    expect(findMessage(output.messages, "tool_executed")).toBeUndefined();

    // Duration should be at least 85s
    expect(output.durationMs).toBeGreaterThan(85_000);

    // Final result should confirm denial
    const result = findMessage(output.messages, "result");
    expect(result?.hookFired).toBe(true);
    expect(result?.hookResolved).toBe(true);
    expect(result?.toolExecuted).toBe(false);
  }, 200_000);

  it("hook returning at 70s (past default 60s) confirms custom timeout is active", async () => {
    // This is the critical edge case: delay 70s (past default 60s but within our 120s timeout).
    // If the SDK ignores our custom timeout and uses 60s, the hook will be aborted.
    const output = await runTimeoutRunner(
      {
        HOOK_DELAY_MS: "70000",
        HOOK_DECISION: "allow",
        HOOK_TIMEOUT_S: "120",
      },
      150_000
    );

    console.log(`Duration: ${output.durationMs}ms`);
    console.log(`Exit code: ${output.exitCode}`);
    console.log(`Messages: ${JSON.stringify(output.messages, null, 2)}`);

    expect(output.exitCode).toBe(0);

    // Hook should have resolved, NOT been aborted
    expect(findMessage(output.messages, "hook_resolved")).toBeDefined();
    expect(findMessage(output.messages, "hook_aborted")).toBeUndefined();

    // Tool should have executed after the 70s delay
    expect(findMessage(output.messages, "tool_executed")).toBeDefined();

    // Duration should be 65-130s (70s delay + agent processing overhead)
    expect(output.durationMs).toBeGreaterThan(65_000);
  }, 180_000);
});
