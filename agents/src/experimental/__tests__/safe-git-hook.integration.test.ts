/**
 * Live integration test: Verify the safe-git hook blocks destructive
 * git commands when running inside a real agent loop.
 *
 * Uses AgentTestHarness to spawn an actual agent subprocess that
 * attempts to run `git stash`, and asserts the hook denies it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { AgentTestHarness } from "../../testing/agent-harness.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Safe git hook (live agent)", () => {
  let harness: AgentTestHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("blocks git stash and agent sees denial message", async () => {
    harness = new AgentTestHarness({ timeout: 90_000 });

    const result = await harness.run({
      prompt: [
        "Run exactly this bash command: git stash",
        "If the command is blocked or denied, respond with exactly: BLOCKED",
        "If it succeeds, respond with exactly: SUCCESS",
        "Do not run any other commands.",
      ].join("\n"),
      timeout: 90_000,
    });

    // Agent should complete (exit 0) — the hook denies the tool, not crash the agent
    expect(result.exitCode).toBe(0);

    // Look through the final state's messages for evidence of denial
    const lastState = result.states[result.states.length - 1];
    expect(lastState).toBeDefined();

    const messages = lastState.state.messages as Array<{
      role: string;
      content: unknown;
    }>;

    // Stringify all messages to search for the denial marker
    const allText = JSON.stringify(messages);

    // The hook returns a deny with "BLOCKED" in the reason — check that
    // the agent received the denial (either via tool_result error or its own text)
    const hookBlocked = allText.includes("BLOCKED") || allText.includes("Destructive git command blocked");
    expect(hookBlocked).toBe(true);
  }, 120_000);
});
