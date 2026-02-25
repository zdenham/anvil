# B: Gateway Routes & Redis Service Layer

Parent: [readme.md](./readme.md) | Design: [../buffered-event-gateway.md](../buffered-event-gateway.md) (Phases 1–3)

**Depends on:** [server-scaffolding.md](./server-scaffolding.md) (needs plugin skeleton, Redis client, directory structure)

Implements all three gateway endpoints and the Redis event buffer service. This is the core server-side business logic.

## Phases

- [x] Implement Zod schemas for Channel and GatewayEvent
- [x] Implement event buffer service (XADD, XREAD, XRANGE, XTRIM wrappers)
- [x] Implement POST /gateway/channels (channel registration)
- [x] Implement POST /gateway/channels/:channelId/events (webhook ingestion)
- [x] Implement GET /gateway/devices/:deviceId/events (SSE delivery + replay)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Zod Schemas

**`server/src/gateway/types/channel.ts`**:

```typescript
import { z } from "zod";

export const ChannelSchema = z.object({
  channelId: z.string().uuid(),
  deviceId: z.string().uuid(),
  type: z.literal("github"),
  label: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelBodySchema = z.object({
  deviceId: z.string().uuid(),
  type: z.literal("github"),
  label: z.string().min(1),
});
```

**`server/src/gateway/types/events.ts`**:

```typescript
import { z } from "zod";

export const GatewayEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  channelId: z.string(),
  payload: z.record(z.unknown()),
  receivedAt: z.number(),
});

export type GatewayEvent = z.infer<typeof GatewayEventSchema>;
```

---

## Phase 2: Event Buffer Service

**`server/src/gateway/services/event-buffer.ts`**

Wraps Redis Stream commands. All operations use the `gateway:` key prefix (Decision #8).

Key functions:

- **`addEvent(redis, deviceId, event)`** — `XADD gateway:events:{deviceId} * ...` + `XTRIM MAXLEN ~ 500`
- **`readEvents(redis, deviceId, fromId)`** — `XRANGE gateway:events:{deviceId} (fromId +` for replay
- **`blockRead(redis, deviceId, lastId, timeoutMs)`** — `XREAD BLOCK {timeoutMs} STREAMS gateway:events:{deviceId} {lastId}` for live phase
- **`trimBefore(redis, deviceId, minId)`** — `XTRIM gateway:events:{deviceId} MINID {minId}` for ACK-on-reconnect

Redis Stream entries store the `GatewayEvent` as individual fields (not a single JSON blob) so Redis can index by stream ID natively. The event buffer service handles serialization/deserialization:

```typescript
// XADD stores: { id, type, channelId, payload (JSON string), receivedAt }
// Reconstruct GatewayEvent on read by parsing payload back to object
```

---

## Phase 3: POST /gateway/channels

**`server/src/gateway/routes/channels.ts`**

Registration flow:
1. Validate body with `CreateChannelBodySchema`
2. Check idempotency key: `GET gateway:channel-by:{deviceId}:{type}:{label}`
3. If exists → fetch channel from `gateway:channel:{channelId}` and return it
4. If new → generate `channelId` (UUID), create `Channel` object
5. Redis pipeline (atomic):
   - `SET gateway:channel:{channelId}` → Channel JSON
   - `SADD gateway:device-channels:{deviceId}` → channelId
   - `SET gateway:channel-by:{deviceId}:{type}:{label}` → channelId
6. Return `201` with `{ channelId, webhookUrl }`

The `webhookUrl` is constructed from the request's host: `${protocol}://${host}/gateway/channels/${channelId}/events`.

---

## Phase 4: POST /gateway/channels/:channelId/events

**`server/src/gateway/routes/channel-events.ts`**

Webhook ingestion flow:
1. `GET gateway:channel:{channelId}` — look up channel
2. Return `404` if not found
3. Read `X-GitHub-Event` header (default to `"unknown"` if missing)
4. Construct `GatewayEvent`:
   - `id`: `crypto.randomUUID()`
   - `type`: `${channel.type}.${x_github_event}` (e.g. `github.issue_comment`)
   - `channelId`: from URL param
   - `payload`: request body (opaque)
   - `receivedAt`: `Date.now()`
5. Call `addEvent(redis, channel.deviceId, event)` (XADD + XTRIM)
6. Return `201 Created`

No webhook signature verification (Decision #12). The `channelId` UUID is unguessable.

---

## Phase 5: GET /gateway/devices/:deviceId/events (SSE)

**`server/src/gateway/routes/device-events.ts`**

The most complex route — implements the SSE connection lifecycle from parent plan Phase 3.

Connection lifecycle:
1. Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
2. Read `Last-Event-ID` from request headers
3. **ACK trim**: If `Last-Event-ID` present, call `trimBefore(redis, deviceId, lastEventId)`
4. **Replay phase**: `readEvents(redis, deviceId, lastEventId || "0")` — send all buffered events as SSE frames
5. **Live phase**: Loop with `blockRead(redis, deviceId, lastSeenId, 5000)` — send new events as they arrive
6. **Heartbeat**: Send `:heartbeat\n\n` every 15s (use a `setInterval` cleared on close)
7. Handle client disconnect (listen on `request.raw` close event)

SSE frame format per event:
```
id: {redis-stream-id}
event: {event.type}
data: {JSON.stringify(event)}

```

Fastify raw response handling — use `reply.raw` to write SSE frames directly, bypassing Fastify's default response serialization. Set `reply.hijack()` or use `reply.raw.write()` to stream.

Important: `XREAD BLOCK` ties up the Redis connection for the block duration. Use the existing Redis client from the service module. Since `XREAD BLOCK` is a blocking command, each SSE connection should use its own Redis connection (duplicate from the main client) to avoid blocking other operations.

```typescript
// Create a dedicated connection for this SSE stream
const blockingRedis = redis.duplicate();
// ... use for XREAD BLOCK loop
// Clean up on disconnect
request.raw.on("close", () => { blockingRedis.disconnect(); });
```

---

## Completion Criteria

- All three routes registered in the gateway plugin and responding correctly
- Channel registration is idempotent (same `deviceId + type + label` returns same channel)
- Webhooks produce events in the correct Redis stream
- SSE endpoint replays buffered events, streams live events, sends heartbeats
- SSE respects `Last-Event-ID` for replay and trim
- Zod validation on all request bodies
- Redis keys follow the `gateway:` prefix convention
