import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import { startTestServer, stopTestServer } from "./setup.js";

let baseUrl: string;
let redis: Redis | null = null;
let redisAvailable = false;

/** Shared channel registered in beforeAll for most tests. */
let channelId: string;
let deviceId: string;

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

beforeAll(async () => {
  try {
    const ctx = await startTestServer();
    baseUrl = ctx.baseUrl;
    redis = ctx.redis;
    redisAvailable = true;

    // Register a channel shared across tests in this file
    deviceId = randomUUID();
    const result = await registerChannel(deviceId, "webhook-tests");
    channelId = result.channelId;
  } catch {
    // Redis not available — tests will skip
  }
});

afterAll(async () => {
  if (redisAvailable) {
    await stopTestServer();
  }
});

describe("POST /gateway/channels/:channelId/events", () => {
  it("accepts a webhook and returns 201", async ({ skip }) => {
    if (!redisAvailable) skip();

    const res = await fetch(
      `${baseUrl}/gateway/channels/${channelId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "push",
        },
        body: JSON.stringify({ ref: "refs/heads/main" }),
      }
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { eventId: string };
    expect(body.eventId).toBeDefined();
  });

  it("returns 404 for non-existent channelId", async ({ skip }) => {
    if (!redisAvailable) skip();

    const fakeId = randomUUID();
    const res = await fetch(
      `${baseUrl}/gateway/channels/${fakeId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "push",
        },
        body: JSON.stringify({ ref: "refs/heads/main" }),
      }
    );

    expect(res.status).toBe(404);
  });

  it("constructs event type from X-GitHub-Event header", async ({ skip }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    // Use a fresh device + channel to isolate stream reads
    const freshDeviceId = randomUUID();
    const channel = await registerChannel(freshDeviceId, "event-type-test");

    await fetch(`${baseUrl}/gateway/channels/${channel.channelId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issue_comment",
      },
      body: JSON.stringify({ action: "created" }),
    });

    // Read the event from the Redis stream directly
    const streamKey = `gateway:events:${freshDeviceId}`;
    const entries = await redis.xrange(streamKey, "-", "+");
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const [, fields] = entries[0];
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }
    expect(fieldMap.get("type")).toBe("github.issue_comment");
  });

  it("stores event in device's Redis stream", async ({ skip }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const freshDeviceId = randomUUID();
    const channel = await registerChannel(freshDeviceId, "stream-store-test");

    const payload = { action: "opened", pull_request: { number: 42 } };
    await fetch(`${baseUrl}/gateway/channels/${channel.channelId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
      },
      body: JSON.stringify(payload),
    });

    const streamKey = `gateway:events:${freshDeviceId}`;
    const entries = await redis.xrange(streamKey, "-", "+");
    expect(entries).toHaveLength(1);

    const [, fields] = entries[0];
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    expect(fieldMap.get("channelId")).toBe(channel.channelId);
    expect(fieldMap.get("type")).toBe("github.pull_request");

    const storedPayload = JSON.parse(fieldMap.get("payload")!) as Record<string, unknown>;
    expect(storedPayload.action).toBe("opened");

    const receivedAt = Number(fieldMap.get("receivedAt"));
    expect(receivedAt).toBeGreaterThan(0);
    expect(receivedAt).toBeLessThanOrEqual(Date.now());
  });

  it("event contains correct channelId, payload, and receivedAt", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const freshDeviceId = randomUUID();
    const channel = await registerChannel(freshDeviceId, "field-check-test");

    const payload = { action: "created", comment: { body: "looks good" } };
    const beforePost = Date.now();

    const res = await fetch(
      `${baseUrl}/gateway/channels/${channel.channelId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "pull_request_review_comment",
        },
        body: JSON.stringify(payload),
      }
    );
    await res.json(); // consume response to ensure request is complete
    expect(res.status).toBe(201);

    const afterPost = Date.now();
    const streamKey = `gateway:events:${freshDeviceId}`;
    const entries = await redis.xrange(streamKey, "-", "+");
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const [, fields] = entries[0];

    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    expect(fieldMap.get("channelId")).toBe(channel.channelId);

    const storedPayload = JSON.parse(fieldMap.get("payload")!) as Record<string, unknown>;
    expect(storedPayload.action).toBe("created");
    expect((storedPayload.comment as Record<string, unknown>).body).toBe("looks good");

    const receivedAt = Number(fieldMap.get("receivedAt"));
    expect(receivedAt).toBeGreaterThanOrEqual(beforePost);
    expect(receivedAt).toBeLessThanOrEqual(afterPost);
  });
});
