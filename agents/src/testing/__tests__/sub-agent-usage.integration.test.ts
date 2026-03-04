import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Sub-Agent Usage in Metadata", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness?.cleanup(failed);
  });

  it("writes lastCallUsage and cumulativeUsage to child metadata.json", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt: 'Use the Agent tool to spawn a sub-agent that simply says "Hello world" and nothing else. Set subagent_type to "general-purpose" and description to "say hello". Do nothing else.',
      timeout: 120000,
    });

    assertAgent(output).succeeded();
    assertAgent(output).usedTools(["Agent"]);

    // Find child thread on disk
    const mortDir = harness.tempDirPath!;
    const threadsDir = join(mortDir, "threads");
    const threadDirs = readdirSync(threadsDir);

    let childMetadata: Record<string, unknown> | null = null;

    for (const threadDir of threadDirs) {
      const metadataPath = join(threadsDir, threadDir, "metadata.json");
      if (existsSync(metadataPath)) {
        const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
        if (metadata.parentThreadId) {
          childMetadata = metadata;
          break;
        }
      }
    }

    expect(childMetadata).not.toBeNull();

    // Usage must be written to child metadata
    expect(childMetadata!.lastCallUsage).toBeDefined();
    const usage = childMetadata!.lastCallUsage as {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    };
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);

    expect(childMetadata!.cumulativeUsage).toBeDefined();
    const cumulative = childMetadata!.cumulativeUsage as {
      inputTokens: number;
      outputTokens: number;
    };
    expect(cumulative.inputTokens).toBeGreaterThan(0);
    expect(cumulative.outputTokens).toBeGreaterThan(0);
  }, 180000);
});
