import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent State Transitions", () => {
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

  it("transitions from running to complete", async () => {
    const output = await harness.run({
      prompt: "List files in the current directory",
    });

    expect(output.states.length).toBeGreaterThan(0);
    expect(output.states[0].state.status).toBe("running");

    assertAgent(output).finalState((s) => s.status === "complete");
  });

  it("includes messages array in state", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .finalState((s) => Array.isArray(s.messages) && s.messages.length > 0);
  });

  it("tracks file modifications in state", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Add a newline to the end of README.md",
    });

    assertAgent(output)
      .succeeded()
      .hasFileChanges((changes) =>
        changes.some(
          (c) => c.path.endsWith("README.md") && c.operation === "modify"
        )
      );
  });
});
