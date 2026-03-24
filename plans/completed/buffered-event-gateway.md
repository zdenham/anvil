# Buffered Event Gateway

Extends the existing `anvil-server` Fastify service with gateway routes that accept webhooks, buffer events in Redis, and stream them to clients via SSE. The gateway is logically separated into its own route namespace and directory within the server.

## Problem

Anvil agents run locally on developer machines. External events (PR comments, webhook triggers) happen while machines may be asleep, offline, or otherwise unavailable. We need a persistent intermediary that:

1. Receives webhooks (GitHub as first source, extensible to others)
2. Buffers them reliably when the target device is offline
3. Delivers them in-order when the device connects
4. Routes events by `deviceId` — the stable machine identifier

## Architecture Overview

```
GitHub (or other source)
        │
        ▼
┌──────────────────────────┐
│   anvil-server (Fastify)   │  ← Fly.io (anvil-server.fly.dev)
│                           │
│  Existing:                │
│    POST /logs             │
│    POST /identity         │
│    GET  /health           │
│                           │
│  Gateway (new):           │
│    POST /gateway/channels │  ← register a channel
│    POST /gateway/channels/:channelId/events  ← webhook receiver
│    GET  /gateway/devices/:deviceId/events    ← SSE stream
│                           │
│  Redis (self-hosted)      │  ← event buffer (Fly app + volume)
└──────────────────────────┘
        │ SSE
        ▼
┌──────────────────────────┐
│   Client (pure TS)        │
│   (fetch-based streaming) │
│                           │
│   Works in browser & Node │
└──────────────────────────┘
```

## Phases

- [x] Design channel registration and device routing
- [x] Design webhook ingestion and Redis buffering
- [x] Design SSE delivery and replay protocol
- [x] Design pure TypeScript SSE client
- [x] Define server directory structure and deployment changes
- [x] Design functional test suite (real server + real Redis, no mocks)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

## Implementation Sub-Plans

Design is complete. Implementation is decomposed into four parallel workstreams in [buffered-event-gateway/](./buffered-event-gateway/readme.md):

| # | Plan | Scope | Depends on |
|---|------|-------|------------|
| A | [server-scaffolding](./buffered-event-gateway/server-scaffolding.md) | Redis Fly app, `buildApp()` refactor, plugin skeleton, Vitest | None |
| B | [gateway-routes](./buffered-event-gateway/gateway-routes.md) | All 3 routes + Redis event buffer service | A |
| C | [sse-client](./buffered-event-gateway/sse-client.md) | Pure TS fetch-based SSE client in `core/gateway/` | None |
| D | [test-suite](./buffered-event-gateway/test-suite.md) | Functional tests (real server + real Redis) | A + B |

**A** and **C** start in parallel. **B** follows **A**. **D** follows **B**.

## Decisions

