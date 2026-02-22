# Buffered Event Gateway

Extends the existing `mort-server` Fastify service with gateway routes that accept webhooks, buffer events in Redis, and stream them to clients via SSE. The gateway is logically separated into its own route namespace and directory within the server.

## Problem

Mort agents run locally on developer machines. External events (PR comments, webhook triggers) happen while machines may be asleep, offline, or otherwise unavailable. We need a persistent intermediary that:

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
│   mort-server (Fastify)   │  ← Fly.io (mort-server.fly.dev)
│                           │
│  Existing:                │
│    POST /logs             │
│    POST /identity         │
│    GET  /health           │
│                           │
│  Gateway (new):           │
│    POST /gateway/channels │  ← register a channel (e.g. github webhook)
│    POST /gateway/ingest/:channelId  ← webhook receiver
│    GET  /gateway/events/:deviceId   ← SSE stream
│                           │
│  Redis (self-hosted)      │  ← event buffer (Fly app + volume)
└──────────────────────────┘
        │ SSE
        ▼
┌──────────────────────────┐
│   Client (pure TS)        │
│   (EventSource or fetch)  │
│                           │
│   Works in browser & Node │
└──────────────────────────┘
```

## Phases

- [ ] Design channel registration and device routing
- [ ] Design webhook ingestion and Redis buffering
- [ ] Design SSE delivery and replay protocol
- [ ] Design pure TypeScript SSE client
- [ ] Define server directory structure and deployment changes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

## Decisions

1. **Self-hosted Redis on Fly.io with volume-backed persistence.** Redis runs as a separate Fly app with a persistent volume and AOF enabled. Data survives restarts and redeployments. The `MAXLEN ~ 500` cap on ingestion is the only cleanup mechanism needed.
2. **No shared secret. Auth is keyed by deviceId.** Removed `GATEWAY_SECRET`. Client-facing endpoints (`POST /gateway/channels`, `GET /gateway/events/:deviceId`) are authenticated by the `deviceId` itself — a device can only register channels for and subscribe to its own stream. No Bearer token for v1.
3. **Single consumer per device. Purge on connect is safe.** Only one SSE consumer per device stream. `XTRIM MINID` on reconnect is safe and keeps streams bounded.
4. **Channel registration is idempotent.** Upsert by `deviceId + type + label` — if a channel with the same combination already exists, return the existing channel rather than creating a duplicate.
5. **PR comment handler (Phase 5) is out of scope.** This plan covers gateway infrastructure only (Phases 1-4, 6). The PR comment handler is retained in the plan only as a motivating example for design decisions, not as implementation work.
6. **DeviceId UUID is sufficient auth for v1.** UUIDs are unguessable — no additional per-device token needed.
7. **Self-hosted Redis on Fly.io (not Upstash).** Separate Fly app with volume + AOF. `ioredis` as client (supports native `XREAD BLOCK` needed for SSE long-polling).
8. **Redis keys use `gateway:` prefix.** All keys namespaced under `gateway:` (e.g. `gateway:channel:{channelId}`, `gateway:events:{deviceId}`, `gateway:device-channels:{deviceId}`) for clean separation if the Redis instance is shared later.
9. **Channel state lives in Redis only.** Channels are cheap to re-register. Redis with AOF on a persistent volume is durable enough — no need to duplicate to ClickHouse.

---

## Phase 1: Channel Registration & Device Routing

### Identity — Already Done

Device identity is handled by the existing `identities` table in ClickHouse and `~/.mort/settings/identity.json` locally. See [identity-table.md](./identity-table.md) for the full design.

Key facts:
- `device_id` is a stable UUID v4 generated on first launch, persisted in `~/.mort/settings/app-config.json`
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
  /** Channel type — determines verification logic */
  type: "github";
  /** Human label (e.g. "zac's github webhooks") */
  label: string;
  /** Secret for verifying incoming webhooks (e.g. GitHub HMAC secret) */
  webhookSecret: string;
  /** ISO timestamp */
  createdAt: string;
}
```

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
    "webhookUrl": "https://mort-server.fly.dev/gateway/ingest/a1b2c3d4-...",
    "webhookSecret": "whsec_..."
  }
