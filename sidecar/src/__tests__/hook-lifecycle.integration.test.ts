/**
 * Integration tests for the full hook lifecycle.
 *
 * Spawns a real `claude -p` process against an isolated sidecar,
 * then asserts on state.json and events.jsonl written by the hooks.
 *
 * Requires: `claude` CLI on PATH + ANTHROPIC_API_KEY in env.
 * Skipped automatically when either is missing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { SidecarTestHarness } from "../testing/sidecar-test-harness.js";

function hasClaudeCli(): boolean {
  try {
    execSync("which claude", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasClaudeCli() && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!canRun)("Hook lifecycle integration", () => {
  let harness: SidecarTestHarness;

  beforeAll(async () => {
    harness = new SidecarTestHarness({ timeout: 120_000 });
    await harness.start();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("single-turn prompt produces state.json with complete status", async () => {
    const { threadId, result } = await harness.runCli("Say exactly: hello world");

    expect(result.exitCode).toBe(0);

    // Verify state.json exists and thread completed
    const state = harness.readState(threadId);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("complete");

    // Verify events.jsonl has SESSION_ENDED from the Stop hook
    const events = harness.readEvents(threadId);
    const types = events.map((e) => e.type);
    expect(types).toContain("SESSION_ENDED");
  }, 120_000);

  it("tool-using prompt produces TOOL_STARTED and TOOL_COMPLETED events", async () => {
    const prompt = "Read the file /etc/hosts and tell me how many lines it has. Be brief.";
    const { threadId, result } = await harness.runCli(prompt);

    expect(result.exitCode).toBe(0);

    // Verify state.json has tool states
    const state = harness.readState(threadId);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("complete");
    expect(Object.keys(state!.toolStates).length).toBeGreaterThan(0);

    // At least one tool should be marked complete
    const toolEntries = Object.values(state!.toolStates);
    const completedTools = toolEntries.filter((t) => t.status === "complete");
    expect(completedTools.length).toBeGreaterThan(0);

    // Verify events.jsonl has tool lifecycle events
    const events = harness.readEvents(threadId);
    const types = events.map((e) => e.type);

    expect(types).toContain("TOOL_STARTED");
    expect(types).toContain("TOOL_COMPLETED");

    // TOOL_STARTED should come before TOOL_COMPLETED
    const toolStartIdx = types.indexOf("TOOL_STARTED");
    const toolEndIdx = types.indexOf("TOOL_COMPLETED");
    expect(toolStartIdx).toBeLessThan(toolEndIdx);
  }, 120_000);

  it("events.jsonl entries have required fields", async () => {
    const { threadId } = await harness.runCli("Say exactly: test");

    const events = harness.readEvents(threadId);
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.type).toBeTruthy();
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.payload).toBeDefined();
    }
  }, 120_000);
});
