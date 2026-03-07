import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageHandler } from "./message-handler.js";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";

// Mock the stream-accumulator module with a proper class
vi.mock("../lib/stream-accumulator.js", () => {
  const MockStreamAccumulator = vi.fn(function (this: Record<string, unknown>) {
    this.handleDelta = vi.fn();
    this.flush = vi.fn();
    this.reset = vi.fn();
  });
  return { StreamAccumulator: MockStreamAccumulator };
});

// Mock the output module
vi.mock("../output.js", () => ({
  appendAssistantMessage: vi.fn(),
  appendUserMessage: vi.fn(),
  markToolRunning: vi.fn(),
  markToolComplete: vi.fn(),
  complete: vi.fn(),
  setSessionId: vi.fn(),
  updateUsage: vi.fn(),
  writeUsageToMetadata: vi.fn(),
  getHubClient: vi.fn(() => null),
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

// Mock shared.js - emitEvent is used for ack events
vi.mock("./shared.js", async () => {
  const actual = await vi.importActual("./shared.js");
  return {
    ...actual,
    emitEvent: vi.fn(),
    getChildThreadId: vi.fn(() => undefined),
  };
});

// Mock fs for child thread state management
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
  };
});

// Import mocked functions for assertions
import {
  appendAssistantMessage,
  appendUserMessage,
  markToolRunning,
  markToolComplete,
  complete,
  getHubClient,
} from "../output.js";
import { logger } from "../lib/logger.js";
import { emitEvent, getChildThreadId } from "./shared.js";