1. **Self-hosted Redis on Fly.io with volume-backed persistence.** Redis runs as a separate Fly app with a persistent volume and AOF enabled. Data survives restarts and redeployments. The `MAXLEN ~ 500` cap on ingestion is the only cleanup mechanism needed.
2. **No shared secret. Auth is keyed by deviceId.** Client-facing endpoints are authenticated by the `deviceId` itself — a device can only register channels for and subscribe to its own stream. No Bearer token for v1.
3. **Single consumer per device. Purge on connect is safe.** Only one SSE consumer per device stream. `XTRIM MINID` on reconnect is safe and keeps streams bounded.
4. **Channel registration is idempotent.** Upsert by `deviceId + type + label` via a dedicated Redis lookup key. If a channel with the same combination already exists, return the existing channel rather than creating a duplicate.
5. **PR comment handler is out of scope.** This plan covers gateway infrastructure only. The PR comment handler is retained in the plan only as a motivating example for design decisions, not as implementation work.
6. **DeviceId UUID is sufficient auth for v1.** UUIDs are unguessable — no additional per-device token needed.
7. **Self-hosted Redis on Fly.io (not Upstash).** Separate Fly app with volume + AOF. `ioredis` as client (supports native `XREAD BLOCK` needed for SSE long-polling).
8. **Redis keys use `gateway:` prefix.** All keys namespaced under `gateway:` (e.g. `gateway:channel:{channelId}`, `gateway:events:{deviceId}`, `gateway:device-channels:{deviceId}`) for clean separation if the Redis instance is shared later.
9. **Channel state lives in Redis only.** Channels are cheap to re-register. Redis with AOF on a persistent volume is durable enough — no need to duplicate to ClickHouse.
10. **Redis Fly app lives at repo root (`redis/`).** Two independently deployable Fly apps in the same repo: `server/` and `redis/`.
11. **Redis connection resilience is not a concern for v1.** If Redis restarts mid-`XREAD BLOCK`, the SSE connection drops and the client's auto-reconnect handles recovery. No special server-side retry logic needed.
12. **No webhook secret verification for v1.** Webhook verification (e.g. GitHub HMAC) is deferred. Channels may gain a `properties` field in the future for per-channel configuration like secrets. For now the `channelId` UUID in the webhook URL is sufficient — it's unguessable and routes correctly.
13. **RESTful resource-oriented endpoints.** No verbs in URLs. Webhooks post events to a channel (`POST /gateway/channels/:channelId/events`), clients read events from a device (`GET /gateway/devices/:deviceId/events`).
14. **Fetch-based SSE client, no EventSource.** The client uses `fetch` with streaming response body parsing. This works identically in browser and Node.js (modern Node supports `fetch` natively), avoids the `EventSource` limitation of not supporting custom headers on initial connect, and gives us full control over `Last-Event-ID` and reconnect behavior.
15. **Keep `GatewayEvent.id` (UUID).** The Redis stream ID is used for checkpointing/replay. The UUID `id` provides a stable, transport-independent event identifier for consumers.
16. **Idempotency lookup key for channel registration.** A dedicated Redis key `gateway:channel-by:{deviceId}:{type}:{label}` maps to `channelId` for O(1) upsert lookups, avoiding a scan of the device's channel set.

---

## Phase 1: Channel Registration & Device Routing

### Identity — Already Done

Device identity is handled by the existing `identities` table in ClickHouse and `~/.anvil/settings/identity.json` locally. See [identity-table.md](./identity-table.md) for the full design.

Key facts:
- `device_id` is a stable UUID v4 generated on first launch, persisted in `~/.anvil/settings/app-config.json`
- `identity.json` maps `device_id` → `github_handle`
- The ClickHouse `identities` table stores this mapping server-side
- The `POST /identity` endpoint already exists

### Routing Key: `deviceId`

Events are keyed and streamed by `deviceId`, not by GitHub handle. A single device may subscribe to multiple event sources (GitHub webhooks, CI triggers, etc.) via **channels**.

### Channel Model

A channel is a registered event source bound to a specific device. When a webhook hits the gateway, the URL contains the `channelId`, and the gateway looks up which `deviceId` to route to.

```typescript
interface Channel {
  /** Unique channel ID (UUID) — used in webhook URLs */
  channelId: string;
  /** The device that owns this channel */
  deviceId: string;
  /** Channel type — determines future verification logic */
  type: "github";
  /** Human label (e.g. "zac's github webhooks") */
  label: string;
  /** ISO timestamp */
  createdAt: string;
}
```

No `webhookSecret` at the channel root level. Verification-related configuration (e.g. GitHub HMAC secrets) will live in an optional `properties` field when added in the future.

### Registration Endpoint

```
POST /gateway/channels
Body:
  {
    "deviceId": "550e8400-...",
    "type": "github",
    "label": "zac's github webhooks"
  }
Response:
  {
    "channelId": "a1b2c3d4-...",
    "webhookUrl": "https://anvil-server.fly.dev/gateway/channels/a1b2c3d4-.../events"
  }
```

The server generates a `channelId` (UUID). The user configures their GitHub repo webhook with the returned URL.

**Idempotency**: Registration upserts by `deviceId + type + label`. A dedicated Redis lookup key (`gateway:channel-by:{deviceId}:{type}:{label}` → `channelId`) provides O(1) duplicate detection. If a channel with the same combination already exists, the existing channel is returned rather than creating a duplicate.

### Why Channels Instead of Routing by GitHub Handle

- **Multiple sources**: A device might receive events from GitHub, Slack, CI, etc. Each source gets its own channel.
- **`deviceId` as the stream key**: The SSE connection streams `events:{deviceId}` — all events from all channels for that device arrive on one stream.
- **Clean deregistration**: Deleting a channel (future) invalidates just that webhook URL.

### Redis Storage for Channels

