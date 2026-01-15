import { describe, it, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent Tool Usage", () => {
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

  it("uses Read tool to inspect files", async () => {
    const output = await harness.run({
      prompt: "What does the README say?",
    });

    assertAgent(output).succeeded().usedTools(["Read"]);
  });

  it("uses Bash tool for shell commands", async () => {
    const output = await harness.run({
      prompt: "Run 'ls -la' and tell me what you see",
    });

    assertAgent(output).succeeded().usedTools(["Bash"]);
  });

  it("uses Write tool to create files", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Create a new file called 'test.txt' with the content 'Hello World'",
    });

    assertAgent(output).succeeded().usedTools(["Write"]);
  });
});