describe("MessageHandler", () => {
  let handler: MessageHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new MessageHandler();
  });

  describe("handleAssistant", () => {
    it("marks tool_use blocks as running", async () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_abc", name: "Read", input: { path: "/test" } },
            { type: "tool_use", id: "toolu_def", name: "Bash", input: { command: "ls" } },
          ],
          model: "claude-opus-4-6",
          stop_reason: "tool_use",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: null,
        uuid: "uuid-123" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(true);
      expect(markToolRunning).toHaveBeenCalledTimes(2);
      expect(markToolRunning).toHaveBeenCalledWith("toolu_abc", "Read");
      expect(markToolRunning).toHaveBeenCalledWith("toolu_def", "Bash");
    });

    it("appends assistant message to state", async () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello!", citations: null }],
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: null,
        uuid: "uuid-123" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      await handler.handle(msg);

      expect(appendAssistantMessage).toHaveBeenCalledWith({
        role: "assistant",
        content: [{ type: "text", text: "Hello!", citations: null }],
        id: expect.any(String),
        anthropicId: "msg_123",
      });
    });
  });

  describe("handleUser", () => {
    it("marks tools complete with result", async () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "File contents here",
            },
          ],
        },
        parent_tool_use_id: "toolu_abc",
        tool_use_result: "File contents here",
        uuid: "uuid-456" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(true);
      expect(markToolComplete).toHaveBeenCalledWith("toolu_abc", "File contents here", false);
    });

    it("detects errors from tool_use_result", async () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "Error: file not found",
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: "toolu_abc",
        tool_use_result: { content: "Error: file not found", is_error: true },
        uuid: "uuid-456" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      await handler.handle(msg);

      expect(markToolComplete).toHaveBeenCalledWith(
        "toolu_abc",
        expect.any(String),
        true
      );
    });

    it("detects errors from message content is_error", async () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "Permission denied",
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: "toolu_abc",
        uuid: "uuid-456" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      await handler.handle(msg);

      expect(markToolComplete).toHaveBeenCalledWith("toolu_abc", "Permission denied", true);
    });

    it("ignores synthetic/initial user messages", async () => {
      // User messages without isSynthetic (undefined) are treated as synthetic/initial
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: "Please help me with something",
        },
        parent_tool_use_id: null,
        uuid: "uuid-456" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(true);
      expect(markToolComplete).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        "[MessageHandler] Ignoring synthetic/initial user message"
      );
    });

    it("appends queued user messages (isSynthetic: false)", async () => {
      // Queued messages from stdin have isSynthetic: false
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: "Follow-up question from user",
        },
        parent_tool_use_id: null,
        isSynthetic: false,
        uuid: "uuid-456" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(true);
      expect(appendUserMessage).toHaveBeenCalledWith("uuid-456", "Follow-up question from user");
      expect(logger.info).toHaveBeenCalledWith(
        "[MessageHandler] Processed queued user message"
      );
    });

    it("handles queued user messages with content blocks", async () => {
      // Content can be an array of blocks
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
          ],
        },
        parent_tool_use_id: null,
        isSynthetic: false,
        uuid: "uuid-456" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(true);
      expect(appendUserMessage).toHaveBeenCalledWith("uuid-456", "First part\nSecond part");
    });
  });

  describe("handleResult", () => {
    it("calls complete on success", async () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        duration_ms: 1000,
        duration_api_ms: 800,
        is_error: false,
        num_turns: 3,
        result: "Done",
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          server_tool_use: { web_search_requests: 0 },
          service_tier: "standard",
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-789" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(false);
      expect(complete).toHaveBeenCalledWith({
        durationApiMs: 800,
        totalCostUsd: 0.05,
        numTurns: 3,
        contextWindow: undefined,
      });
    });

    it("does not call complete on error_during_execution", async () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "error_during_execution",
        duration_ms: 500,
        duration_api_ms: 400,
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0.01,
        errors: ["Something went wrong"],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          server_tool_use: { web_search_requests: 0 },
          service_tier: "standard",
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-789" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(false);
      expect(complete).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[MessageHandler] Execution error: Something went wrong"
      );
    });

    it("does not call complete on error_max_turns", async () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "error_max_turns",
        duration_ms: 10000,
        duration_api_ms: 9000,
        is_error: true,
        num_turns: 100,
        total_cost_usd: 1.0,
        errors: ["Max turns reached"],
        usage: {
          input_tokens: 10000,
          output_tokens: 5000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          server_tool_use: { web_search_requests: 0 },
          service_tier: "standard",
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-789" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(false);
      expect(complete).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[MessageHandler] Max turns reached: 100"
      );
    });

    it("calls complete on unknown non-error subtype", async () => {
      const msg = {
        type: "result",
        subtype: "unknown_success_type",
        duration_ms: 1000,
        duration_api_ms: 800,
        is_error: false,
        num_turns: 2,
        total_cost_usd: 0.03,
        usage: {
          input_tokens: 300,
          output_tokens: 150,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          server_tool_use: { web_search_requests: 0 },
          service_tier: "standard",
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-789" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      } as unknown as SDKResultMessage;

      await handler.handle(msg);

      expect(complete).toHaveBeenCalledWith({
        durationApiMs: 800,
        totalCostUsd: 0.03,
        numTurns: 2,
        contextWindow: undefined,
      });
    });
  });

  describe("handleToolProgress", () => {
    it("logs progress and continues", async () => {
      const msg: SDKToolProgressMessage = {
        type: "tool_progress",
        tool_use_id: "toolu_abc",
        tool_name: "Bash",
        parent_tool_use_id: null,
        elapsed_time_seconds: 5,
        uuid: "uuid-999" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg);

      expect(shouldContinue).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        "[MessageHandler] Tool Bash running for 5s"
      );
    });
  });

  describe("unknown message types", () => {
    it("ignores unknown message types and continues", async () => {
      const msg = {
        type: "unknown_type",
        uuid: "uuid-000" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      const shouldContinue = await handler.handle(msg as any);

      expect(shouldContinue).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        "[MessageHandler] Ignoring message type: unknown_type"
      );
    });
  });

  describe("handleUser - queued message ack", () => {
    it("emits queued-message:ack event when msg.uuid is present and isSynthetic is false", async () => {
      const testUuid = "550e8400-e29b-41d4-a716-446655440000" as `${string}-${string}-${string}-${string}-${string}`;

      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: "Follow-up from user",
        },
        parent_tool_use_id: null,
        isSynthetic: false,
        uuid: testUuid,
        session_id: "session-123",
      };

      await handler.handle(msg);

      // Verify emitEvent was called with ack event
      expect(emitEvent).toHaveBeenCalledWith("queued-message:ack", { messageId: testUuid }, "MessageHandler:queued-ack");

      // Verify appendUserMessage was also called
      expect(appendUserMessage).toHaveBeenCalledWith(testUuid, "Follow-up from user");
    });

    it("does NOT emit ack when uuid is missing", async () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: "Message without uuid",
        },
        parent_tool_use_id: null,
        isSynthetic: false,
        // uuid is undefined
        session_id: "session-123",
      };

      await handler.handle(msg);

      // emitEvent should not have been called with ack event
      expect(emitEvent).not.toHaveBeenCalledWith(
        "queued-message:ack",
        expect.anything()
      );

      // But appendUserMessage should still be called
      expect(appendUserMessage).toHaveBeenCalledWith(expect.any(String), "Message without uuid");
    });

    it("does NOT emit ack for synthetic messages", async () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: "Initial prompt",
        },
        parent_tool_use_id: null,
        isSynthetic: true, // synthetic = initial prompt
        uuid: "550e8400-e29b-41d4-a716-446655440000" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      await handler.handle(msg);

      expect(emitEvent).not.toHaveBeenCalledWith(
        "queued-message:ack",
        expect.anything()
      );

      // Synthetic messages should be ignored (not appended)
      expect(appendUserMessage).not.toHaveBeenCalled();
    });

    it("does NOT emit ack for tool result messages", async () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "Tool output",
            },
          ],
        },
        parent_tool_use_id: "toolu_abc",
        uuid: "550e8400-e29b-41d4-a716-446655440000" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-123",
      };

      await handler.handle(msg);

      // Tool results should not trigger ack
      expect(emitEvent).not.toHaveBeenCalledWith(
        "queued-message:ack",
        expect.anything()
      );

      // But markToolComplete should be called
      expect(markToolComplete).toHaveBeenCalled();
    });

    it("emits ack BEFORE appending user message", async () => {
      const callOrder: string[] = [];

      // Track call order
      vi.mocked(emitEvent).mockImplementation(() => {
        callOrder.push("emitEvent");
      });
      vi.mocked(appendUserMessage).mockImplementation(async () => {
        callOrder.push("appendUserMessage");
      });

      const testUuid = "550e8400-e29b-41d4-a716-446655440000" as `${string}-${string}-${string}-${string}-${string}`;

      const msg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: "Follow-up message",
        },
        parent_tool_use_id: null,
        isSynthetic: false,
        uuid: testUuid,
        session_id: "session-123",
      };

      await handler.handle(msg);

      // Verify emitEvent (ack) is called before appendUserMessage
      expect(callOrder).toEqual(["emitEvent", "appendUserMessage"]);
    });
  });

  describe("handleForChildThread - hub emission", () => {
    const CHILD_THREAD_ID = "child-thread-123";
    let childHandler: MessageHandler;
    let mockSendActionForThread: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();

      // Set up getChildThreadId to return a child thread ID for known parent_tool_use_id
      vi.mocked(getChildThreadId).mockImplementation((toolUseId: string) =>
        toolUseId === "toolu_task" ? CHILD_THREAD_ID : undefined
      );

      // Create handler with mortDir so child thread routing activates
      const tmpDir = "/tmp/test-mort";
      childHandler = new MessageHandler(tmpDir);

      // Mock hub client
      mockSendActionForThread = vi.fn();
      vi.mocked(getHubClient).mockReturnValue({
        sendActionForThread: mockSendActionForThread,
        connectionState: "connected",
      } as any);
    });

    it("emits MARK_TOOL_RUNNING for tool_use blocks in assistant messages", async () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_1",
          type: "message",
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_inner", name: "Read", input: { path: "/test" } },
          ],
          model: "claude-opus-4-6",
          stop_reason: "tool_use",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-1" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(msg);

      expect(mockSendActionForThread).toHaveBeenCalledWith(CHILD_THREAD_ID, {
        type: "MARK_TOOL_RUNNING",
        payload: { toolUseId: "toolu_inner", toolName: "Read" },
      });
    });

    it("emits UPDATE_USAGE for assistant messages with usage", async () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_2",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Done", citations: null }],
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-2" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(msg);

      expect(mockSendActionForThread).toHaveBeenCalledWith(CHILD_THREAD_ID, {
        type: "UPDATE_USAGE",
        payload: {
          usage: {
            inputTokens: 200,
            outputTokens: 100,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
          },
        },
      });
    });

    it("emits APPEND_ASSISTANT_MESSAGE for assistant messages", async () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_3",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello from sub-agent", citations: null }],
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-3" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(msg);

      expect(mockSendActionForThread).toHaveBeenCalledWith(CHILD_THREAD_ID, {
        type: "APPEND_ASSISTANT_MESSAGE",
        payload: {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello from sub-agent", citations: null }],
            id: expect.any(String),
            anthropicId: "msg_child_3",
          },
        },
      });
    });

    it("emits MARK_TOOL_COMPLETE for user messages with tool results", async () => {
      // First send an assistant message with a tool_use so the child state has a tool
      const assistantMsg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_4",
          type: "message",
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_inner_2", name: "Bash", input: { command: "ls" } },
          ],
          model: "claude-opus-4-6",
          stop_reason: "tool_use",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-4" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };
      await childHandler.handle(assistantMsg);
      mockSendActionForThread.mockClear();

      // Now send the tool result
      const userMsg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_inner_2",
              content: "file1.ts\nfile2.ts",
            },
          ],
        },
        parent_tool_use_id: "toolu_task",
        tool_use_result: "file1.ts\nfile2.ts",
        uuid: "uuid-child-5" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(userMsg);

      expect(mockSendActionForThread).toHaveBeenCalledWith(CHILD_THREAD_ID, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "toolu_inner_2", result: "file1.ts\nfile2.ts", isError: false },
      });
    });

    it("gracefully handles null hub client (disk-only fallback)", async () => {
      vi.mocked(getHubClient).mockReturnValue(null);

      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_6",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "No hub", citations: null }],
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-6" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      // Should not throw
      const result = await childHandler.handle(msg);
      expect(result).toBe(true);
      // No hub calls should be made
      expect(mockSendActionForThread).not.toHaveBeenCalled();
    });

    it("includes id and anthropicId on child assistant messages", async () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_ids",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "With IDs", citations: null }],
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-ids" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(msg);

      // The APPEND_ASSISTANT_MESSAGE payload should include id and anthropicId
      const appendCall = mockSendActionForThread.mock.calls.find(
        (call: unknown[]) => (call[1] as { type: string }).type === "APPEND_ASSISTANT_MESSAGE"
      );
      expect(appendCall).toBeDefined();
      const payload = (appendCall![1] as { payload: { message: { id: string; anthropicId: string } } }).payload;
      expect(payload.message.id).toEqual(expect.any(String));
      expect(payload.message.id.length).toBeGreaterThan(0);
      expect(payload.message.anthropicId).toBe("msg_child_ids");
    });

    it("appends user message to state and emits APPEND_USER_MESSAGE for tool results", async () => {
      // First send an assistant message with a tool_use
      const assistantMsg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: "msg_child_user_1",
          type: "message",
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_user_test", name: "Read", input: { path: "/test" } },
          ],
          model: "claude-opus-4-6",
          stop_reason: "tool_use",
          stop_sequence: null,
          container: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-child-user-1" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };
      await childHandler.handle(assistantMsg);
      mockSendActionForThread.mockClear();

      // Now send the tool result
      const userMsg: SDKUserMessage = {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_user_test",
              content: "file contents here",
            },
          ],
        },
        parent_tool_use_id: "toolu_task",
        tool_use_result: "file contents here",
        uuid: "uuid-child-user-2" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(userMsg);

      // Should emit both MARK_TOOL_COMPLETE and APPEND_USER_MESSAGE
      expect(mockSendActionForThread).toHaveBeenCalledWith(CHILD_THREAD_ID, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "toolu_user_test", result: "file contents here", isError: false },
      });

      const appendCall = mockSendActionForThread.mock.calls.find(
        (call: unknown[]) => (call[1] as { type: string }).type === "APPEND_USER_MESSAGE"
      );
      expect(appendCall).toBeDefined();
      const payload = (appendCall![1] as { payload: { id: string; content: string } }).payload;
      expect(payload.id).toEqual(expect.any(String));
      expect(payload.id.length).toBeGreaterThan(0);
    });

    it("routes stream_event to per-child StreamAccumulator", async () => {
      const { StreamAccumulator: MockStreamAccumulator } = await import("../lib/stream-accumulator.js");

      const streamMsg = {
        type: "stream_event" as const,
        event: {
          type: "content_block_delta" as const,
          index: 0,
          delta: { type: "text_delta" as const, text: "hello" },
        },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-stream-1" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };

      await childHandler.handle(streamMsg as any);

      // StreamAccumulator should have been constructed with hub and child thread ID
      expect(MockStreamAccumulator).toHaveBeenCalledWith(
        expect.objectContaining({ sendActionForThread: mockSendActionForThread }),
        CHILD_THREAD_ID,
      );

      // handleDelta should have been called
      const instance = (MockStreamAccumulator as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(instance.handleDelta).toHaveBeenCalledWith(streamMsg.event);
    });

    it("flushes and cleans up child accumulator on message_stop", async () => {
      const { StreamAccumulator: MockStreamAccumulator } = await import("../lib/stream-accumulator.js");

      // First send a delta to create the accumulator
      const deltaMsg = {
        type: "stream_event" as const,
        event: { type: "content_block_delta" as const, index: 0, delta: { type: "text_delta" as const, text: "hi" } },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-stream-2" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };
      await childHandler.handle(deltaMsg as any);

      const instance = (MockStreamAccumulator as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;

      // Now send message_stop
      const stopMsg = {
        type: "stream_event" as const,
        event: { type: "message_stop" as const },
        parent_tool_use_id: "toolu_task",
        uuid: "uuid-stream-3" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "session-child",
      };
      await childHandler.handle(stopMsg as any);

      expect(instance.flush).toHaveBeenCalled();
      expect(instance.reset).toHaveBeenCalled();
    });
  });
});