```
gateway:channel:{channelId}                     → Channel JSON (string)
gateway:device-channels:{deviceId}              → set of channelIds
gateway:channel-by:{deviceId}:{type}:{label}    → channelId (idempotency lookup)
```

Lookups:
- Webhook arrives at `POST /gateway/channels/:channelId/events` → read `gateway:channel:{channelId}` → get `deviceId` → push to `gateway:events:{deviceId}`
- SSE connects at `GET /gateway/devices/:deviceId/events` → read from `gateway:events:{deviceId}` stream
- Channel registration checks `gateway:channel-by:{deviceId}:{type}:{label}` for existing channel before creating

### Authentication

For v1, client-facing endpoints (`POST /gateway/channels`, `GET /gateway/devices/:deviceId/events`) are keyed by `deviceId` — a device can only register channels for itself and subscribe to its own event stream. No shared secret or Bearer token. Webhook endpoints (`POST /gateway/channels/:channelId/events`) are open — the `channelId` UUID is unguessable and sufficient for v1.

---

## Phase 2: Webhook Ingestion & Redis Buffering

### Ingestion Endpoint

```
POST /gateway/channels/:channelId/events
Headers:
  X-GitHub-Event: pull_request_review_comment
  Content-Type: application/json
```

The `:channelId` in the URL identifies which channel (and therefore which device) this event targets. When configuring a GitHub webhook, you use the URL returned by `POST /gateway/channels`.

### Ingestion Flow

1. Look up `gateway:channel:{channelId}` from Redis
2. Return `404` if channel doesn't exist
3. Construct a `GatewayEvent` from the webhook payload
4. `XADD gateway:events:{deviceId} * ...` — push to the device's event stream
5. `XTRIM gateway:events:{deviceId} MAXLEN ~ 500` — cap buffer at ~500 events
6. Return `201 Created`

No webhook signature verification for v1. The `channelId` UUID in the URL is unguessable and provides sufficient routing security.

### Event Schema

```typescript
interface GatewayEvent {
  /** Unique event ID (UUID) */
  id: string;
  /** Channel type prefix + GitHub event name (e.g. "github.issue_comment") */
  type: string;
  /** The channelId that produced this event */
  channelId: string;
  /** Original webhook payload — opaque to the gateway */
  payload: Record<string, unknown>;
  /** Server timestamp (ms since epoch) */
  receivedAt: number;
}
```

The `type` field is constructed from the channel type and the `X-GitHub-Event` header: `github.${x_github_event}`. This allows the client to dispatch events without parsing the payload.

### Redis Storage Strategy

We use **Redis Streams** (`XADD` / `XREAD`) — purpose-built for this pattern:

- **Stream key**: `gateway:events:{deviceId}` — one stream per device
- **On webhook receipt**: `XADD gateway:events:{deviceId} * type github.issue_comment payload <json> ...`
- **On SSE connect**: `XREAD BLOCK 0 STREAMS gateway:events:{deviceId} <last-seen-id>`
- **Cleanup**: `XTRIM gateway:events:{deviceId} MAXLEN ~ 500` on ingestion

### Why Redis Streams over Lists

| Feature | Lists (LPUSH/BRPOP) | Streams (XADD/XREAD) |
|---------|---------------------|----------------------|
| Ordered replay from offset | Manual (store index) | Built-in (stream IDs) |
| Multiple consumers | Requires pub/sub layer | Native consumer groups |
| Persistence after read | Popped = gone | Retained until trimmed |
| Backpressure | None | BLOCK + COUNT |

Streams give us replay-from-offset for free, which is critical for the "catch up on missed events" use case.

---

## Phase 3: SSE Delivery & Replay Protocol

### SSE Endpoint

```
GET /gateway/devices/:deviceId/events
Headers:
  Last-Event-ID: <redis-stream-id>  (optional, for replay)
```

### Connection Lifecycle

