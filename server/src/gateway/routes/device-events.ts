import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import {
  readEvents,
  blockRead,
  trimBefore,
} from "../services/event-buffer.js";
import type { GatewayEvent } from "../types/events.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const BLOCK_TIMEOUT_MS = 5_000;

interface DeviceEventsParams {
  deviceId: string;
}

interface StreamEntry {
  streamId: string;
  event: GatewayEvent;
}

function formatSseFrame(streamId: string, event: GatewayEvent): string {
  return `id: ${streamId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatHeartbeat(): string {
  return `:heartbeat\n\n`;
}

function writeSseHeaders(reply: { raw: import("http").ServerResponse }): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function sendEntries(
  raw: import("http").ServerResponse,
  entries: StreamEntry[]
): string {
  let lastId = "";
  for (const entry of entries) {
    raw.write(formatSseFrame(entry.streamId, entry.event));
    lastId = entry.streamId;
  }
  return lastId;
}

async function replayBuffered(
  redis: Redis,
  raw: import("http").ServerResponse,
  deviceId: string,
  lastEventId: string | undefined
): Promise<string> {
  const fromId = lastEventId ?? "0";
  const entries = await readEvents(redis, deviceId, fromId);

  if (entries.length === 0) {
    return lastEventId ?? "$";
  }

  return sendEntries(raw, entries);
}

async function runLiveLoop(
  blockingRedis: Redis,
  raw: import("http").ServerResponse,
  deviceId: string,
  startId: string,
  signal: AbortSignal
): Promise<void> {
  let lastSeenId = startId;

  while (!signal.aborted) {
    const entries = await blockRead(
      blockingRedis,
      deviceId,
      lastSeenId,
      BLOCK_TIMEOUT_MS
    );

    if (signal.aborted) {
      return;
    }

    if (!entries) {
      continue;
    }

    const newLastId = sendEntries(raw, entries);
    if (newLastId) {
      lastSeenId = newLastId;
    }
  }
}

export function registerDeviceEventsRoute(
  fastify: FastifyInstance,
  redis: Redis
): void {
  fastify.get<{ Params: DeviceEventsParams }>(
    "/devices/:deviceId/events",
    async (request, reply) => {
      const { deviceId } = request.params;
      const rawLastEventId = request.headers["last-event-id"];
      const lastEventId =
        typeof rawLastEventId === "string" ? rawLastEventId : undefined;

      // ACK trim: purge events older than the acknowledged ID
      if (lastEventId) {
        await trimBefore(redis, deviceId, lastEventId);
      }

      // Hijack the response to stream SSE frames directly
      reply.hijack();
      writeSseHeaders(reply);

      // Replay buffered events
      const lastReplayedId = await replayBuffered(
        redis,
        reply.raw,
        deviceId,
        lastEventId
      );

      // Set up heartbeat interval
      const heartbeatTimer = setInterval(() => {
        if (!reply.raw.destroyed) {
          reply.raw.write(formatHeartbeat());
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Create a dedicated Redis connection for blocking reads
      const blockingRedis = redis.duplicate();
      const abortController = new AbortController();

      // Clean up on client disconnect
      request.raw.on("close", () => {
        abortController.abort();
        clearInterval(heartbeatTimer);
        blockingRedis.disconnect();
      });

      // Enter the live event loop (runs until client disconnects)
      try {
        await runLiveLoop(
          blockingRedis,
          reply.raw,
          deviceId,
          lastReplayedId,
          abortController.signal
        );
      } catch {
        // Connection closed or Redis error — clean up silently
      } finally {
        clearInterval(heartbeatTimer);
        abortController.abort();
        blockingRedis.disconnect();
        if (!reply.raw.destroyed) {
          reply.raw.end();
        }
      }
    }
  );
}
