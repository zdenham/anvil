import { describe, it, expect, vi } from "vitest";

vi.mock("../../output.js", () => ({
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

vi.mock("../shared.js", () => ({
  getChildThreadId: vi.fn(() => null),
  emitEvent: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { MessageHandler } from "../message-handler.js";

describe("MessageHandler.getUtilization()", () => {
  it("returns null when context window is not yet known", () => {
    const handler = new MessageHandler();
    expect(handler.getUtilization()).toBeNull();
  });

  it("returns 0 when defaultContextWindow is set but no tokens consumed", () => {
    const handler = new MessageHandler(undefined, undefined, undefined, 200_000);
    expect(handler.getUtilization()).toBe(0);
  });

  it("returns 0 when no tokens have been consumed", async () => {
    const handler = new MessageHandler();

    // Simulate a result message that sets contextWindow
    await handler.handle({
      type: "result",
      subtype: "success",
      duration_api_ms: 100,
      total_cost_usd: 0.01,
      num_turns: 1,
      is_error: false,
      modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } },
    } as never);

    expect(handler.getUtilization()).toBe(0);
  });

  it("returns correct percentage after tokens are consumed", async () => {
    const handler = new MessageHandler(undefined, undefined, {
      emit: vi.fn(),
    } as never);

    // First: set contextWindow via result message
    await handler.handle({
      type: "result",
      subtype: "success",
      duration_api_ms: 100,
      total_cost_usd: 0.01,
      num_turns: 1,
      is_error: false,
      modelUsage: { "claude-sonnet-4-6": { contextWindow: 100000 } },
    } as never);

    // Then: simulate an assistant message with usage
    await handler.handle({
      type: "assistant",
      message: {
        id: "msg_1",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 50000,
          output_tokens: 1000,
        },
      },
    } as never);

    expect(handler.getUtilization()).toBe(50);
  });

  it("uses latest turn tokens, not cumulative sum", async () => {
    const handler = new MessageHandler(undefined, undefined, {
      emit: vi.fn(),
    } as never);

    // Set contextWindow
    await handler.handle({
      type: "result",
      subtype: "success",
      duration_api_ms: 100,
      total_cost_usd: 0.01,
      num_turns: 1,
      is_error: false,
      modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } },
    } as never);

    // Turn 1: 10k tokens
    await handler.handle({
      type: "assistant",
      message: {
        id: "msg_1",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10000, output_tokens: 500 },
      },
    } as never);
    expect(handler.getUtilization()).toBe(5); // 10k / 200k

    // Turn 2: 15k tokens — utilization should reflect latest turn, not sum
    await handler.handle({
      type: "assistant",
      message: {
        id: "msg_2",
        content: [{ type: "text", text: "world" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 15000, output_tokens: 500 },
      },
    } as never);
    expect(handler.getUtilization()).toBe(7.5); // 15k / 200k, NOT 25k / 200k

    // Turn 3: 50k tokens
    await handler.handle({
      type: "assistant",
      message: {
        id: "msg_3",
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 50000, output_tokens: 500 },
      },
    } as never);
    expect(handler.getUtilization()).toBe(25); // 50k / 200k, NOT 75k / 200k
  });
});
