/**
 * Verifies that all exports from the testing index are properly set up.
 * This test ensures the barrel exports work correctly and consumers
 * can import from "@/testing" (or "./index.js" relatively).
 */
import { describe, it, expect } from "vitest";

// Import everything from the testing module index
import {
  // Classes
  AgentTestHarness,
  AgentAssertions,
  TestAnvilDirectory,
  TestRepository,
  MockClaudeClient,
  // Functions
  assertAgent,
  defaultRunnerConfig,
  createRunnerConfig,
  // Mock LLM
  MOCK_LLM_VAR,
  createMockScript,
  cleanupMockScript,
  MockScripts,
  isMockModeEnabled,
  getMockScriptPath,
  mockQuery,
} from "../index.js";

// Type imports (verify they compile)
import type {
  AgentTestHarnessOptions,
  RunnerConfig,
  AgentRunOutput,
  AgentTestOptions,
  ThreadState,
  FileChange,
  ResultMetrics,
  AgentThreadStatus,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  StdoutMessage,
  TestAnvilDirectoryOptions,
  TestRepositoryOptions,
  FileFixture,
  // Mock LLM types
  MockScript,
  MockResponse,
  MockToolCall,
  TextBlock,
  ToolUseBlock,
  ContentBlock,
  // SDK types
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
  ToolExecutor,
  MockQueryOptions,
} from "../index.js";