```

The server generates a `channelId` and a `webhookSecret`. The user configures their GitHub repo webhook with the returned URL and secret.

**Idempotency**: Registration upserts by `deviceId + type + label`. If a channel with the same combination already exists, the existing channel is returned rather than creating a duplicate.

### Why Channels Instead of Routing by GitHub Handle

- **Multiple sources**: A device might receive events from GitHub, Slack, CI, etc. Each source gets its own channel with its own verification secret.
- **Per-channel secrets**: Each channel has its own `webhookSecret` for HMAC verification, rather than a single global secret.
- **`deviceId` as the stream key**: The SSE connection streams `events:{deviceId}` — all events from all channels for that device arrive on one stream.
- **Clean deregistration**: Deleting a channel (future) invalidates just that webhook URL.

### Redis Storage for Channels

```
gateway:channel:{channelId} → Channel JSON (hash or string)
gateway:device-channels:{deviceId} → set of channelIds
```

Lookups:
- Webhook arrives at `/gateway/ingest/:channelId` → read `gateway:channel:{channelId}` → get `deviceId` → push to `gateway:events:{deviceId}`
- SSE connects at `/gateway/events/:deviceId` → read from `gateway:events:{deviceId}` stream

### Authentication

For v1, client-facing endpoints (`POST /gateway/channels`, `GET /gateway/events/:deviceId`) are keyed by `deviceId` — a device can only register channels for itself and subscribe to its own event stream. No shared secret or Bearer token. Webhook ingestion endpoints (`POST /gateway/ingest/:channelId`) use per-channel HMAC verification.

---

## Phase 2: Webhook Ingestion & Redis Buffering

### Ingestion Endpoint

```
POST /gateway/ingest/:channelId
Headers:
  X-GitHub-Event: pull_request_review_comment
  X-Hub-Signature-256: sha256=...
