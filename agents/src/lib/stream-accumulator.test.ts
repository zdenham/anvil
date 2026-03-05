/**
 * StreamAccumulator Tests
 *
 * Verifies:
 * - messageId captured from message_start and included in stream_delta
 * - No chain IDs (id, previousEventId) in emitted deltas
 * - Block UUIDs generated at content_block_start and included in deltas
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamAccumulator } from "./stream-accumulator.js";
import type { HubClient } from "./hub/client.js";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

vi.mock("./logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createMockHub(connected = true): HubClient & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    isConnected: connected,
    send: vi.fn((msg: unknown) => sent.push(msg)),
    sent,
  } as unknown as HubClient & { sent: unknown[] };
}

describe("StreamAccumulator", () => {
  let hub: ReturnType<typeof createMockHub>;
  let acc: StreamAccumulator;

  beforeEach(() => {
    vi.useFakeTimers();
    hub = createMockHub();
    acc = new StreamAccumulator(hub, "thread-1", 50);
  });

  it("captures messageId from message_start and includes it in stream_delta", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_abc123" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    expect(hub.sent).toHaveLength(1);
    const msg = hub.sent[0] as Record<string, unknown>;
    expect(msg.type).toBe("stream_delta");
    expect(msg.threadId).toBe("thread-1");
    expect(msg.messageId).toBe("msg_abc123");
  });

  it("emits stream_delta without chain IDs (id, previousEventId)", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_xyz" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const msg = hub.sent[0] as Record<string, unknown>;
    expect(msg).not.toHaveProperty("id");
    expect(msg).not.toHaveProperty("previousEventId");
  });

  it("messageId is null before message_start is received", () => {
    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "early" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const msg = hub.sent[0] as Record<string, unknown>;
    expect(msg.messageId).toBeNull();
  });

  it("reset clears messageId for next message", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_first" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.reset();

    // Start a new message
    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "after reset" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const msg = hub.sent[0] as Record<string, unknown>;
    expect(msg.messageId).toBeNull();
  });

  it("generates unique blockId for each content_block_start", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_001" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 1,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "hmm" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "hello" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const msg = hub.sent[0] as Record<string, unknown>;
    const deltas = msg.deltas as Array<{ blockId: string; index: number }>;
    expect(deltas).toHaveLength(2);
    expect(deltas[0].blockId).toBeDefined();
    expect(deltas[1].blockId).toBeDefined();
    expect(deltas[0].blockId).not.toBe(deltas[1].blockId);
  });

  it("includes consistent blockId across subsequent deltas for the same block", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_002" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "first" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const firstMsg = hub.sent[0] as Record<string, unknown>;
    const firstDeltas = firstMsg.deltas as Array<{ blockId: string }>;
    const blockId = firstDeltas[0].blockId;

    // Send more content to the same block
    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " second" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const secondMsg = hub.sent[1] as Record<string, unknown>;
    const secondDeltas = secondMsg.deltas as Array<{ blockId: string }>;
    expect(secondDeltas[0].blockId).toBe(blockId);
  });

  it("reset clears block IDs", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_003" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "before" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const firstMsg = hub.sent[0] as Record<string, unknown>;
    const firstBlockId = (firstMsg.deltas as Array<{ blockId: string }>)[0].blockId;

    acc.reset();

    // New message with same block index
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_004" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "after" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const secondMsg = hub.sent[1] as Record<string, unknown>;
    const secondBlockId = (secondMsg.deltas as Array<{ blockId: string }>)[0].blockId;
    expect(secondBlockId).not.toBe(firstBlockId);
  });

  it("no longer emits full field", () => {
    acc.handleDelta({
      type: "message_start",
      message: { id: "msg_005" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.handleDelta({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "content" },
    } as unknown as BetaRawMessageStreamEvent);

    acc.flush();

    const msg = hub.sent[0] as Record<string, unknown>;
    expect(msg).not.toHaveProperty("full");
    // First emission uses deltas format (not empty)
    expect((msg.deltas as unknown[]).length).toBeGreaterThan(0);
  });
});
