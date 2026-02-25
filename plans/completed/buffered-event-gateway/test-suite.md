# D: Functional Test Suite

Parent: [readme.md](./readme.md) | Design: [../buffered-event-gateway.md](../buffered-event-gateway.md) (Phase 7)

**Depends on:** [server-scaffolding.md](./server-scaffolding.md) + [gateway-routes.md](./gateway-routes.md) (needs working server + routes to test against)

End-to-end functional tests exercising the full gateway stack — real Fastify server, real Redis, real HTTP requests, real SSE streams. No mocks.

## Phases

- [x] Implement SSE test reader utility
- [x] Implement channel registration tests
- [x] Implement webhook ingestion tests
- [x] Implement SSE delivery and replay tests
- [x] Implement full pipeline end-to-end test

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: SSE Test Reader Utility

A lightweight fetch-based SSE reader for use in tests. Lives alongside the test files.

**`server/src/gateway/__tests__/sse-reader.ts`**:

```typescript
export interface SSETestEvent {
  id: string;
  event: string;
  data: string;
}

export async function readSSEEvents(
  url: string,
  options?: { lastEventId?: string; maxEvents?: number; timeoutMs?: number }
): Promise<SSETestEvent[]>
```

Behavior:
- Opens a `fetch` connection to the SSE endpoint
- Parses SSE frames from the streaming body
- Collects events until `maxEvents` reached or `timeoutMs` elapsed
- Cancels the reader and returns collected events
- Skips heartbeat comments (lines starting with `:`)

Default timeout: 3000ms. This keeps tests fast while allowing enough time for the XREAD BLOCK cycle.

---

## Phase 2: Channel Registration Tests

**`server/src/gateway/__tests__/channels.test.ts`**

Uses `startTestServer()` / `stopTestServer()` from the shared setup harness (created in workstream A).

```typescript
describe("POST /gateway/channels", () => {
  it("registers a new channel and returns channelId + webhookUrl");
  it("returns the same channel on duplicate registration (idempotent)");
  it("rejects missing required fields with 400");
  it("stores channel in Redis with correct key structure");
  it("adds channelId to device's channel set");
  it("creates idempotency lookup key");
});
```

Each test:
1. Makes a real HTTP `fetch` request to the test server
2. Asserts on the HTTP response (status, body)
3. Inspects Redis directly via the `redis` client from setup to verify stored state

Use `crypto.randomUUID()` for `deviceId` in each test to avoid cross-test interference.

---

## Phase 3: Webhook Ingestion Tests

**`server/src/gateway/__tests__/channel-events.test.ts`**

```typescript
describe("POST /gateway/channels/:channelId/events", () => {
  // beforeAll: register a channel

  it("accepts a webhook and returns 201");
  it("returns 404 for non-existent channelId");
  it("constructs event type from X-GitHub-Event header");
  it("stores event in device's Redis stream");
  it("event contains correct channelId, payload, and receivedAt");
});
```

Each test posts a webhook payload with appropriate headers and then reads the Redis stream directly to verify the event was buffered correctly.

---

## Phase 4: SSE Delivery & Replay Tests

**`server/src/gateway/__tests__/device-events.test.ts`**

The most important test file — verifies the complete SSE lifecycle.

```typescript
describe("GET /gateway/devices/:deviceId/events (SSE)", () => {
  it("streams a live event when webhook arrives while connected");
  it("replays all buffered events on first connect (no Last-Event-ID)");
  it("replays only events after Last-Event-ID on reconnect");
  it("trims events before Last-Event-ID on reconnect");
  it("sends heartbeat on idle connections");
  it("delivers events from multiple channels on same device stream");
});
```

Test pattern for live streaming:
1. Register channel, start SSE reader (with `maxEvents: 1`)
2. Brief delay (200ms) for connection to establish
3. Post a webhook
4. Assert SSE reader received the event

Test pattern for replay:
1. Register channel, post N events while no SSE connection
2. Connect SSE with optional `Last-Event-ID`
3. Assert correct events replayed

Test pattern for trim:
1. Post events, note their stream IDs
2. Connect with `Last-Event-ID` set to a middle event
3. After connection, check Redis directly — events before `Last-Event-ID` should be trimmed

---

## Phase 5: Full Pipeline End-to-End Test

The single most important test — exercises the complete happy path:

```typescript
it("full pipeline: register → webhook → SSE delivery", async () => {
  // 1. Register a channel for a fresh deviceId
  // 2. Start SSE listener
  // 3. Post a webhook to the channel
  // 4. Assert SSE received the event with correct type, channelId, payload
});
```

And the reconnect scenario:

```typescript
it("reconnect replays missed events", async () => {
  // 1. Register channel
  // 2. Post 3 events while "offline" (no SSE connection)
  // 3. Connect with Last-Event-ID of event 1
  // 4. Assert events 2 and 3 are replayed
});
```

---

## Completion Criteria

- All test files run with `pnpm test` from `server/`
- Tests use real HTTP requests and real Redis (no mocks)
- Tests clean up their own Redis keys after each suite
- Tests skip gracefully if Redis is not available on `localhost:6379`
- Full pipeline test passes: register → webhook → SSE delivery
- Replay/reconnect test passes: buffered events delivered with correct `Last-Event-ID` behavior
- Each test uses a unique `deviceId` to avoid cross-test interference
