import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageHandler } from "./message-handler.js";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";

// Mock the output module
vi.mock("../output.js", () => ({
  appendAssistantMessage: vi.fn(),
  appendUserMessage: vi.fn(),
  markToolRunning: vi.fn(),
  markToolComplete: vi.fn(),
  complete: vi.fn(),
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

// Import mocked functions for assertions
import {
  appendAssistantMessage,
  appendUserMessage,
  markToolRunning,
  markToolComplete,
  complete,
} from "../output.js";
import { logger } from "../lib/logger.js";

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
          model: "claude-opus-4-5-20251101",
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
          model: "claude-opus-4-5-20251101",
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
      expect(appendUserMessage).toHaveBeenCalledWith("Follow-up question from user");
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
      expect(appendUserMessage).toHaveBeenCalledWith("First part\nSecond part");
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
});
