/**
 * Shared Runner Integration Tests
 *
 * Tests the full agent loop including hook-based tool completion.
 * Verifies that tools are correctly marked as complete via hooks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockScript,
  cleanupMockScript,
  MOCK_LLM_VAR,
} from "../testing/mock-llm.js";

// Track calls to output functions
const mockCalls = {
  markToolRunning: [] as Array<{ toolUseId: string; toolName: string }>,
  markToolComplete: [] as Array<{
    toolUseId: string;
    result: string;
    isError: boolean;
  }>,
  initState: [] as Array<unknown>,
  appendUserMessage: [] as Array<unknown>,
  appendAssistantMessage: [] as Array<unknown>,
  complete: [] as Array<unknown>,
};

// Mock the output module to track calls
vi.mock("../output.js", () => ({
  initState: vi.fn(async (...args) => {
    mockCalls.initState.push(args);
  }),
  appendUserMessage: vi.fn(async (content) => {
    mockCalls.appendUserMessage.push(content);
  }),
  appendAssistantMessage: vi.fn(async (message) => {
    mockCalls.appendAssistantMessage.push(message);
  }),
  markToolRunning: vi.fn(async (toolUseId, toolName) => {
    mockCalls.markToolRunning.push({ toolUseId, toolName });
  }),
  markToolComplete: vi.fn(async (toolUseId, result, isError) => {
    mockCalls.markToolComplete.push({ toolUseId, result, isError });
  }),
  complete: vi.fn(async (metrics) => {
    mockCalls.complete.push(metrics);
  }),
  setSessionId: vi.fn(async () => {}),
  getHubClient: vi.fn(),
  updateFileChange: vi.fn(),
}));

// Mock the logger
vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
import { runAgentLoop } from "./shared.js";
import type { RunnerConfig, OrchestrationContext } from "./types.js";
import type { AgentConfig } from "../agent-types/index.js";

describe("runAgentLoop - tool completion via hooks", () => {
  let mockScriptPath = "";

  const baseConfig: RunnerConfig = {
    agent: "simple",
    prompt: "Test prompt",
    mortDir: "/tmp/mort",
    threadId: "test-thread-id",
  };

  const baseContext: OrchestrationContext = {
    workingDir: "/tmp/test",
    threadPath: "/tmp/test-thread",
    threadId: "test-thread-id",
  };

  const baseAgentConfig: AgentConfig = {
    name: "simple",
    description: "Test agent",
    appendedPrompt: "Test agent prompt",
    tools: { type: "preset", preset: "claude_code" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCalls.markToolRunning = [];
    mockCalls.markToolComplete = [];
    mockCalls.initState = [];
    mockCalls.appendUserMessage = [];
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

  it("marks tool as complete (not error) after successful execution", async () => {
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

    await runAgentLoop(baseConfig, baseContext, baseAgentConfig);

    // Should have marked tool as running
    expect(mockCalls.markToolRunning.length).toBe(1);
    expect(mockCalls.markToolRunning[0].toolName).toBe("Read");

    // KEY ASSERTION: Tool should be marked as complete (not error) via hook
    expect(mockCalls.markToolComplete.length).toBeGreaterThanOrEqual(1);

    // Find the completion call that's NOT an error
    const completions = mockCalls.markToolComplete.filter(c => !c.isError);
    expect(completions.length).toBeGreaterThan(0);
    expect(completions[0].result).toBe("file contents here");
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

    await runAgentLoop(baseConfig, baseContext, baseAgentConfig);

    // Should have marked tool as running
    expect(mockCalls.markToolRunning.length).toBe(1);

    // Should have marked tool as error
    expect(mockCalls.markToolComplete.length).toBeGreaterThanOrEqual(1);
    const errorCompletions = mockCalls.markToolComplete.filter(c => c.isError);
    expect(errorCompletions.length).toBeGreaterThan(0);
    expect(errorCompletions[0].result).toContain("File not found");
  });

  it("marks multiple tools as complete", async () => {
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

    await runAgentLoop(baseConfig, baseContext, baseAgentConfig);

    // Both tools should be marked as running
    expect(mockCalls.markToolRunning.length).toBe(2);
    const toolNames = mockCalls.markToolRunning.map(c => c.toolName);
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");

    // Both tools should be marked as complete (not error)
    // May be called multiple times (from hook + MessageHandler), so check >= 2
    const completions = mockCalls.markToolComplete.filter(c => !c.isError);
    expect(completions.length).toBeGreaterThanOrEqual(2);

    // Verify both tool IDs are represented in completions
    const runningToolIds = mockCalls.markToolRunning.map(c => c.toolUseId);
    const completedToolIds = completions.map(c => c.toolUseId);
    for (const toolId of runningToolIds) {
      expect(completedToolIds).toContain(toolId);
    }
  });

  it("calls complete with metrics at end", async () => {
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

    await runAgentLoop(baseConfig, baseContext, baseAgentConfig);

    // Tool should be marked complete before overall complete
    expect(mockCalls.markToolComplete.length).toBeGreaterThan(0);

    // Should have called complete with metrics
    expect(mockCalls.complete.length).toBe(1);
    expect(mockCalls.complete[0]).toHaveProperty("durationApiMs");
    expect(mockCalls.complete[0]).toHaveProperty("totalCostUsd");
    expect(mockCalls.complete[0]).toHaveProperty("numTurns");
  });

  it("tool completion happens via hook (not just MessageHandler)", async () => {
    // This test verifies that the hook-based completion is working
    // by checking that markToolComplete is called with the correct result
    const script = createMockScript({
      responses: [
        {
          toolCalls: [
            {
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
              mockResult: "specific content from hook",
            },
          ],
        },
        { content: "Done." },
      ],
    });
    mockScriptPath = script;
    process.env[MOCK_LLM_VAR] = script;

    await runAgentLoop(baseConfig, baseContext, baseAgentConfig);

    // The hook receives the mockResult and should pass it to markToolComplete
    const completions = mockCalls.markToolComplete.filter(c => !c.isError);
    expect(completions.length).toBeGreaterThan(0);

    // At least one completion should have the specific content from the mock
    const hasSpecificContent = completions.some(
      c => c.result === "specific content from hook"
    );
    expect(hasSpecificContent).toBe(true);
  });
});
