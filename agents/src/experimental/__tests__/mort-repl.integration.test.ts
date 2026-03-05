import { describe, it, afterEach, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { AgentTestHarness, assertAgent } from "../../testing/index.js";
import type { ThreadState } from "../../testing/index.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

/**
 * Read final state from disk rather than socket states.
 * The runner now emits `thread_action` messages (not `state`/`state_event`),
 * so the harness states array is empty. Disk is the source of truth.
 */
function readStateFromDisk(mortDir: string): ThreadState | null {
  const threadsDir = join(mortDir, "threads");
  if (!existsSync(threadsDir)) return null;

  const dirs = readdirSync(threadsDir);
  // Find the parent thread (the one without a parentThreadId in metadata)
  for (const dir of dirs) {
    const metadataPath = join(threadsDir, dir, "metadata.json");
    const statePath = join(threadsDir, dir, "state.json");
    if (!existsSync(statePath)) continue;

    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      if (!metadata.parentThreadId) {
        return JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
      }
    } catch {
      // Fallback: just return the first valid state
      try {
        return JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Extract the final assistant text from a ThreadState.
 */
function extractFinalText(state: ThreadState | null): string {
  if (!state) return "";

  const messages = state.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: Array<{ type: string; text?: string }> };
    if (msg.role !== "assistant") continue;
    const textBlocks = (msg.content ?? []).filter(
      (b: { type: string }) => b.type === "text",
    );
    if (textBlocks.length > 0) {
      return textBlocks.map((b: { text?: string }) => b.text ?? "").join("\n");
    }
  }
  return "";
}

describeWithApi.skip("mort-repl: Live Agent Integration", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("basic REPL execution — return 42", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt:
        'Call the Bash tool with the command: mort-repl "return 42"\n' +
        "Then report the result you see in your response.",
      timeout: 60_000,
    });

    assertAgent(output).succeeded();

    const state = readStateFromDisk(harness.tempDirPath!);
    expect(state).not.toBeNull();

    const text = extractFinalText(state);
    expect(text).toContain("42");

    // Verify the hook intercepted: messages should contain the deny result
    // (agent sees "mort-repl result: 42" and reports it in final text)
    const messages = state!.messages ?? [];
    const hasToolUse = messages.some((m: unknown) => {
      const msg = m as { role?: string; content?: Array<{ type: string; name?: string }> };
      return msg.role === "assistant" && Array.isArray(msg.content) &&
        msg.content.some(b => b.type === "tool_use" && b.name === "Bash");
    });
    expect(hasToolUse).toBe(true);
  }, 60_000);

  it("TypeScript code with types stripped", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt:
        "Call the Bash tool with the following command exactly:\n\n" +
        "mort-repl <<'MORT_REPL'\n" +
        'interface Result { value: number; label: string }\n' +
        'const r: Result = { value: 99, label: "test" };\n' +
        "return r;\n" +
        "MORT_REPL\n\n" +
        "Then report the result you see.",
      timeout: 60_000,
    });

    assertAgent(output).succeeded();

    const state = readStateFromDisk(harness.tempDirPath!);
    const text = extractFinalText(state);
    expect(text).toContain("99");
    expect(text).toContain("test");
  }, 60_000);

  it("mort.log() output appears in result", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt:
        "Call the Bash tool with the following command exactly:\n\n" +
        "mort-repl <<'MORT_REPL'\n" +
        'mort.log("hello from repl");\n' +
        'return "done";\n' +
        "MORT_REPL\n\n" +
        "Then report the full result you see.",
      timeout: 60_000,
    });

    assertAgent(output).succeeded();

    const state = readStateFromDisk(harness.tempDirPath!);
    const text = extractFinalText(state);
    expect(text).toContain("hello from repl");
    expect(text).toContain("done");
  }, 60_000);

  it("mort.spawn() — child agent execution", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt:
        "mort-repl is a special Bash command prefix that executes TypeScript code with a `mort` SDK.\n" +
        "Call the Bash tool with the following command exactly:\n\n" +
        "mort-repl <<'MORT_REPL'\n" +
        "const result = await mort.spawn({\n" +
        "  prompt: 'Reply with exactly the word PINEAPPLE and nothing else.',\n" +
        "});\n" +
        "return result;\n" +
        "MORT_REPL\n\n" +
        "Then report the result you see.",
      timeout: 120_000,
    });

    assertAgent(output).succeeded();

    const state = readStateFromDisk(harness.tempDirPath!);
    const text = extractFinalText(state);
    expect(text).toContain("PINEAPPLE");

    // Verify child thread directory was created on disk
    const mortDir = harness.tempDirPath!;
    const threadsDir = join(mortDir, "threads");
    const threadDirs = readdirSync(threadsDir);
    // Should have at least 2 directories: parent + child
    expect(threadDirs.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("error handling — runtime error in REPL code", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt:
        'Call the Bash tool with the command: mort-repl "throw new Error(\'kaboom\')"\n' +
        "Then report what you see.",
      timeout: 60_000,
    });

    assertAgent(output).succeeded();

    const state = readStateFromDisk(harness.tempDirPath!);
    const text = extractFinalText(state);
    // Agent should report the error from the REPL
    expect(text.toLowerCase()).toMatch(/error|kaboom/);
  }, 60_000);
});
