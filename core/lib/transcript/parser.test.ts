import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readTranscript, readTranscriptIncremental } from "./parser.js";

describe("readTranscript", () => {
  let testDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `transcript-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    transcriptPath = join(testDir, "transcript.jsonl");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("parses assistant messages with usage", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          model: "claude-sonnet-4-6",
        },
        uuid: "msg-1",
      }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const result = readTranscript(transcriptPath);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].content[0].text).toBe("Hello world");
    expect(result.messages[0].usage?.inputTokens).toBe(10);
    expect(result.messages[0].usage?.outputTokens).toBe(5);
    expect(result.messages[0].model).toBe("claude-sonnet-4-6");
    expect(result.cumulativeUsage.inputTokens).toBe(10);
    expect(result.errors).toHaveLength(0);
  });

  it("handles thinking blocks", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Let me think..." },
            { type: "text", text: "Here's my answer" },
          ],
        },
      }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const result = readTranscript(transcriptPath);
    expect(result.messages[0].content).toHaveLength(2);
    expect(result.messages[0].content[0].thinking).toBe("Let me think...");
    expect(result.messages[0].content[1].text).toBe("Here's my answer");
  });

  it("skips invalid JSON lines and records errors", () => {
    const lines = [
      "not json at all",
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const result = readTranscript(transcriptPath);
    expect(result.messages).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].lineNumber).toBe(1);
  });

  it("accumulates usage across multiple messages", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "First" }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Second" }],
          usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 10 },
        },
      }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const result = readTranscript(transcriptPath);
    expect(result.cumulativeUsage.inputTokens).toBe(300);
    expect(result.cumulativeUsage.outputTokens).toBe(150);
    expect(result.cumulativeUsage.cacheCreationInputTokens).toBe(30);
    expect(result.cumulativeUsage.cacheReadInputTokens).toBe(15);
  });

  it("handles empty file", () => {
    writeFileSync(transcriptPath, "");
    const result = readTranscript(transcriptPath);
    expect(result.messages).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles unknown message types gracefully", () => {
    const lines = [
      JSON.stringify({ type: "something_new", message: { content: [] } }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const result = readTranscript(transcriptPath);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("unknown");
  });

  it("extracts CLI version from init message", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", cliVersion: "1.2.3" }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const result = readTranscript(transcriptPath);
    expect(result.cliVersion).toBe("1.2.3");
  });
});

describe("readTranscriptIncremental", () => {
  let testDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `transcript-inc-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    transcriptPath = join(testDir, "transcript.jsonl");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("reads only lines after fromLine", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "First" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Second" }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Third" }] } }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    // Read from line 1 (skip first line)
    const { transcript, lastLine } = readTranscriptIncremental(transcriptPath, 1);
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[0].content[0].text).toBe("Second");
    expect(lastLine).toBe(3);
  });

  it("returns empty when fromLine is at end", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Only" }] } }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"));

    const { transcript, lastLine } = readTranscriptIncremental(transcriptPath, 1);
    expect(transcript.messages).toHaveLength(0);
    expect(lastLine).toBe(1);
  });
});
