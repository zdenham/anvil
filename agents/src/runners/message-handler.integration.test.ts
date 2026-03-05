import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockScript,
  cleanupMockScript,
  MOCK_LLM_VAR,
} from "../testing/mock-llm.js";
import { mockQuery } from "../testing/mock-query.js";
import { MessageHandler } from "./message-handler.js";

// Track calls to output functions
const mockCalls = {
  markToolRunning: [] as Array<{ toolUseId: string; toolName: string }>,
  markToolComplete: [] as Array<{
    toolUseId: string;
    result: string;
    isError: boolean;
  }>,
  appendAssistantMessage: [] as Array<unknown>,
  complete: [] as Array<unknown>,
};

// Mock the output module to track calls
vi.mock("../output.js", () => ({
  appendAssistantMessage: vi.fn((message) => {
    mockCalls.appendAssistantMessage.push(message);
  }),
  markToolRunning: vi.fn((toolUseId, toolName) => {
    mockCalls.markToolRunning.push({ toolUseId, toolName });
  }),
  markToolComplete: vi.fn((toolUseId, result, isError) => {
    mockCalls.markToolComplete.push({ toolUseId, result, isError });
  }),
  complete: vi.fn((metrics) => {
    mockCalls.complete.push(metrics);
  }),
  updateUsage: vi.fn(),
}));

// Mock logger
vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import mocked functions for clearing
import { markToolRunning, markToolComplete } from "../output.js";

describe("MessageHandler Integration", () => {
  let mockScriptPath = "";

  beforeEach(() => {
    vi.clearAllMocks();
    mockCalls.markToolRunning = [];
    mockCalls.markToolComplete = [];
    mockCalls.appendAssistantMessage = [];
    mockCalls.complete = [];
  });

  afterEach(() => {
    if (mockScriptPath) {
      cleanupMockScript(mockScriptPath);
      delete process.env[MOCK_LLM_VAR];
      mockScriptPath = "";
    }
  });

  it("tracks tool state through full message flow", async () => {
    const script = createMockScript({
      responses: [
        {
          toolCalls: [
            {
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
              mockResult: "file contents here",
            },
          ],
        },
        { content: "I read the file for you." },
      ],
    });
    mockScriptPath = script;
    process.env[MOCK_LLM_VAR] = script;

    const handler = new MessageHandler();

    for await (const message of mockQuery()) {
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }

    // Should have marked tool as running
    expect(mockCalls.markToolRunning.length).toBe(1);
    expect(mockCalls.markToolRunning[0].toolName).toBe("Read");

    // Should have marked tool as complete
    expect(mockCalls.markToolComplete.length).toBe(1);
    expect(mockCalls.markToolComplete[0].isError).toBe(false);
  });

  it("handles multiple tools in sequence", async () => {
    const script = createMockScript({
      responses: [
        {
          toolCalls: [
            { name: "Read", input: { file_path: "/tmp/a.txt" }, mockResult: "content a" },
            { name: "Write", input: { file_path: "/tmp/b.txt", content: "hi" }, mockResult: "OK" },
          ],
        },
        { content: "Done with both tools." },
      ],
    });
    mockScriptPath = script;
    process.env[MOCK_LLM_VAR] = script;

    const handler = new MessageHandler();

    for await (const message of mockQuery()) {
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }

    // Both tools should be marked as running
    expect(mockCalls.markToolRunning.length).toBe(2);
    const toolNames = mockCalls.markToolRunning.map((c) => c.toolName);
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");

    // Both tools should be marked as complete
    expect(mockCalls.markToolComplete.length).toBe(2);
  });

  it("marks tool as error on failure", async () => {
    const script = createMockScript({
      responses: [
        {
          toolCalls: [
            {
              name: "Read",
              input: { file_path: "/nonexistent" },
              mockError: "File not found",
            },
          ],
        },
        { content: "The file does not exist." },
      ],
    });
    mockScriptPath = script;
    process.env[MOCK_LLM_VAR] = script;

    const handler = new MessageHandler();

    for await (const message of mockQuery()) {
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }

    // Tool should be marked as running first
    expect(mockCalls.markToolRunning.length).toBe(1);
    expect(mockCalls.markToolRunning[0].toolName).toBe("Read");

    // Tool should be marked as complete with error
    expect(mockCalls.markToolComplete.length).toBe(1);
    expect(mockCalls.markToolComplete[0].isError).toBe(true);
    // Result may be stringified if tool_use_result is an object
    expect(mockCalls.markToolComplete[0].result).toContain("File not found");
  });

  it("emits running state before complete state", async () => {
    const script = createMockScript({
      responses: [
        {
          toolCalls: [
            { name: "Bash", input: { command: "echo hello" }, mockResult: "hello" },
          ],
        },
        { content: "Done" },
      ],
    });
    mockScriptPath = script;
    process.env[MOCK_LLM_VAR] = script;

    const handler = new MessageHandler();

    // Track call order
    const callOrder: string[] = [];
    (markToolRunning as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("running");
    });
    (markToolComplete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("complete");
    });

    for await (const message of mockQuery()) {
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }

    // Running should come before complete
    const runningIndex = callOrder.indexOf("running");
    const completeIndex = callOrder.indexOf("complete");
    expect(runningIndex).toBeGreaterThanOrEqual(0);
    expect(completeIndex).toBeGreaterThanOrEqual(0);
    expect(runningIndex).toBeLessThan(completeIndex);
  });

  it("completes with metrics on success result", async () => {
    const script = createMockScript({
      responses: [{ content: "Hello, world!" }],
    });
    mockScriptPath = script;
    process.env[MOCK_LLM_VAR] = script;

    const handler = new MessageHandler();

    for await (const message of mockQuery()) {
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }

    // Should have called complete with metrics
    expect(mockCalls.complete.length).toBe(1);
    expect(mockCalls.complete[0]).toHaveProperty("durationApiMs");
    expect(mockCalls.complete[0]).toHaveProperty("totalCostUsd");
    expect(mockCalls.complete[0]).toHaveProperty("numTurns");
  });
});
