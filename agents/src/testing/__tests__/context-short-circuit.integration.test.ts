import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";
import { createRunnerConfig } from "../runner-config.js";
import type { LogMessage } from "../../lib/hub/types.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

const shortCircuitRunnerConfig = createRunnerConfig({
  buildArgs: (opts, anvilDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();
    const repoId = opts.repoId ?? randomUUID();
    const worktreeId = opts.worktreeId ?? randomUUID();

    const shortCircuit = {
      limitPercent: 1,
      message: "CONTEXT_LIMIT_REACHED: Save your progress to a file and stop.",
    };

    return [
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--repo-id", repoId,
      "--worktree-id", worktreeId,
      "--anvil-dir", anvilDirPath,
      "--cwd", opts.cwd ?? repoCwd,
      "--context-short-circuit", JSON.stringify(shortCircuit),
    ];
  },
});

describeWithApi("Context Short-Circuit - Live Integration", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("delivers nudge when context utilization exceeds threshold", async () => {
    harness = new AgentTestHarness({ runnerConfig: shortCircuitRunnerConfig });

    const output = await harness.run({
      prompt: "Read the file at ./README.md and tell me what it says.",
      timeout: 90_000,
    });

    assertAgent(output).succeeded();

    // Verify the PostToolUse hook fired the context short-circuit nudge
    const logMessages = output.socketMessages.filter(
      (msg): msg is LogMessage => msg.type === "log"
    );
    const nudgeLog = logMessages.find(
      (msg) => msg.message.includes("Context short-circuit:")
    );

    expect(nudgeLog).toBeDefined();
    expect(nudgeLog!.message).toMatch(/Context short-circuit: [\d.]+% >= 1%/);
  }, 90_000);
});