1. **Client connects** with `deviceId` and optional `Last-Event-ID`
2. **ACK via trim**: If `Last-Event-ID` is provided, treat it as an implicit acknowledgment — the client is confirming it has persisted everything up to and including that ID. `XTRIM gateway:events:{deviceId} MINID <last-event-id>` purges all entries older than the acknowledged ID. The entry at `Last-Event-ID` itself is retained (MINID trims entries with IDs strictly less than the given value).
3. **Replay phase**: `XRANGE gateway:events:{deviceId} <last-event-id> +` to read all events from `Last-Event-ID` onward (use the exclusive range syntax `(last-event-id` to skip the already-seen event). If no `Last-Event-ID`, read from `0` to replay the entire stream.
4. **Live phase**: `XREAD BLOCK 5000 STREAMS gateway:events:{deviceId} <last-seen-id>` for new events, send as SSE. `<last-seen-id>` is the ID of the last event sent in the replay phase (or `$` if there were no buffered events).
5. **Heartbeat**: Send `:heartbeat\n\n` every 15s to keep the connection alive
6. **Disconnect**: Connection closes, no state to clean up (stream persists in Redis)

### `Last-Event-ID` as Implicit ACK

SSE is one-directional — the server pushes, the client cannot send data back over the same connection. But the SSE spec provides a built-in acknowledgment mechanism: when a client reconnects, it sends `Last-Event-ID` in the request headers. This tells the server the last event the client successfully received.

