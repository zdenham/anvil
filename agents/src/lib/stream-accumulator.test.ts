/**
 * StreamAccumulator Tests — Phase 0 behavioral assertions
 *
 * Verifies:
 * - messageId captured from message_start and included in stream_delta
 * - No chain IDs (id, previousEventId) in emitted deltas
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
});
