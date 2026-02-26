import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { unlinkSync } from "fs";
import { join } from "path";
import { AgentTestHarness } from "../agent-harness.js";

/**
 * Spike 2: Verify background task behavior through the full runner lifecycle.
 *
 * Spike 1 showed the raw SDK iterator blocks until background tasks complete.
 * This spike tests whether that behavior survives our runner.ts lifecycle:
 * process.exit(0), SIGTERM handlers, strategy cleanup, hub disconnect, etc.
 */

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Background task lifecycle through runner", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness?.cleanup(failed);
  });

  it(
    "background Bash task: diagnose exact kill chain",
    async () => {
      harness = new AgentTestHarness();
      const timestamp = Date.now();
      const signalFile = `/tmp/harness-bg-spike-${timestamp}.txt`;
      const fgMarkerFile = `/tmp/harness-bg-spike-${timestamp}-fg.txt`;

      const output = await harness.run({
        prompt: [
          `Do EXACTLY these three things in order:`,
          ``,
          `1. Use the Bash tool with run_in_background set to true to run:`,
          `   sleep 15 && echo "BACKGROUND_DONE" > ${signalFile}`,
          ``,
          `2. Use the Bash tool (foreground, NOT background) to run:`,
          `   echo "FOREGROUND_MARKER" > ${fgMarkerFile}`,
          ``,
          `3. Respond with EXACTLY: FOREGROUND_DONE`,
          ``,
          `Do not use any other tools.`,
        ].join("\n"),
        timeout: 120_000,
        env: { DEBUG: "1" },
      });

      // ===== DIAGNOSTICS =====
      console.log(`\n${"=".repeat(70)}`);
      console.log(`SPIKE 2 — BACKGROUND BASH TASK (DIAGNOSTIC RUN)`);
      console.log(`${"=".repeat(70)}`);
      console.log(`[timing] durationMs: ${output.durationMs}`);
      console.log(`[timing] exitCode: ${output.exitCode}`);

      const fgExists = existsSync(fgMarkerFile);
      const bgExists = existsSync(signalFile);
      console.log(`[files] foreground marker: ${fgExists}`);
      console.log(`[files] background signal: ${bgExists}`);

      // Parse stderr for the kill chain evidence
      // Our runner logs to stderr via logger; debug output also goes there
      const stderr = output.stderr;
      console.log(`[stderr] total length: ${stderr.length} chars`);

      // Extract key log lines from stderr
      const keyPatterns = [
        "result",
        "process.exit",
        "cleanup",
        "completed",
        "SIGTERM",
        "SIGINT",
        "disconnect",
        "Agent completed",
        "shouldContinue",
        "STREAM",
        "Message: type=result",
      ];

      const stderrLines = stderr.split("\n");
      console.log(`\n[stderr] Key lines (${stderrLines.length} total):`);
      for (const line of stderrLines) {
        const isKey = keyPatterns.some((p) =>
          line.toLowerCase().includes(p.toLowerCase())
        );
        if (isKey) {
          console.log(`  >> ${line.substring(0, 200)}`);
        }
      }

      // Look for the raw [STREAM] debug output to see message sequence
      console.log(`\n[stream] Message types from stdout debug logging:`);
      const streamLines = stderrLines.filter((l) =>
        l.includes("[STREAM] Message type:")
      );
      for (const line of streamLines) {
        console.log(`  ${line.trim()}`);
      }

      // Check events
      console.log(`\n[events] ${output.events.length} events:`);
      for (const e of output.events) {
        console.log(`  - ${e.name}: ${JSON.stringify(e.payload).substring(0, 100)}`);
      }

      // Check thread metadata on disk
      const threadsDir = join(harness.tempDirPath!, "threads");
      if (existsSync(threadsDir)) {
        const threadDirs = readdirSync(threadsDir);
        console.log(`\n[threads] ${threadDirs.length} thread(s) on disk:`);
        for (const dir of threadDirs) {
          const metadataPath = join(threadsDir, dir, "metadata.json");
          if (existsSync(metadataPath)) {
            const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
            console.log(
              `  ${dir}: status=${metadata.status}, parent=${metadata.parentThreadId ?? "none"}`
            );
          }
          const statePath = join(threadsDir, dir, "state.json");
          if (existsSync(statePath)) {
            const state = JSON.parse(readFileSync(statePath, "utf-8"));
            console.log(
              `  ${dir} state: status=${state.status}, tools=${Object.keys(state.toolStates).length}`
            );
          }
        }
      }

      // ===== VERDICT =====
      console.log(`\n${"=".repeat(70)}`);
      console.log(`VERDICT`);
      console.log(`${"=".repeat(70)}`);

      if (output.durationMs < 15_000 && !bgExists) {
        console.log(
          `CONFIRMED: Process exited in ${output.durationMs}ms (before 15s sleep).`
        );
        console.log(
          `The for-await loop breaks on result:success (handleResult returns false),`
        );
        console.log(
          `then runner.ts calls process.exit(0), killing the background task.`
        );
        console.log(``);
        console.log(`Kill chain: result:success → handleResult() returns false → break → finally cleanup → process.exit(0)`);
      } else if (bgExists) {
        console.log(`Background task survived! Duration: ${output.durationMs}ms`);
      } else {
        console.log(`Unexpected: duration=${output.durationMs}ms, bgExists=${bgExists}`);
      }

      // Clean up
      try { unlinkSync(signalFile); } catch {}
      try { unlinkSync(fgMarkerFile); } catch {}

      // Sanity check only
      expect(fgExists).toBe(true);
    },
    150_000
  );

  it(
    "background Task agent: diagnose metadata and lifecycle",
    async () => {
      harness = new AgentTestHarness();
      const timestamp = Date.now();
      const signalFile = `/tmp/harness-bg-agent-spike-${timestamp}.txt`;

      const output = await harness.run({
        prompt: [
          `Do EXACTLY these two things:`,
          ``,
          `1. Use the Task tool with run_in_background set to true.`,
          `   Set subagent_type to "Bash", description to "background task".`,
          `   The prompt should be: "Use the Bash tool to run: sleep 10 && echo DONE > ${signalFile}"`,
          ``,
          `2. Respond with EXACTLY: LAUNCHED`,
        ].join("\n"),
        timeout: 120_000,
        env: { DEBUG: "1" },
      });

      console.log(`\n${"=".repeat(70)}`);
      console.log(`SPIKE 2 — BACKGROUND TASK AGENT (DIAGNOSTIC RUN)`);
      console.log(`${"=".repeat(70)}`);
      console.log(`[timing] durationMs: ${output.durationMs}`);
      console.log(`[timing] exitCode: ${output.exitCode}`);
      console.log(`[files] signal file exists: ${existsSync(signalFile)}`);

      // Parse stderr for key events
      const stderrLines = output.stderr.split("\n");
      const keyPatterns = [
        "result", "process.exit", "cleanup", "completed",
        "SIGTERM", "disconnect", "Agent completed",
        "PreToolUse", "PostToolUse", "Task",
        "child", "background",
      ];

      console.log(`\n[stderr] Key lines:`);
      for (const line of stderrLines) {
        const isKey = keyPatterns.some((p) =>
          line.toLowerCase().includes(p.toLowerCase())
        );
        if (isKey && line.trim().length > 0) {
          console.log(`  >> ${line.substring(0, 200)}`);
        }
      }

      // Check ALL thread metadata
      const threadsDir = join(harness.tempDirPath!, "threads");
      if (existsSync(threadsDir)) {
        const threadDirs = readdirSync(threadsDir);
        console.log(`\n[threads] ${threadDirs.length} thread(s):`);

        for (const dir of threadDirs) {
          const metadataPath = join(threadsDir, dir, "metadata.json");
          if (existsSync(metadataPath)) {
            const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
            const isChild = !!metadata.parentThreadId;
            console.log(
              `  ${isChild ? "CHILD" : "PARENT"} ${dir}: ` +
                `status=${metadata.status}, agentType=${metadata.agentType ?? "n/a"}`
            );

            // For child threads, show more detail
            if (isChild) {
              console.log(`    parentToolUseId: ${metadata.parentToolUseId}`);
              console.log(`    turns: ${metadata.turns?.length ?? 0}`);
              if (metadata.turns?.length > 0) {
                const lastTurn = metadata.turns[metadata.turns.length - 1];
                console.log(`    lastTurn.completedAt: ${lastTurn.completedAt}`);
              }
            }
          }

          const statePath = join(threadsDir, dir, "state.json");
          if (existsSync(statePath)) {
            const state = JSON.parse(readFileSync(statePath, "utf-8"));
            const toolNames = Object.values(state.toolStates || {})
              .map((t: { toolName?: string }) => t.toolName)
              .filter(Boolean);
            console.log(
              `    state: status=${state.status}, tools=[${toolNames.join(", ")}], msgs=${state.messages?.length ?? 0}`
            );
          }
        }
      }

      const bgExists = existsSync(signalFile);

      // ===== VERDICT =====
      console.log(`\n${"=".repeat(70)}`);
      console.log(`VERDICT`);
      console.log(`${"=".repeat(70)}`);

      if (output.durationMs < 10_000 && !bgExists) {
        console.log(
          `CONFIRMED: Process exited in ${output.durationMs}ms (before 10s sleep).`
        );
        console.log(`Background Task agent was killed by runner lifecycle.`);
        console.log(``);
        console.log(`Root cause: handleResult() returns false → for-await breaks → process.exit(0)`);
        console.log(`The SDK iterator would have blocked for the bg task, but we break out early.`);
      } else if (bgExists) {
        console.log(`Background Task agent survived! Duration: ${output.durationMs}ms`);
      } else {
        console.log(`Unexpected: duration=${output.durationMs}ms, bgExists=${bgExists}`);
      }

      // Clean up
      try { unlinkSync(signalFile); } catch {}
    },
    150_000
  );
});