We use this as a **stream-level ACK**. Because there is only one consumer per device stream (Decision #3), there's no risk of trimming events that another consumer still needs. The `Last-Event-ID` on reconnect means:

- **"I have everything up to here"** — safe to trim entries before this ID
- **"Replay from here"** — send everything after this ID

This eliminates the need for a separate ACK endpoint or mechanism. The stream stays bounded from both ends: `MAXLEN ~ 500` caps the head on ingestion, `XTRIM MINID` trims the tail on reconnect.

No explicit `XACK` / consumer groups are needed — those exist for multi-consumer scenarios where each consumer tracks its own position independently. With single-consumer-per-stream, `Last-Event-ID` + `XTRIM MINID` is simpler and achieves the same result.

### SSE Message Format

```
id: 1708300000000-0
event: github.issue_comment
data: {"id":"abc-123","type":"github.issue_comment","channelId":"a1b2c3d4","payload":{...},"receivedAt":1708300000000}

```

The `id` field uses the Redis stream ID, which the client sends back as `Last-Event-ID` on reconnect — giving us at-least-once delivery with client-side dedup via the event `id` (UUID).

### No Device State in Redis

We don't track `online`/`offline` state in Redis. The stream just accumulates events. When a client connects, it replays and catches up. When it disconnects, events keep buffering. This simplifies the server — no state machine to manage.

---

## Phase 4: Pure TypeScript SSE Client

### Design Goal: Platform-Agnostic, Fetch-Based

The client must work in both **browser** (Tauri webview) and **Node.js** (agent processes). It uses `fetch` with streaming response body parsing — no `EventSource` dependency. This means:

- No browser-only APIs (`localStorage`, `window`) in the core
- No Node-only APIs (`fs`, `process`) in the core
- No `EventSource` polyfill needed — `fetch` with `ReadableStream` works in both environments
- Persistence and event dispatch are injected via constructor options
- Full control over `Last-Event-ID` header on every connect (not just reconnects)

### Client Architecture

```typescript
interface GatewayClientOptions {
  /** Gateway base URL (e.g. "https://anvil-server.fly.dev") */
  baseUrl: string;
  /** Device ID for SSE stream */
  deviceId: string;
  /** Load the last acknowledged stream ID (platform-specific) */
  loadLastEventId: () => Promise<string | null>;
  /** Persist the last acknowledged stream ID */
  saveLastEventId: (id: string) => Promise<void>;
  /** Called for each incoming event */
  onEvent: (event: GatewayEvent) => void;
  /** Called on connection state changes */
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
}

class GatewayClient {
  constructor(options: GatewayClientOptions);

  /** Open the SSE connection. Replays missed events, then streams live. */
  connect(): Promise<void>;

  /** Close the connection cleanly. */
  disconnect(): void;
}
```

### SSE Implementation (Fetch-Based)

The client uses `fetch` to open a streaming connection to `GET /gateway/devices/:deviceId/events`, passing `Last-Event-ID` as a request header. It reads the response body as a `ReadableStream`, parsing SSE frames incrementally.

```typescript
async connect(): Promise<void> {
  const lastEventId = await this.options.loadLastEventId();
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;

  const url = `${this.options.baseUrl}/gateway/devices/${this.options.deviceId}/events`;
  const res = await fetch(url, { headers, signal: this.abortController.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE frames separated by double newlines
    const frames = buffer.split("\n\n");
    buffer = frames.pop()!;

    for (const frame of frames) {
      if (frame.startsWith(":")) continue; // heartbeat
      const event = this.parseSSEFrame(frame);
      if (event) {
        this.options.onEvent(event);
        await this.options.saveLastEventId(event.streamId);
      }
    }
  }
}
```

**Reconnect logic**: The client implements its own reconnect with exponential backoff. On disconnect, it waits (1s, 2s, 4s, ... capped at 30s), then calls `connect()` again. The `loadLastEventId` call on each connect ensures `Last-Event-ID` is always current.

### Platform Adapters

**Browser (Tauri webview)**:
```typescript
const client = new GatewayClient({
  baseUrl: "https://anvil-server.fly.dev",
  deviceId,

  loadLastEventId: () => Promise.resolve(localStorage.getItem("gateway:lastEventId")),
  saveLastEventId: (id) => { localStorage.setItem("gateway:lastEventId", id); return Promise.resolve(); },
  onEvent: (event) => eventBus.emit(event.type, event),
});
```

**Node.js (agent process)**:
```typescript
import { readFile, writeFile } from "fs/promises";
import { join, homedir } from "path";

const checkpointPath = join(homedir(), ".anvil", "gateway-checkpoint.json");

const client = new GatewayClient({
  baseUrl: "https://anvil-server.fly.dev",
  deviceId,

  loadLastEventId: async () => {
    try { return JSON.parse(await readFile(checkpointPath, "utf-8")).lastEventId; }
    catch { return null; }
  },
  saveLastEventId: async (id) => { await writeFile(checkpointPath, JSON.stringify({ lastEventId: id })); },
  onEvent: (event) => handleEvent(event),
});
```

### Event Dispatch

The `onEvent` callback receives typed `GatewayEvent` objects. Consumers register handlers for specific event types:

```typescript
interface EventHandler {
  /** Returns true if this handler should process the event */
  matches(event: GatewayEvent): boolean;
  /** Execute the local action */
  handle(event: GatewayEvent): Promise<void>;
}
```

This is consumer-side code, not part of the core client library. The Tauri app and Node agents each define their own handlers.

---

## Motivating Example: PR Comment Webhook Handler (Out of Scope)

> This section is retained as a motivating example for gateway design decisions. It is **not** part of the implementation scope for this plan.

The first concrete event handler would be a consumer of the gateway client that interprets GitHub `issue_comment` events and spawns local agents. A `github.issue_comment` or `github.pull_request_review_comment` event where the comment matches a trigger pattern (e.g. `@anvil` or `/anvil run`) would check out the PR branch in a worktree, spawn an agent, and report back via GitHub API. This use case drives design decisions around event typing (`github.${event_name}`), the `EventHandler` interface, and keeping the gateway payload-agnostic.

---

## Phase 6: Server Directory Structure & Deployment

### Directory Layout

The gateway routes and services live in a `gateway/` subdirectory within the existing server, logically separated but sharing the same Fastify instance and deployment:

```
server/
├── src/
│   ├── index.ts              # Fastify entry — registers both log routes and gateway plugin
│   ├── migrate.ts            # Existing migration runner
│   ├── types/
│   │   ├── logs.ts           # Existing log schemas
│   │   └── identity.ts       # Existing identity schema
│   ├── gateway/
│   │   ├── index.ts          # Fastify plugin — registers all gateway routes
│   │   ├── routes/
│   │   │   ├── channels.ts   # POST /gateway/channels
│   │   │   ├── channel-events.ts  # POST /gateway/channels/:channelId/events
│   │   │   └── device-events.ts   # GET /gateway/devices/:deviceId/events (SSE)
│   │   ├── services/
│   │   │   ├── redis.ts      # Redis client singleton + connection
│   │   │   └── event-buffer.ts  # XADD, XREAD, XTRIM wrappers
│   │   └── types/
│   │       ├── channel.ts    # Channel schema (Zod)
│   │       └── events.ts     # GatewayEvent schema (Zod)
│   └── ... existing files
├── package.json              # Add ioredis dependency
├── Dockerfile                # Unchanged (same build)
├── fly.toml                  # Update: min_machines_running: 1
└── tsconfig.json             # Unchanged (already includes src/**)

redis/                        # Separate Fly app for Redis
├── Dockerfile                # Official redis image + AOF config
└── fly.toml                  # Fly app config with volume mount
```

### Gateway as Fastify Plugin

The gateway registers as a Fastify plugin with the `/gateway` prefix. This gives clean separation — all gateway routes are namespaced, and the plugin can be tested independently:

```typescript
// server/src/gateway/index.ts
import { FastifyPluginAsync } from "fastify";

const gatewayPlugin: FastifyPluginAsync = async (fastify) => {
  // Register routes within the /gateway prefix
  fastify.post("/channels", channelsHandler);
  fastify.post("/channels/:channelId/events", channelEventsHandler);
  fastify.get("/devices/:deviceId/events", deviceEventsHandler);
};

// server/src/index.ts
fastify.register(gatewayPlugin, { prefix: "/gateway" });
```

### New Dependencies

```json
{
  "dependencies": {
    "ioredis": "^5.0.0"
  }
}
```

Only `ioredis` is added. The rest (`fastify`, `zod`) already exist.

### Client Package Location

The pure TypeScript client lives in a `core/gateway/` directory:

```
core/
├── types/
│   ├── gateway-events.ts     # GatewayEvent, Channel schemas (Zod)
│   └── ... existing types
├── gateway/
│   ├── client.ts             # GatewayClient class
│   └── types.ts              # Re-exports from core/types if needed
```

This keeps the client importable by both `src/` (Tauri frontend) and Node agent code.

### Deployment Changes

The existing `anvil-server` Fly.io app gains gateway functionality. Changes to `fly.toml`:

```toml
# Must stay running for webhook reception
min_machines_running = 1
```

The logging server currently scales to 0 when idle. With the gateway, the server must be always-on to receive webhooks. This is the main operational change.

### Redis Deployment (Self-Hosted on Fly.io)

Redis runs as a **separate Fly app** (`anvil-redis`) in the same region (`sjc`), accessible to `anvil-server` over Fly's private network (`anvil-redis.internal:6379`). No public internet exposure.

**`redis/fly.toml`**:
```toml
app = 'anvil-redis'
primary_region = 'sjc'

[build]
  image = 'redis:7-alpine'

[mounts]
  source = 'redis_data'
  destination = '/data'

[env]
  # No public services — internal only

[[vm]]
  memory = '256mb'
  cpu_kind = 'shared'
  cpus = 1
```

**Setup commands**:
```bash
fly apps create anvil-redis
fly volumes create redis_data --region sjc --size 1 --app anvil-redis
fly deploy --app anvil-redis
```

**Persistence**: Redis is configured with `appendonly yes` (AOF). The `/data` directory is backed by a Fly volume, so data survives restarts and redeployments. Standard Redis persistence on a real disk.

**Networking**: Fly apps in the same org communicate over a private WireGuard mesh via `.internal` DNS. The server connects to `redis://anvil-redis.internal:6379` — no authentication needed since it's not publicly routable.

### New Environment Variables

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection string (`redis://anvil-redis.internal:6379`) |

No global secrets for client-facing auth — endpoints are keyed by `deviceId`. No webhook verification secrets for v1.

---

## Phase 7: Functional Test Suite (Real Server + Real Redis)

### Design Goal

End-to-end functional tests that exercise the full gateway stack — real Fastify server, real Redis, real HTTP requests, real SSE streams. No mocks. Tests verify the complete request path from channel registration through webhook ingestion to SSE delivery.

### Prerequisites

- Local Redis running on `localhost:6379` (standard dev setup)
- No ClickHouse required — the gateway plugin is independent of ClickHouse routes
- Tests use Vitest (consistent with the rest of the project)

### Server Testability: `buildApp()` Pattern

The current server calls `start()` at module level, which makes it impossible to import without side effects. The gateway tests need a way to spin up a Fastify instance programmatically.

Refactor the server entry point to export a `buildApp()` function:

```typescript
// server/src/app.ts
import Fastify from "fastify";
import { gatewayPlugin } from "./gateway/index.js";

export interface AppOptions {
  redisUrl: string;
  /** Skip ClickHouse routes (for gateway-only testing) */
  gatewayOnly?: boolean;
}

export async function buildApp(options: AppOptions) {
  const fastify = Fastify({ logger: false }); // quiet during tests
  await fastify.register(gatewayPlugin, {
    prefix: "/gateway",
    redisUrl: options.redisUrl,
  });
  return fastify;
}
```

```typescript
// server/src/index.ts (unchanged behavior, uses buildApp internally)
import { buildApp } from "./app.js";

const app = await buildApp({
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});
// ... register ClickHouse routes, call app.listen()
```

This gives tests a clean Fastify instance without starting a persistent server or needing ClickHouse.

### Test Directory Structure

```
server/
├── src/
│   ├── gateway/
│   │   └── __tests__/
│   │       ├── setup.ts            # Shared test harness (server + Redis lifecycle)
│   │       ├── channels.test.ts    # Channel registration tests
│   │       ├── channel-events.test.ts  # Webhook ingestion tests
│   │       └── device-events.test.ts   # SSE delivery + replay tests
```

### Test Harness (`setup.ts`)

A shared helper that manages the Fastify server and Redis lifecycle per test suite:

```typescript
import { buildApp } from "../../app.js";
import Redis from "ioredis";
import type { FastifyInstance } from "fastify";

const REDIS_URL = "redis://localhost:6379";
const TEST_PREFIX = "gateway:test:"; // avoid colliding with dev data

let app: FastifyInstance;
let redis: Redis;

export async function startTestServer() {
  redis = new Redis(REDIS_URL);
  app = await buildApp({ redisUrl: REDIS_URL, gatewayOnly: true });
  await app.listen({ port: 0 }); // random available port
  const address = app.server.address();
  const port = typeof address === "object" ? address!.port : 0;
  return { app, redis, baseUrl: `http://localhost:${port}` };
}

