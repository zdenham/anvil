import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import { startTestServer, stopTestServer } from "./setup.js";

let baseUrl: string;
let redis: Redis | null = null;
let redisAvailable = false;

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

describe("POST /gateway/channels", () => {
  it("registers a new channel and returns channelId + webhookUrl", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();

    const deviceId = randomUUID();
    const res = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, type: "github", label: "test-channel" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { channelId: string; webhookUrl: string };
    expect(body.channelId).toBeDefined();
    expect(body.webhookUrl).toContain(`/gateway/channels/${body.channelId}/events`);
  });

  it("returns the same channel on duplicate registration (idempotent)", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();

    const deviceId = randomUUID();
    const payload = JSON.stringify({
      deviceId,
      type: "github",
      label: "idempotent-test",
    });
    const headers = { "Content-Type": "application/json" };

    const first = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers,
      body: payload,
    });
    const firstBody = (await first.json()) as { channelId: string; webhookUrl: string };
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers,
      body: payload,
    });
    const secondBody = (await second.json()) as { channelId: string; webhookUrl: string };
    expect(second.status).toBe(200);

    expect(secondBody.channelId).toBe(firstBody.channelId);
    expect(secondBody.webhookUrl).toBe(firstBody.webhookUrl);
  });

  it("rejects missing required fields with 400", async ({ skip }) => {
    if (!redisAvailable) skip();

    const res = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "github" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown };
    expect(body.error).toBeDefined();
  });

  it("stores channel in Redis with correct key structure", async ({
    skip,
  }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const deviceId = randomUUID();
    const res = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        type: "github",
        label: "redis-check",
      }),
    });

    const { channelId } = (await res.json()) as { channelId: string };
    const raw = await redis.get(`gateway:channel:${channelId}`);
    expect(raw).toBeTruthy();

    const channel = JSON.parse(raw!) as {
      channelId: string;
      deviceId: string;
      type: string;
      label: string;
      createdAt: string;
    };
    expect(channel.channelId).toBe(channelId);
    expect(channel.deviceId).toBe(deviceId);
    expect(channel.type).toBe("github");
    expect(channel.label).toBe("redis-check");
    expect(channel.createdAt).toBeDefined();
  });

  it("adds channelId to device's channel set", async ({ skip }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const deviceId = randomUUID();
    const res = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        type: "github",
        label: "set-check",
      }),
    });

    const { channelId } = (await res.json()) as { channelId: string };
    const members = await redis.smembers(
      `gateway:device-channels:${deviceId}`
    );
    expect(members).toContain(channelId);
  });

  it("creates idempotency lookup key", async ({ skip }) => {
    if (!redisAvailable) skip();
    if (!redis) skip();

    const deviceId = randomUUID();
    const label = "lookup-check";

    const res = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, type: "github", label }),
    });

    const { channelId } = (await res.json()) as { channelId: string };
    const lookupKey = `gateway:channel-by:${deviceId}:github:${label}`;
    const storedId = await redis.get(lookupKey);
    expect(storedId).toBe(channelId);
  });
});