describe("testing module exports", () => {
  describe("classes", () => {
    it("exports AgentTestHarness", () => {
      expect(AgentTestHarness).toBeDefined();
      expect(typeof AgentTestHarness).toBe("function");
    });

    it("exports AgentAssertions", () => {
      expect(AgentAssertions).toBeDefined();
      expect(typeof AgentAssertions).toBe("function");
    });

    it("exports TestAnvilDirectory", () => {
      expect(TestAnvilDirectory).toBeDefined();
      expect(typeof TestAnvilDirectory).toBe("function");
    });

    it("exports TestRepository", () => {
      expect(TestRepository).toBeDefined();
      expect(typeof TestRepository).toBe("function");
    });

    it("exports MockClaudeClient", () => {
      expect(MockClaudeClient).toBeDefined();
      expect(typeof MockClaudeClient).toBe("function");
    });
  });

  describe("functions", () => {
    it("exports assertAgent", () => {
      expect(assertAgent).toBeDefined();
      expect(typeof assertAgent).toBe("function");
    });

    it("exports defaultRunnerConfig", () => {
      expect(defaultRunnerConfig).toBeDefined();
      expect(typeof defaultRunnerConfig).toBe("object");
      expect(defaultRunnerConfig.runnerPath).toBe("runner.ts");
      expect(typeof defaultRunnerConfig.buildArgs).toBe("function");
    });

    it("exports createRunnerConfig", () => {
      expect(createRunnerConfig).toBeDefined();
      expect(typeof createRunnerConfig).toBe("function");
    });
  });

  describe("mock LLM exports", () => {
    it("exports MOCK_LLM_VAR constant", () => {
      expect(MOCK_LLM_VAR).toBe("ANVIL_MOCK_LLM_PATH");
    });

    it("exports createMockScript function", () => {
      expect(createMockScript).toBeDefined();
      expect(typeof createMockScript).toBe("function");
    });

    it("exports cleanupMockScript function", () => {
      expect(cleanupMockScript).toBeDefined();
      expect(typeof cleanupMockScript).toBe("function");
    });

    it("exports MockScripts helpers", () => {
      expect(MockScripts).toBeDefined();
      expect(typeof MockScripts.simpleResponse).toBe("function");
      expect(typeof MockScripts.readAndRespond).toBe("function");
      expect(typeof MockScripts.writeFile).toBe("function");
      expect(typeof MockScripts.readEditRespond).toBe("function");
      expect(typeof MockScripts.errorResponse).toBe("function");
    });

    it("exports isMockModeEnabled function", () => {
      expect(isMockModeEnabled).toBeDefined();
      expect(typeof isMockModeEnabled).toBe("function");
    });

    it("exports getMockScriptPath function", () => {
      expect(getMockScriptPath).toBeDefined();
      expect(typeof getMockScriptPath).toBe("function");
    });

    it("exports mockQuery function", () => {
      expect(mockQuery).toBeDefined();
      expect(typeof mockQuery).toBe("function");
    });

    it("MockScripts.simpleResponse creates valid script", () => {
      const script = MockScripts.simpleResponse("Hello, world!");
      expect(script.responses).toHaveLength(1);
      expect(script.responses[0].content).toBe("Hello, world!");
    });

    it("MockScripts.errorResponse creates valid error script", () => {
      const script = MockScripts.errorResponse("Rate limit exceeded");
      expect(script.responses).toHaveLength(1);
      expect(script.responses[0].error).toBe("Rate limit exceeded");
    });
  });

  describe("runner configuration", () => {
    it("createRunnerConfig merges with defaults", () => {
      const customConfig = createRunnerConfig({
        runnerPath: "custom-runner.js",
      });
      expect(customConfig.runnerPath).toBe("custom-runner.js");
      expect(customConfig.buildArgs).toBe(defaultRunnerConfig.buildArgs);
    });

    it("defaultRunnerConfig.buildArgs generates correct args for simple agent", () => {
      const opts: AgentTestOptions = {
        prompt: "test prompt",
        threadId: "test-thread-123",
        repoId: "test-repo-456",
        cwd: "/test/cwd",
      };
      const args = defaultRunnerConfig.buildArgs(opts, "/anvil/dir", "/repo/cwd");

      expect(args).toContain("--prompt");
      expect(args).toContain("test prompt");
      expect(args).toContain("--thread-id");
      expect(args).toContain("test-thread-123");
      expect(args).toContain("--repo-id");
      expect(args).toContain("test-repo-456");
      expect(args).toContain("--anvil-dir");
      expect(args).toContain("/anvil/dir");
      expect(args).toContain("--cwd");
      expect(args).toContain("/test/cwd");
    });
  });

  describe("assertions", () => {
    it("assertAgent creates AgentAssertions instance", () => {
      const mockOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };
      const assertions = assertAgent(mockOutput);
      expect(assertions).toBeInstanceOf(AgentAssertions);
    });

    it("AgentAssertions.succeeded() validates exit code 0", () => {
      const mockOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };
      expect(() => assertAgent(mockOutput).succeeded()).not.toThrow();
    });

    it("AgentAssertions.succeeded() throws for non-zero exit code", () => {
      const mockOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 1,
        stderr: "error message",
        durationMs: 100,
      };
      expect(() => assertAgent(mockOutput).succeeded()).toThrow(/exit code 0.*got 1/i);
    });

    it("AgentAssertions.hasEvent() finds event by name", () => {
      const mockOutput: AgentRunOutput = {
        logs: [],
        events: [
          { type: "event", name: "thread:created", payload: { threadId: "123" } },
        ],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };
      expect(() => assertAgent(mockOutput).hasEvent("thread:created")).not.toThrow();
    });

    it("AgentAssertions.hasEvent() throws when event not found", () => {
      const mockOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };
      expect(() => assertAgent(mockOutput).hasEvent("thread:created")).toThrow(
        /Expected event.*thread:created.*not found/
      );
    });
  });

  describe("type exports compile correctly", () => {
    // These tests just verify the types are usable
    // If they compile, the types are exported correctly

    it("AgentTestHarnessOptions type is usable", () => {
      const opts: AgentTestHarnessOptions = {
        prompt: "test",
        timeout: 30000,
      };
      expect(opts.prompt).toBe("test");
    });

    it("RunnerConfig type is usable", () => {
      const config: RunnerConfig = defaultRunnerConfig;
      expect(config.runnerPath).toBeDefined();
    });

    it("AgentRunOutput type is usable", () => {
      const output: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 0,
      };
      expect(output.exitCode).toBe(0);
    });

    it("ThreadState type is usable", () => {
      const state: ThreadState = {
        status: "idle",
        turnCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      expect(state.status).toBe("idle");
    });

    it("FileChange type is usable", () => {
      const change: FileChange = {
        path: "/test/file.ts",
        type: "create",
      };
      expect(change.type).toBe("create");
    });

    it("MockScript type is usable", () => {
      const script: MockScript = {
        responses: [{ content: "test" }],
      };
      expect(script.responses).toHaveLength(1);
    });

    it("MockResponse type is usable", () => {
      const response: MockResponse = {
        content: "Hello",
        toolCalls: [{ name: "Read", input: { file_path: "/test" } }],
      };
      expect(response.content).toBe("Hello");
    });

    it("MockToolCall type is usable", () => {
      const toolCall: MockToolCall = {
        name: "Write",
        input: { file_path: "/test", content: "hello" },
        mockResult: "OK",
      };
      expect(toolCall.name).toBe("Write");
    });

    it("SDKMessage types are usable", () => {
      const textBlock: TextBlock = { type: "text", text: "Hello", citations: null };
      const toolUseBlock: ToolUseBlock = {
        type: "tool_use",
        id: "123",
        name: "Read",
        input: {},
      };
      const contentBlocks: ContentBlock[] = [textBlock, toolUseBlock];
      expect(contentBlocks).toHaveLength(2);

      // SDKAssistantMessage requires all SDK fields
      const assistantMsg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: contentBlocks,
          model: "mock-model",
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: null,
        uuid: "00000000-0000-0000-0000-000000000000" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "mock-session",
      };
      expect(assistantMsg.type).toBe("assistant");

      // SDKResultMessage requires all SDK fields
      const resultMsg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 100,
        is_error: false,
        num_turns: 1,
        result: "",
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          server_tool_use: { web_search_requests: 0 },
          service_tier: "standard",
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "00000000-0000-0000-0000-000000000000" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "mock-session",
      };
      expect(resultMsg.subtype).toBe("success");
    });

    it("MockQueryOptions type is usable", () => {
      const options: MockQueryOptions = {
        onToolResult: async () => {},
        onToolFailure: async () => {},
      };
      expect(options.onToolResult).toBeDefined();
    });
  });
});
