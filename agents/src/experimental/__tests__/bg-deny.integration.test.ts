/**
 * Spike: Does PreToolUse hook deny block Bash with run_in_background: true?
 *
 * Spawns bg-deny-runner.ts which prompts the model to run a background Bash
 * command and a foreground one. A PreToolUse hook denies the background call
 * using the same reason+hookSpecificOutput pattern as repl-hook.ts.
 *
 * We check:
 *   1. Hook fires for the background call
 *   2. Deny is returned
 *   3. BG_CANARY_12345 does NOT appear in any PostToolUse result (command didn't execute)
 *   4. FG_CANARY_67890 DOES appear in a PostToolUse result (foreground still works)
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(currentDir, "..", "bg-deny-runner.ts");

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

interface RunnerMessage {
  type: string;
  [key: string]: unknown;
}

function runBgDenyRunner(timeoutMs: number): Promise<{
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

    // Unset CLAUDECODE — the SDK spawns a claude subprocess which refuses
    // to start inside another claude session (our test runner is often invoked from claude).
    const { CLAUDECODE: _, ...cleanEnv } = process.env;
    const proc = spawn("tsx", [runnerPath], {
      env: cleanEnv,
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

function findMessages(messages: RunnerMessage[], type: string): RunnerMessage[] {
  return messages.filter((m) => m.type === type);
}

function findMessage(messages: RunnerMessage[], type: string): RunnerMessage | undefined {
  return messages.find((m) => m.type === type);
}

// Spike completed — confirmed SDK callback deny DOES block run_in_background Bash calls.
// The hook fires, deny is enforced, and the command does not execute.
// See plans/breadcrumb-tool-improvements.md for full findings.
describeWithApi.skip("Spike: run_in_background deny enforcement", () => {
  it("PreToolUse deny blocks Bash with run_in_background: true", async () => {
    const output = await runBgDenyRunner(120_000);

    console.log(`Duration: ${output.durationMs}ms`);
    console.log(`Exit code: ${output.exitCode}`);
    console.log(`Messages:\n${JSON.stringify(output.messages, null, 2)}`);
    if (output.stderr) {
      console.log(`Stderr (last 500 chars): ${output.stderr.slice(-500)}`);
    }

    // Runner should exit cleanly
    expect(output.exitCode).toBe(0);

    // --- Assertion 1: Hook fired for the background call ---
    const hookFiredMessages = findMessages(output.messages, "hook_fired");
    const bgHookFired = hookFiredMessages.some((m) => m.bg === true);
    expect(bgHookFired).toBe(true);

    // --- Assertion 2: Deny was returned ---
    const denyMessages = findMessages(output.messages, "deny_returned");
    expect(denyMessages.length).toBeGreaterThanOrEqual(1);

    // --- Assertion 3: BG_CANARY_12345 does NOT appear in any PostToolUse result ---
    // If it does, the deny was not enforced and the command executed anyway
    const toolExecutedMessages = findMessages(output.messages, "tool_executed");
    const bgCanaryInResults = toolExecutedMessages.some(
      (m) => typeof m.result === "string" && m.result.includes("BG_CANARY_12345")
    );
    expect(bgCanaryInResults).toBe(false);

    // --- Assertion 4: FG_CANARY_67890 DOES appear in a PostToolUse result ---
    const fgCanaryInResults = toolExecutedMessages.some(
      (m) => typeof m.result === "string" && m.result.includes("FG_CANARY_67890")
    );
    expect(fgCanaryInResults).toBe(true);

    // --- Assertion 5: Final result flags are consistent ---
    const result = findMessage(output.messages, "result");
    expect(result?.bgHookFired).toBe(true);
    expect(result?.bgDenyReturned).toBe(true);
    expect(result?.bgToolExecuted).toBe(false);
    expect(result?.fgToolExecuted).toBe(true);
  }, 150_000);
});