```

The `:channelId` in the URL identifies which channel (and therefore which device) this event targets. When configuring a GitHub webhook, you use the URL returned by `POST /gateway/channels`.

### Ingestion Flow

1. Look up `gateway:channel:{channelId}` from Redis
2. Verify `X-Hub-Signature-256` against the channel's `webhookSecret`
3. Construct a `GatewayEvent` from the webhook payload
4. `XADD gateway:events:{deviceId} * ...` — push to the device's event stream
5. `XTRIM gateway:events:{deviceId} MAXLEN ~ 500` — cap buffer at ~500 events
6. Return `200 OK`

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

### Webhook Verification

Per-channel HMAC verification using the channel's `webhookSecret`:

```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyGitHubSignature(payload: Buffer, signature: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## Phase 3: SSE Delivery & Replay Protocol

### SSE Endpoint

```
GET /gateway/events/:deviceId
Headers:
  Last-Event-ID: <redis-stream-id>  (optional, for replay)
```

### Connection Lifecycle

1. **Client connects** with `deviceId` and optional `Last-Event-ID`
2. **Purge old events**: If `Last-Event-ID` is provided, trim events before that ID — the client has confirmed receipt. `XTRIM gateway:events:{deviceId} MINID <last-event-id>` removes everything the client has already seen.
3. **Replay phase**: Read all events after `Last-Event-ID` from `gateway:events:{deviceId}` and send them immediately
4. **Live phase**: Poll `XREAD BLOCK 5000 STREAMS gateway:events:{deviceId} $` for new events, send as SSE
5. **Heartbeat**: Send `:heartbeat\n\n` every 15s to keep the connection alive
6. **Disconnect**: Connection closes, no state to clean up (stream persists in Redis)

### Why Purge on Connect

The client's `Last-Event-ID` is an acknowledgment: "I have received and persisted everything up to this ID." The server can safely discard those events. This keeps the Redis stream small and avoids replaying the same events repeatedly. Combined with `MAXLEN ~ 500` on ingestion, the stream stays bounded from both ends.

### SSE Message Format

```
id: 1708300000000-0
event: github.issue_comment
data: {"id":"abc-123","type":"github.issue_comment","channelId":"a1b2c3d4","payload":{...},"receivedAt":1708300000000}

```

The `id` field uses the Redis stream ID, which the browser/client sends back as `Last-Event-ID` on reconnect — giving us at-least-once delivery with client-side dedup via the event `id`.

### No Device State in Redis

Unlike the previous design, we don't track `online`/`offline` state in Redis. The stream just accumulates events. When a client connects, it replays and catches up. When it disconnects, events keep buffering. This simplifies the server — no state machine to manage.

---

## Phase 4: Pure TypeScript SSE Client

### Design Goal: Platform-Agnostic

The client must work in both **browser** (Tauri webview) and **Node.js** (agent processes). This means:

- No browser-only APIs (`localStorage`, `window`) in the core
- No Node-only APIs (`fs`, `process`) in the core
- Persistence and event dispatch are injected via constructor options

### Client Architecture

```typescript
interface GatewayClientOptions {
  /** Gateway base URL (e.g. "https://mort-server.fly.dev") */
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

### Platform Adapters

**Browser (Tauri webview)**:
```typescript
const client = new GatewayClient({
  baseUrl: "https://mort-server.fly.dev",
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

const checkpointPath = join(homedir(), ".mort", "gateway-checkpoint.json");

const client = new GatewayClient({
  baseUrl: "https://mort-server.fly.dev",
  deviceId,

  loadLastEventId: async () => {
    try { return JSON.parse(await readFile(checkpointPath, "utf-8")).lastEventId; }
    catch { return null; }
  },
  saveLastEventId: async (id) => { await writeFile(checkpointPath, JSON.stringify({ lastEventId: id })); },
  onEvent: (event) => handleEvent(event),
});
```

### SSE Implementation

For browser: use native `EventSource` API (auto-reconnect with `Last-Event-ID` built-in).

For Node.js: use `eventsource` npm package (spec-compliant `EventSource` polyfill) or a lightweight `fetch`-based SSE reader. The `EventSource` API is the same in both environments, so the core class can use it directly if we ensure it's available.

The class internally uses `EventSource` with a custom `lastEventId` from the injected `loadLastEventId`. On each event, it calls `saveLastEventId` to checkpoint progress.

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

The first concrete event handler would be a consumer of the gateway client that interprets GitHub `issue_comment` events and spawns local agents. A `github.issue_comment` or `github.pull_request_review_comment` event where the comment matches a trigger pattern (e.g. `@mort` or `/mort run`) would check out the PR branch in a worktree, spawn an agent, and report back via GitHub API. This use case drives design decisions around event typing (`github.${event_name}`), the `EventHandler` interface, and keeping the gateway payload-agnostic.

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
│   │   │   ├── ingest.ts     # POST /gateway/ingest/:channelId
│   │   │   └── events.ts     # GET /gateway/events/:deviceId (SSE)
│   │   ├── services/
│   │   │   ├── redis.ts      # Redis client singleton + connection
│   │   │   └── event-buffer.ts  # XADD, XREAD, XTRIM wrappers
│   │   ├── middleware/
│   │   │   └── webhook-verify.ts  # Per-channel HMAC verification
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
  fastify.post("/ingest/:channelId", ingestHandler);
  fastify.get("/events/:deviceId", eventsHandler);
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

The pure TypeScript client lives in `core/types/` alongside other shared types, or in a new `core/gateway/` directory if it needs more than types:

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

The existing `mort-server` Fly.io app gains gateway functionality. Changes to `fly.toml`:

```toml
# Must stay running for webhook reception
min_machines_running = 1
```

The logging server currently scales to 0 when idle. With the gateway, the server must be always-on to receive webhooks. This is the main operational change.

### Redis Deployment (Self-Hosted on Fly.io)

Redis runs as a **separate Fly app** (`mort-redis`) in the same region (`sjc`), accessible to `mort-server` over Fly's private network (`mort-redis.internal:6379`). No public internet exposure.

**`redis/fly.toml`**:
```toml
app = 'mort-redis'
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
fly apps create mort-redis
fly volumes create redis_data --region sjc --size 1 --app mort-redis
fly deploy --app mort-redis
```

**Persistence**: Redis is configured with `appendonly yes` (AOF). The `/data` directory is backed by a Fly volume, so data survives restarts and redeployments. This is the same setup as running Redis on Render or any other VM — standard Redis persistence on a real disk.

**Networking**: Fly apps in the same org communicate over a private WireGuard mesh via `.internal` DNS. The server connects to `redis://mort-redis.internal:6379` — no authentication needed since it's not publicly routable.

### New Environment Variables

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection string (`redis://mort-redis.internal:6379`) |

Note: there is no global secret for client-facing auth — endpoints are keyed by `deviceId`. There is also no global `GITHUB_WEBHOOK_SECRET` — each channel has its own `webhookSecret` generated at registration time.

---

## Open Questions

1. **GitHub App vs. Webhook**: A GitHub App would give us per-repo installation and better auth. Worth considering for v2, but manual webhook configuration is fine for v1.
2. **Node.js EventSource polyfill**: Need to pick a package (`eventsource`, `event-source-polyfill`, or manual fetch-based). The client class should abstract this so the choice is swappable.
