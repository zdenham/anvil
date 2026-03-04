/**
 * Live spike: confirm fast mode behavior on SDK 0.2.59.
 *
 * Questions to answer:
 * 1. Does `fastMode: true` in settings activate fast mode?
 * 2. Is `usage.speed` present in the response?
 * 3. Is `fast_mode_state` present on results?
 * 4. Does mid-session toggle work (toggling fastMode between queries)?
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(currentDir, "..", "fast-mode-spike-runner.ts");
// Project root is three levels up from __tests__: experimental/__tests__ -> experimental -> src -> agents -> project
const projectRoot = resolve(currentDir, "..", "..", "..", "..");

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

interface RunnerMessage {
  type: string;
  [key: string]: unknown;
}

function runFastModeSpike(
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
      env: { ...process.env, ...env, PROJECT_ROOT: projectRoot },
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

function findMessages(
  messages: RunnerMessage[],
  type: string,
): RunnerMessage[] {
  return messages.filter((m) => m.type === type);
}

function findMessage(
  messages: RunnerMessage[],
  type: string,
): RunnerMessage | undefined {
  return messages.find((m) => m.type === type);
}

describeWithApi("Fast mode spike — SDK 0.2.59 behavior", () => {
  it("fastMode: true — check if fast mode activates and what fields are present", async () => {
    const output = await runFastModeSpike(
      { FAST_MODE: "true" },
      120_000,
    );

    // Log all output for analysis
    for (const msg of output.messages) {
      process.stderr.write(`[spike] ${JSON.stringify(msg)}\n`);
    }
    if (output.stderr) {
      process.stderr.write(`[spike stderr] ${output.stderr.slice(0, 2000)}\n`);
    }

    expect(output.exitCode).toBe(0);

    // Check for usage.speed on streamed messages
    const streamMessages = findMessages(output.messages, "message");
    const hasUsageSpeed = streamMessages.some(
      (m) => (m.usage as any)?.speed !== undefined,
    );

    // Check for fast_mode_state on any message
    const hasFastModeState = streamMessages.some(
      (m) => m.fast_mode_state !== undefined,
    );

    // Check final result
    const result = findMessage(output.messages, "result");
    expect(result).toBeDefined();

    // Log findings — these are the key observations
    process.stderr.write(`\n=== FAST MODE SPIKE RESULTS (fastMode: true) ===\n`);
    process.stderr.write(`usage.speed present: ${hasUsageSpeed}\n`);
    process.stderr.write(`fast_mode_state present: ${hasFastModeState}\n`);
    process.stderr.write(`final fast_mode_state: ${JSON.stringify(result?.finalFastModeState)}\n`);
    process.stderr.write(`final usage: ${JSON.stringify(result?.finalUsage)}\n`);
    process.stderr.write(`session info: ${JSON.stringify(result?.sessionInfo)}\n`);
    process.stderr.write(`===\n\n`);
  }, 120_000);

  it("fastMode: false — confirm standard mode behavior", async () => {
    const output = await runFastModeSpike(
      { FAST_MODE: "false" },
      120_000,
    );

    for (const msg of output.messages) {
      process.stderr.write(`[spike] ${JSON.stringify(msg)}\n`);
    }
    if (output.stderr) {
      process.stderr.write(`[spike stderr] ${output.stderr.slice(0, 2000)}\n`);
    }

    expect(output.exitCode).toBe(0);

    const streamMessages = findMessages(output.messages, "message");
    const hasUsageSpeed = streamMessages.some(
      (m) => (m.usage as any)?.speed !== undefined,
    );
    const hasFastModeState = streamMessages.some(
      (m) => m.fast_mode_state !== undefined,
    );

    const result = findMessage(output.messages, "result");
    expect(result).toBeDefined();

    process.stderr.write(`\n=== FAST MODE SPIKE RESULTS (fastMode: false) ===\n`);
    process.stderr.write(`usage.speed present: ${hasUsageSpeed}\n`);
    process.stderr.write(`fast_mode_state present: ${hasFastModeState}\n`);
    process.stderr.write(`final fast_mode_state: ${JSON.stringify(result?.finalFastModeState)}\n`);
    process.stderr.write(`final usage: ${JSON.stringify(result?.finalUsage)}\n`);
    process.stderr.write(`===\n\n`);
  }, 120_000);

  it("mid-session toggle — fastMode true → false across queries", async () => {
    const output = await runFastModeSpike(
      { FAST_MODE: "true", TEST_TOGGLE: "true" },
      180_000,
    );

    for (const msg of output.messages) {
      process.stderr.write(`[spike] ${JSON.stringify(msg)}\n`);
    }

    expect(output.exitCode).toBe(0);

    const results = findMessages(output.messages, "result");
    expect(results.length).toBe(2);

    const done = findMessage(output.messages, "done");
    expect(done).toBeDefined();
    expect(done?.queriesRun).toBe(2);

    process.stderr.write(`\n=== FAST MODE SPIKE RESULTS (toggle test) ===\n`);
    process.stderr.write(`Query 1 (fastMode: true): fast_mode_state=${JSON.stringify(results[0]?.finalFastModeState)}, usage=${JSON.stringify(results[0]?.finalUsage)}\n`);
    process.stderr.write(`Query 2 (fastMode: false): fast_mode_state=${JSON.stringify(results[1]?.finalFastModeState)}, usage=${JSON.stringify(results[1]?.finalUsage)}\n`);
    process.stderr.write(`Summary: ${JSON.stringify(done?.summary)}\n`);
    process.stderr.write(`===\n\n`);
  }, 180_000);
});
