import { describe, it, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent Event Emissions", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("emits thread:created on startup", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("thread:created");
  });

  it("emits thread:status:changed on completion", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEventsInOrder(["thread:created", "thread:status:changed"]);
  });

  it("emits worktree:allocated for task-based agents", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Add a comment to README.md",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("worktree:allocated")
      .hasEvent("worktree:released");
  });
});
