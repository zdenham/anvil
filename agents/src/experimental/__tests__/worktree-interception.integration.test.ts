/**
 * Live integration tests for worktree interception behavior.
 *
 * Verifies:
 * 1. EnterWorktree tool is blocked (via disallowedTools + permission deny)
 * 2. `git worktree add` via Bash triggers a WORKTREE_SYNCED event
 */
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { AgentTestHarness } from "../../testing/agent-harness.js";
import type { SocketMessage } from "../../lib/hub/types.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Worktree interception (live agent)", () => {
  let harness: AgentTestHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("blocks EnterWorktree and agent sees denial", async () => {
    harness = new AgentTestHarness({ timeout: 90_000 });

    const result = await harness.run({
      prompt: [
        "Use the EnterWorktree tool to create a new worktree.",
        "If the tool is blocked, denied, or unavailable, respond with exactly: BLOCKED",
        "If it succeeds, respond with exactly: SUCCESS",
        "Do not run any other commands.",
      ].join("\n"),
      timeout: 90_000,
    });

    expect(result.exitCode).toBe(0);

    // Check agent messages for denial evidence
    const lastState = result.states[result.states.length - 1];
    expect(lastState).toBeDefined();
    const allText = JSON.stringify(lastState.state.messages);

    // Agent should see BLOCKED — either because:
    // 1. disallowedTools removed it (agent says "I don't have that tool")
    // 2. Permission deny fired (agent sees deny reason)
    expect(allText).toContain("BLOCKED");
  }, 120_000);

  it("git worktree add triggers WORKTREE_SYNCED event", async () => {
    const threadId = randomUUID();
    harness = new AgentTestHarness({ timeout: 90_000 });

    const runPromise = harness.run({
      prompt: [
        "Run this exact bash command: git worktree add -b test-wt-branch ../test-worktree HEAD",
        "If it fails, just say FAILED. If it works, say SUCCESS.",
      ].join("\n"),
      threadId,
      timeout: 90_000,
    });

    // Wait for MockHubServer to be available
    let mockHub = harness.getMockHub();
    const hubWaitStart = Date.now();
    while (!mockHub && Date.now() - hubWaitStart < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
      mockHub = harness.getMockHub();
    }
    if (!mockHub) throw new Error("MockHubServer not available");

    // Wait for the WORKTREE_SYNCED event via socket
    let syncEvent: SocketMessage | null = null;
    try {
      syncEvent = await mockHub.waitForMessage(
        (msg) =>
          msg.type === "event" &&
          (msg as { name?: string }).name === "worktree:synced",
        60_000,
      );
    } catch {
      // Will assert below
    }

    const result = await runPromise;
    expect(result.exitCode).toBe(0);

    // Verify the sync event was emitted (check both socket and collected events)
    expect(syncEvent).toBeDefined();

    const worktreeSyncEvents = result.events.filter(
      (e) => e.name === "worktree:synced",
    );
    expect(worktreeSyncEvents.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