export async function stopTestServer() {
  await app.close();
  // Flush only gateway:test: keys to avoid nuking dev data
  const keys = await redis.keys(`${TEST_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}
```

Key design choices:
- **Port 0** — OS assigns a random available port, no conflicts
- **Scoped cleanup** — only deletes `gateway:test:*` keys, safe to run alongside a local dev Redis
- **`beforeAll` / `afterAll`** — server starts once per test file, not per test (faster)

### Test Suite 1: Channel Registration (`channels.test.ts`)

Tests the `POST /gateway/channels` endpoint.

```typescript
describe("POST /gateway/channels", () => {
  it("registers a new channel and returns channelId + webhookUrl");
  it("returns the same channel on duplicate registration (idempotent upsert)");
  it("rejects registration with missing required fields (400)");
  it("stores channel data in Redis with correct key structure");
  it("adds channelId to the device's channel set");
  it("creates the idempotency lookup key in Redis");
});
```

Each test makes real HTTP requests using `fetch` against the test server's base URL and then inspects Redis directly to verify state.

### Test Suite 2: Webhook Ingestion (`channel-events.test.ts`)

Tests the `POST /gateway/channels/:channelId/events` endpoint.

```typescript
describe("POST /gateway/channels/:channelId/events", () => {
  // Setup: register a channel first

  it("accepts a webhook and buffers the event");
  it("returns 404 for a non-existent channelId");
  it("constructs the correct event type from X-GitHub-Event header");
  it("stores the event in the device's Redis stream");
  it("caps the stream at ~500 events (MAXLEN)");
});
```

```typescript
// In test:
const body = JSON.stringify({ action: "created", comment: { body: "test" } });

const res = await fetch(`${baseUrl}/gateway/channels/${channel.channelId}/events`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "issue_comment",
  },
  body,
});
```

### Test Suite 3: SSE Delivery & Replay (`device-events.test.ts`)

Tests the `GET /gateway/devices/:deviceId/events` SSE endpoint. This is the most important suite — it verifies the full end-to-end flow.

```typescript
describe("GET /gateway/devices/:deviceId/events (SSE)", () => {
  it("streams a live event when a webhook is ingested while connected");
  it("replays buffered events on connect (no Last-Event-ID)");
  it("replays only events after Last-Event-ID on reconnect");
  it("purges events before Last-Event-ID on reconnect");
  it("sends heartbeat comments on idle connections");
  it("delivers events from multiple channels on the same device stream");
});
```

SSE consumption in tests uses a lightweight fetch-based reader:

```typescript
async function readSSEEvents(
  url: string,
  options?: { lastEventId?: string; maxEvents?: number; timeoutMs?: number }
): Promise<Array<{ id: string; event: string; data: string }>> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (options?.lastEventId) headers["Last-Event-ID"] = options.lastEventId;

  const res = await fetch(url, { headers });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id: string; event: string; data: string }> = [];

  const timeout = setTimeout(() => reader.cancel(), options?.timeoutMs ?? 3000);

  try {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE frames from buffer
      const frames = buffer.split("\n\n");
      buffer = frames.pop()!; // keep incomplete frame

      for (const frame of frames) {
        if (frame.startsWith(":")) continue; // heartbeat
        const fields = Object.fromEntries(
          frame.split("\n").map((line) => {
            const idx = line.indexOf(": ");
            return [line.slice(0, idx), line.slice(idx + 2)];
          })
        );
        if (fields.data) events.push(fields as any);
        if (options?.maxEvents && events.length >= options.maxEvents) {
          reader.cancel();
          return events;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  return events;
}
```

### Key End-to-End Scenario

The most important test exercises the full pipeline:

```typescript
it("full pipeline: register → post event → receive via SSE", async () => {
  const deviceId = crypto.randomUUID();

  // 1. Register a channel
  const regRes = await fetch(`${baseUrl}/gateway/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, type: "github", label: "test" }),
  });
  const channel = await regRes.json();

  // 2. Start SSE listener (will block until events arrive or timeout)
  const ssePromise = readSSEEvents(
    `${baseUrl}/gateway/devices/${deviceId}/events`,
    { maxEvents: 1, timeoutMs: 5000 },
  );

  // 3. Small delay to ensure SSE connection is established
  await new Promise((r) => setTimeout(r, 200));

  // 4. Fire a webhook
  const payload = JSON.stringify({ action: "created", comment: { body: "@anvil run tests" } });
  await fetch(`${baseUrl}/gateway/channels/${channel.channelId}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issue_comment",
    },
    body: payload,
  });

  // 5. Verify SSE received the event
  const events = await ssePromise;
  expect(events).toHaveLength(1);
  expect(events[0].event).toBe("github.issue_comment");

  const data = JSON.parse(events[0].data);
  expect(data.channelId).toBe(channel.channelId);
  expect(data.payload.action).toBe("created");
});
```

### Reconnect / Replay Scenario

```typescript
it("replays missed events on reconnect with Last-Event-ID", async () => {
  const deviceId = crypto.randomUUID();

  // Register + post 3 events while "offline"
  const channel = await registerChannel(deviceId);
  const ids = await postEvents(channel, 3);

  // Connect with Last-Event-ID of the 1st event — should replay events 2 and 3
  const events = await readSSEEvents(
    `${baseUrl}/gateway/devices/${deviceId}/events`,
    { lastEventId: ids[0], maxEvents: 2, timeoutMs: 3000 },
  );

  expect(events).toHaveLength(2);
});
```

### Vitest Configuration

Add a test script to `server/package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

The server doesn't currently have a `vitest.config.ts`. Add one:

```typescript
// server/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,   // SSE tests need time for streaming
    hookTimeout: 10000,   // server startup/shutdown
    include: ["src/**/*.test.ts"],
  },
});
```

### Running Tests

```bash
# Ensure local Redis is running
redis-cli ping  # should return PONG

# Run gateway functional tests
cd server && pnpm test
```

Tests require a running Redis on `localhost:6379`. If Redis isn't available, tests should skip with a clear message rather than fail cryptically:

```typescript
beforeAll(async () => {
  try {
    const redis = new Redis(REDIS_URL);
    await redis.ping();
    await redis.quit();
  } catch {
    console.warn("Redis not available at localhost:6379 — skipping gateway tests");
    return;
  }
  // ... start test server
});
```

---

## Resolved Questions

1. **GitHub App vs. Webhook**: Webhook for v1. GitHub App is a v2 consideration.
2. **SSE client implementation**: Fetch-based streaming in both browser and Node.js. No `EventSource` dependency. Modern Node.js supports `fetch` natively.
3. **`Last-Event-ID` on initial connect**: Solved by using `fetch` instead of `EventSource` — we can set any header on every request.
4. **`GatewayEvent.id` (UUID)**: Kept. The Redis stream ID is for checkpointing; the UUID is the stable event identifier for consumers.
5. **Channel idempotency lookup**: Dedicated Redis key `gateway:channel-by:{deviceId}:{type}:{label}` → `channelId` for O(1) upsert lookups.
