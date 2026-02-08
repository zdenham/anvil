import { readFileSync } from "fs";
import { randomUUID, type UUID } from "crypto";
import type { MockScript, MockResponse } from "./mock-llm.js";
import { logger } from "../lib/logger.js";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

// Re-export SDK types for consumers
export type { SDKAssistantMessage, SDKUserMessage, SDKResultMessage, SDKMessage };
export type { TextBlock, ToolUseBlock };

// ContentBlock type for tool_use and text blocks
export type ContentBlock = TextBlock | ToolUseBlock;

// Default session ID for mock messages
const MOCK_SESSION_ID = "mock-session-id";

/**
 * Mock Claude client that returns scripted responses.
 * Implements the query-like interface used by the runner.
 */
export class MockClaudeClient {
  private responses: MockResponse[];
  private index = 0;
  private scriptPath: string;
  private startTime: number;

  constructor(scriptPath: string) {
    this.scriptPath = scriptPath;
    const script: MockScript = JSON.parse(readFileSync(scriptPath, "utf-8"));
    this.responses = script.responses;
    this.startTime = Date.now();
    logger.info(
      `[MockClaudeClient] Loaded ${this.responses.length} scripted responses from ${scriptPath}`
    );
  }

  /**
   * Get the next response from the script.
   * Returns null when script is exhausted.
   * @throws Error if script is exhausted and throwOnExhaust is true
   */
  nextResponse(throwOnExhaust = true): MockResponse | null {
    if (this.index >= this.responses.length) {
      if (throwOnExhaust) {
        throw new Error(
          `Mock script exhausted after ${this.index} responses. ` +
            `Script: ${this.scriptPath}`
        );
      }
      return null;
    }

    const response = this.responses[this.index++];
    logger.debug(
      `[MockClaudeClient] Returning response ${this.index}/${this.responses.length}`
    );
    return response;
  }

  /**
   * Build an assistant message from a mock response.
   * Returns SDK-compatible SDKAssistantMessage with all required fields.
   */
  buildAssistantMessage(response: MockResponse): SDKAssistantMessage {
    const content: ContentBlock[] = [];

    // Add tool_use blocks first (agent executes tools before continuing)
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id ?? `toolu_${randomUUID().slice(0, 8)}`,
          name: tc.name,
          input: tc.input,
        });
      }
    }

    // Add text block if content provided
    if (response.content) {
      content.push({
        type: "text",
        text: response.content,
        citations: null,
      });
    }

    return {
      type: "assistant",
      message: {
        id: `msg_${randomUUID().slice(0, 8)}`,
        type: "message",
        role: "assistant",
        content,
        model: "mock-model",
        stop_reason: response.toolCalls?.length ? "tool_use" : "end_turn",
        stop_sequence: null,
        container: null,
        context_management: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          cache_creation: null,
          server_tool_use: null,
          service_tier: null,
          inference_geo: null,
          iterations: null,
          speed: null,
        },
      },
      parent_tool_use_id: null,
      uuid: randomUUID() as UUID,
      session_id: MOCK_SESSION_ID,
    };
  }

  /**
   * Build a user message containing a tool result.
   * Returns SDK-compatible SDKUserMessage matching real SDK message sequence.
   */
  buildUserMessage(
    toolUseId: string,
    toolResult: string,
    isError = false
  ): SDKUserMessage {
    const toolResultBlock: ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: toolResult,
      is_error: isError,
    };

    return {
      type: "user",
      message: {
        role: "user",
        content: [toolResultBlock],
      },
      parent_tool_use_id: toolUseId,
      // When isError is true, include is_error in tool_use_result for detection
      tool_use_result: isError
        ? { content: toolResult, is_error: true }
        : toolResult,
      session_id: MOCK_SESSION_ID,
    };
  }

  /**
   * Build a success result message.
   * Returns SDK-compatible SDKResultMessage with all required fields.
   */
  buildResultMessage(): SDKResultMessage {
    const durationMs = Date.now() - this.startTime;
    return {
      type: "result",
      subtype: "success",
      duration_ms: durationMs,
      duration_api_ms: durationMs,
      is_error: false,
      num_turns: this.index,
      result: "",
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: "standard",
        inference_geo: "us",
        iterations: [],
        speed: "standard",
      },
      modelUsage: {},
      permission_denials: [],
      uuid: randomUUID() as UUID,
      session_id: MOCK_SESSION_ID,
    };
  }

  /**
   * Build an error result message.
   * Returns SDK-compatible SDKResultMessage with error subtype.
   */
  buildErrorResult(error: string): SDKResultMessage {
    const durationMs = Date.now() - this.startTime;
    return {
      type: "result",
      subtype: "error_during_execution",
      duration_ms: durationMs,
      duration_api_ms: durationMs,
      is_error: true,
      num_turns: this.index,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: "standard",
        inference_geo: "us",
        iterations: [],
        speed: "standard",
      },
      modelUsage: {},
      permission_denials: [],
      errors: [error],
      uuid: randomUUID() as UUID,
      session_id: MOCK_SESSION_ID,
    };
  }

  /**
   * Check if all scripted responses have been consumed.
   * Useful for test assertions.
   */
  isExhausted(): boolean {
    return this.index >= this.responses.length;
  }

  /**
   * Get count of remaining responses.
   */
  remainingResponses(): number {
    return this.responses.length - this.index;
  }

  /**
   * Reset the client to replay the script from the beginning.
   */
  reset(): void {
    this.index = 0;
    this.startTime = Date.now();
  }
}
