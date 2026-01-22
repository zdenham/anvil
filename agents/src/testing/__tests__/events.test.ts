import { describe, it, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent Event Emissions", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
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
  }, 30000);

  it("emits thread:status:changed on completion", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEventsInOrder(["thread:created", "thread:status:changed"]);
  }, 30000);
});
