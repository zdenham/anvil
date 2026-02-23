import { buildApp } from "../../app.js";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";

const REDIS_URL = "redis://localhost:6379";

let app: FastifyInstance;
let redis: Redis;

interface TestContext {
  baseUrl: string;
  /** null when running against remote — no direct Redis access */
  redis: Redis | null;
  mode: "local" | "remote";
}

/**
 * Spins up a gateway-only Fastify server on a random port with a real Redis
 * connection. Returns the app, a separate Redis client for test assertions,
 * and the base URL.
 *
 * When GATEWAY_BASE_URL is set, skips local server startup entirely and
 * returns a context pointing at the remote deployment (redis will be null).
 *
 * Throws if Redis is not available -- callers should catch and skip.
 */
export async function startTestServer(): Promise<TestContext> {
  const remoteUrl = process.env.GATEWAY_BASE_URL;

  if (remoteUrl) {
    return { baseUrl: remoteUrl, redis: null, mode: "remote" };
  }

  redis = new Redis(REDIS_URL);
  try {
    await redis.ping();
  } catch {
    await redis.quit();
    throw new Error("Redis not available at localhost:6379");
  }

  app = await buildApp({ redisUrl: REDIS_URL, gatewayOnly: true });
  await app.listen({ port: 0 });

  const address = app.server.address();
  const port = typeof address === "object" ? address!.port : 0;

  return { baseUrl: `http://localhost:${port}`, redis, mode: "local" };
}

/**
 * Tears down the Fastify server and Redis test client.
 *
 * No-op when running against a remote deployment.
 *
 * Does NOT flush gateway:* keys globally — test files run in parallel
 * and would clobber each other's state. Each test uses unique deviceIds
 * (crypto.randomUUID) for isolation. Keys are ephemeral and will be
 * overwritten on next test run.
 */
export async function stopTestServer(): Promise<void> {
  await app?.close();
  if (redis) {
    await redis.quit();
  }
}
