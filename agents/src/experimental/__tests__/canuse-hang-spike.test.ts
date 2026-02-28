/**
 * Spike: Prove that providing `canUseTool` to query() causes the runner
 * process to hang after the for-await-of loop breaks, and that calling
 * result.close() fixes it.
 *
 * Three variants:
 *   1. Control (no canUseTool)     — should exit cleanly in <15s
 *   2. Treatment (with canUseTool) — should hang until killed (proves hypothesis)
 *   3. Fix (canUseTool + close())  — should exit cleanly (proves fix works)
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(currentDir, "..", "canuse-hang-spike-runner.ts");

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

interface RunnerMessage {
  type: string;
  elapsed?: number;
  [key: string]: unknown;
}

function runSpike(opts: {
  useCanUseTool: boolean;
  useClose: boolean;
  timeoutMs: number;
}): Promise<{
  messages: RunnerMessage[];
  exitCode: number | null;
  killed: boolean;
  elapsed: number;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const messages: RunnerMessage[] = [];
    let stderr = "";
    let killed = false;

    const proc = spawn("tsx", [runnerPath], {
      env: {
        ...process.env,
        USE_CAN_USE_TOOL: String(opts.useCanUseTool),
        USE_CLOSE: String(opts.useClose),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // non-JSON output, ignore
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, opts.timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        messages,
        exitCode: code,
        killed,
        elapsed: Date.now() - start,
        stderr,
      });
    });

    proc.on("error", reject);
  });
}

function findMessage(messages: RunnerMessage[], type: string): RunnerMessage | undefined {
  return messages.find((m) => m.type === type);
}

describeWithApi("canUseTool hang spike", () => {
  const HANG_TIMEOUT_MS = 30_000;
  const CLEAN_EXIT_THRESHOLD_MS = 20_000;

  it("CONTROL: without canUseTool, process exits cleanly after result", async () => {
    const run = await runSpike({
      useCanUseTool: false,
      useClose: false,
      timeoutMs: HANG_TIMEOUT_MS,
    });

    console.log("\n--- CONTROL (no canUseTool) ---");
    console.log(`Exit code: ${run.exitCode}, killed: ${run.killed}, elapsed: ${run.elapsed}ms`);
    for (const m of run.messages) console.log(`  ${JSON.stringify(m)}`);

    // Should exit cleanly without being killed
    expect(run.killed).toBe(false);
    expect(run.exitCode).toBe(0);
    expect(run.elapsed).toBeLessThan(CLEAN_EXIT_THRESHOLD_MS);

    // Should have seen result and loop_exited
    expect(findMessage(run.messages, "result_seen")).toBeDefined();
    expect(findMessage(run.messages, "loop_exited")).toBeDefined();
    expect(findMessage(run.messages, "exiting")).toBeDefined();
  }, 60_000);

  it("TREATMENT: with canUseTool, process hangs after result (proves hypothesis)", async () => {
    const run = await runSpike({
      useCanUseTool: true,
      useClose: false,
      timeoutMs: HANG_TIMEOUT_MS,
    });

    console.log("\n--- TREATMENT (with canUseTool, no close) ---");
    console.log(`Exit code: ${run.exitCode}, killed: ${run.killed}, elapsed: ${run.elapsed}ms`);
    for (const m of run.messages) console.log(`  ${JSON.stringify(m)}`);

    // If hypothesis is correct: process was killed by timeout OR exited non-zero
    // OR it technically exited but took close to the full timeout
    const hungOrSlow = run.killed || run.elapsed > CLEAN_EXIT_THRESHOLD_MS;

    console.log(`\nHypothesis ${hungOrSlow ? "CONFIRMED" : "REJECTED"}: canUseTool ${hungOrSlow ? "causes" : "does NOT cause"} hang`);

    expect(hungOrSlow).toBe(true);
  }, 60_000);

  it("FIX: with canUseTool + close(), process exits cleanly (proves fix)", async () => {
    const run = await runSpike({
      useCanUseTool: true,
      useClose: true,
      timeoutMs: HANG_TIMEOUT_MS,
    });

    console.log("\n--- FIX (canUseTool + close) ---");
    console.log(`Exit code: ${run.exitCode}, killed: ${run.killed}, elapsed: ${run.elapsed}ms`);
    for (const m of run.messages) console.log(`  ${JSON.stringify(m)}`);

    // If close() fixes it: should exit cleanly like the control
    const exitedCleanly = !run.killed && run.elapsed < CLEAN_EXIT_THRESHOLD_MS;

    console.log(`\nFix ${exitedCleanly ? "WORKS" : "DOES NOT WORK"}: close() ${exitedCleanly ? "resolves" : "does not resolve"} the hang`);

    expect(findMessage(run.messages, "close_called")).toBeDefined();
    expect(exitedCleanly).toBe(true);
  }, 60_000);
});
