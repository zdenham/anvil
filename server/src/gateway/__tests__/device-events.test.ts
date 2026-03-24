import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import { startTestServer, stopTestServer } from "./setup.js";
import { readSSEEvents } from "./sse-reader.js";

let baseUrl: string;
let redis: Redis | null = null;
let redisAvailable = false;

async function registerChannel(
  dId: string,
  label: string
): Promise<{ channelId: string; webhookUrl: string }> {
  const res = await fetch(`${baseUrl}/gateway/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: dId, type: "github", label }),
  });
  return (await res.json()) as { channelId: string; webhookUrl: string };
}

async function postWebhook(
  cId: string,
  githubEvent: string,
  payload: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${baseUrl}/gateway/channels/${cId}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": githubEvent,
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { eventId: string };
  return body.eventId;
}

/**
 * Post N webhooks to a channel and return the Redis stream IDs.
 * We read the stream after each post to capture the stream ID.
 */
async function postEvents(
  cId: string,
  deviceId: string,
  count: number
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    await postWebhook(cId, "push", { index: i });
    // Read the last entry from the stream to get its stream ID
    const entries = await redis.xrevrange(
      `gateway:events:${deviceId}`,
      "+",
      "-",
      "COUNT",
      1
    );
    ids.push(entries[0][0]);
  }
  return ids;
}

function sseUrl(deviceId: string): string {
  return `${baseUrl}/gateway/devices/${deviceId}/events`;
}

beforeAll(async () => {
  try {
    const ctx = await startTestServer();
    baseUrl = ctx.baseUrl;
    redis = ctx.redis;
    redisAvailable = true;
  } catch {
    // Redis not available — tests will skip
  }
});

afterAll(async () => {
  if (redisAvailable) {
    await stopTestServer();
  }
});

describe("GET /gateway/devices/:deviceId/events (SSE)", () => {
  it("streams a live event when webhook arrives while connected", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();

    const deviceId = randomUUID();
    const channel = await registerChannel(deviceId, "live-stream-test");

    // Start SSE reader first — it will block until an event arrives or timeout
    const ssePromise = readSSEEvents(sseUrl(deviceId), {
      maxEvents: 1,
      timeoutMs: 5000,
    });

    // Brief delay to let SSE connection establish and enter XREAD BLOCK
    await new Promise((r) => setTimeout(r, 300));

    // Fire a webhook while connected
    await postWebhook(channel.channelId, "push", { ref: "refs/heads/main" });

    const events = await ssePromise;
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("github.push");

    const data = JSON.parse(events[0].data) as {
      channelId: string;
      payload: Record<string, unknown>;
    };
    expect(data.channelId).toBe(channel.channelId);
    expect(data.payload.ref).toBe("refs/heads/main");
  });

  it("replays all buffered events on first connect (no Last-Event-ID)", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();

    const deviceId = randomUUID();
    const channel = await registerChannel(deviceId, "replay-all-test");

    // Post 3 events while no SSE connection exists
    await postWebhook(channel.channelId, "push", { index: 0 });
    await postWebhook(channel.channelId, "push", { index: 1 });
    await postWebhook(channel.channelId, "push", { index: 2 });

    // Connect without Last-Event-ID — should replay all 3
    const events = await readSSEEvents(sseUrl(deviceId), {
      maxEvents: 3,
      timeoutMs: 3000,
    });

    expect(events).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const data = JSON.parse(events[i].data) as {
        payload: Record<string, unknown>;
      };
      expect(data.payload.index).toBe(i);
    }
  });

  it("replays only events after Last-Event-ID on reconnect", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const deviceId = randomUUID();
    const channel = await registerChannel(deviceId, "replay-after-test");

    // Post 3 events, capturing their Redis stream IDs
    const streamIds = await postEvents(channel.channelId, deviceId, 3);

    // Connect with Last-Event-ID of the first event — should replay events 2 and 3
    const events = await readSSEEvents(sseUrl(deviceId), {
      lastEventId: streamIds[0],
      maxEvents: 2,
      timeoutMs: 3000,
    });

    expect(events).toHaveLength(2);

    const data0 = JSON.parse(events[0].data) as {
      payload: Record<string, unknown>;
    };
    const data1 = JSON.parse(events[1].data) as {
      payload: Record<string, unknown>;
    };
    expect(data0.payload.index).toBe(1);
    expect(data1.payload.index).toBe(2);
  });

  it("trims events before Last-Event-ID on reconnect", async ({ skip }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const deviceId = randomUUID();
    const channel = await registerChannel(deviceId, "trim-test");

    // Post 3 events
    const streamIds = await postEvents(channel.channelId, deviceId, 3);

    // Connect with Last-Event-ID of the second event — trims events before it
    const events = await readSSEEvents(sseUrl(deviceId), {
      lastEventId: streamIds[1],
      maxEvents: 1,
      timeoutMs: 3000,
    });

    // Should get event 3 (index 2)
    expect(events).toHaveLength(1);
    const data = JSON.parse(events[0].data) as {
      payload: Record<string, unknown>;
    };
    expect(data.payload.index).toBe(2);

    // Verify that events before Last-Event-ID are trimmed from Redis
    // XTRIM MINID trims entries with IDs strictly less than the given value
    const streamKey = `gateway:events:${deviceId}`;
    const remaining = await redis.xrange(streamKey, "-", "+");

    // The first event (streamIds[0]) should be trimmed.
    // streamIds[1] and streamIds[2] should remain.
    const remainingIds = remaining.map(([id]) => id);
    expect(remainingIds).not.toContain(streamIds[0]);
    expect(remainingIds).toContain(streamIds[1]);
    expect(remainingIds).toContain(streamIds[2]);
  });

  it("delivers events from multiple channels on same device stream", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();

    const deviceId = randomUUID();
    const channelA = await registerChannel(deviceId, "multi-chan-a");
    const channelB = await registerChannel(deviceId, "multi-chan-b");

    // Post one event on each channel
    await postWebhook(channelA.channelId, "push", { source: "a" });
    await postWebhook(channelB.channelId, "issue_comment", { source: "b" });

    // SSE for the device should receive both events
    const events = await readSSEEvents(sseUrl(deviceId), {
      maxEvents: 2,
      timeoutMs: 3000,
    });

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("github.push");
    expect(events[1].event).toBe("github.issue_comment");

    const dataA = JSON.parse(events[0].data) as {
      channelId: string;
      payload: Record<string, unknown>;
    };
    const dataB = JSON.parse(events[1].data) as {
      channelId: string;
      payload: Record<string, unknown>;
    };
    expect(dataA.channelId).toBe(channelA.channelId);
    expect(dataA.payload.source).toBe("a");
    expect(dataB.channelId).toBe(channelB.channelId);
    expect(dataB.payload.source).toBe("b");
  });

  it("full pipeline: register -> webhook -> SSE delivery", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();

    const deviceId = randomUUID();

    // 1. Register a channel
    const res = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, type: "github", label: "e2e-test" }),
    });
    const channel = (await res.json()) as {
      channelId: string;
      webhookUrl: string;
    };

    // 2. Start SSE listener
    const ssePromise = readSSEEvents(sseUrl(deviceId), {
      maxEvents: 1,
      timeoutMs: 5000,
    });

    // 3. Brief delay for the SSE connection to establish
    await new Promise((r) => setTimeout(r, 300));

    // 4. Fire a webhook
    await fetch(`${baseUrl}/gateway/channels/${channel.channelId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issue_comment",
      },
      body: JSON.stringify({
        action: "created",
        comment: { body: "@anvil run tests" },
      }),
    });

    // 5. Verify SSE received the event
    const events = await ssePromise;
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("github.issue_comment");

    const data = JSON.parse(events[0].data) as {
      channelId: string;
      payload: { action: string; comment: { body: string } };
    };
    expect(data.channelId).toBe(channel.channelId);
    expect(data.payload.action).toBe("created");
    expect(data.payload.comment.body).toBe("@anvil run tests");
  });

  it("reconnect replays missed events", async ({ skip }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const deviceId = randomUUID();
    const channel = await registerChannel(deviceId, "reconnect-test");

    // Post 3 events while "offline" (no SSE connection)
    const streamIds = await postEvents(channel.channelId, deviceId, 3);

    // "Reconnect" with Last-Event-ID of event 1 — should replay events 2 and 3
    const events = await readSSEEvents(sseUrl(deviceId), {
      lastEventId: streamIds[0],
      maxEvents: 2,
      timeoutMs: 3000,
    });

    expect(events).toHaveLength(2);
    const d0 = JSON.parse(events[0].data) as {
      payload: Record<string, unknown>;
    };
    const d1 = JSON.parse(events[1].data) as {
      payload: Record<string, unknown>;
    };
    expect(d0.payload.index).toBe(1);
    expect(d1.payload.index).toBe(2);
  });
});
