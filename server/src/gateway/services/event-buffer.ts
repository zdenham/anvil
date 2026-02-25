import { z } from "zod";
import type { Redis } from "ioredis";
import type { GatewayEvent } from "../types/events.js";

const STREAM_MAX_LEN = 500;
const PayloadSchema = z.record(z.unknown());

function streamKey(deviceId: string): string {
  return `gateway:events:${deviceId}`;
}

interface StreamEntry {
  /** Redis stream ID (e.g. "1708300000000-0") */
  streamId: string;
  event: GatewayEvent;
}

/**
 * Serializes a GatewayEvent into flat field pairs for XADD.
 * Payload is stored as a JSON string; all other fields are primitives.
 */
function serializeEvent(event: GatewayEvent): string[] {
  return [
    "id",
    event.id,
    "type",
    event.type,
    "channelId",
    event.channelId,
    "payload",
    JSON.stringify(event.payload),
    "receivedAt",
    String(event.receivedAt),
  ];
}

/**
 * Reconstructs a GatewayEvent from Redis stream field pairs.
 */
function deserializeEvent(fields: string[]): GatewayEvent {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 2) {
    map.set(fields[i], fields[i + 1]);
  }

  return {
    id: map.get("id")!,
    type: map.get("type")!,
    channelId: map.get("channelId")!,
    payload: PayloadSchema.parse(JSON.parse(map.get("payload")!)),
    receivedAt: Number(map.get("receivedAt")!),
  };
}

/**
 * XADD a GatewayEvent to the device's stream and cap at ~500 entries.
 */
export async function addEvent(
  redis: Redis,
  deviceId: string,
  event: GatewayEvent
): Promise<string> {
  const key = streamKey(deviceId);
  const fields = serializeEvent(event);

  const streamId = await redis.xadd(key, "*", ...fields);
  if (!streamId) {
    throw new Error("XADD returned null — unexpected Redis response");
  }
  await redis.xtrim(key, "MAXLEN", "~", STREAM_MAX_LEN);
  return streamId;
}

/**
 * XRANGE to read events from a stream. Used for replay on SSE connect.
 * Uses exclusive range syntax: pass `fromId` to get events strictly after it.
 * Pass "0" to read from the beginning.
 */
export async function readEvents(
  redis: Redis,
  deviceId: string,
  fromId: string
): Promise<StreamEntry[]> {
  const key = streamKey(deviceId);
  // Use exclusive range: "(" prefix skips the given ID itself
  const rangeStart = fromId === "0" ? "0" : `(${fromId}`;
  const results = await redis.xrange(key, rangeStart, "+");

  return results.map(([streamId, fields]) => ({
    streamId,
    event: deserializeEvent(fields),
  }));
}

/**
 * XREAD BLOCK to wait for new events on the device's stream.
 * Returns null if the block times out with no new events.
 */
export async function blockRead(
  redis: Redis,
  deviceId: string,
  lastId: string,
  timeoutMs: number
): Promise<StreamEntry[] | null> {
  const key = streamKey(deviceId);
  const results = await redis.xread(
    "COUNT",
    100,
    "BLOCK",
    timeoutMs,
    "STREAMS",
    key,
    lastId
  );

  if (!results) {
    return null;
  }

  // xread returns [[streamKey, [[id, fields], ...]]]
  const [, entries] = results[0];
  return entries.map(([streamId, fields]) => ({
    streamId,
    event: deserializeEvent(fields),
  }));
}

/**
 * XTRIM MINID to purge events older than the given stream ID.
 * Used as an implicit ACK when a client reconnects with Last-Event-ID.
 */
export async function trimBefore(
  redis: Redis,
  deviceId: string,
  minId: string
): Promise<void> {
  const key = streamKey(deviceId);
  await redis.xtrim(key, "MINID", minId);
}
