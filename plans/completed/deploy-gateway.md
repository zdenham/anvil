# Deploy Buffered Event Gateway to Fly.io

Deploy the gateway infrastructure (Redis + updated server) to Fly.io production, then adapt the functional test suite to optionally run against the live deployment.

## Phases

- [x] Deploy Redis Fly app (`anvil-redis`)
- [x] Configure server secrets and deploy `anvil-server`
- [x] Verify production deployment
- [x] Adapt functional tests for remote execution

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Deploy Redis Fly app (`anvil-redis`)

The `redis/` directory already has a `fly.toml` and `Dockerfile`. However, there's a mismatch: `fly.toml` uses `image = 'redis:7-alpine'` (stock image) which **won't load the custom `redis.conf`** with AOF persistence. The Dockerfile handles this correctly by copying `redis.conf` into the image.

### Steps

1. **Fix `redis/fly.toml`** — replace `[build] image = 'redis:7-alpine'` with `[build] dockerfile = 'Dockerfile'` so Fly builds from the local Dockerfile (which copies `redis.conf` with `appendonly yes`).

2. **Create the Fly app** (if not already created):
   ```bash
   cd redis
   fly apps create anvil-redis
   ```
   If the app already exists, this will error harmlessly — skip to next step.

3. **Create the persistent volume** (if not already created):
   ```bash
   fly volumes create redis_data --region sjc --size 1 --app anvil-redis
   ```
   If a volume already exists, skip. Check with `fly volumes list --app anvil-redis`.

4. **Deploy Redis**:
   ```bash
   cd redis
   fly deploy --app anvil-redis
   ```

5. **Verify Redis is running**:
   ```bash
   fly status --app anvil-redis
   ```
   Confirm one machine is running in `sjc`.

6. **Verify persistence config** (optional sanity check):
   ```bash
   fly ssh console --app anvil-redis -C "redis-cli CONFIG GET appendonly"
   ```
   Should return `appendonly` → `yes`.

### Notes
- Redis is internal-only (no `[http_service]` in fly.toml) — accessible only via `anvil-redis.internal:6379` on Fly's private WireGuard mesh.
- No authentication needed since it's not publicly routable.
- 256MB shared CPU, 1GB persistent volume is plenty for ~500-event-per-device streams.

---

## Phase 2: Configure server secrets and deploy `anvil-server`

### Steps

1. **Set `REDIS_URL` secret on `anvil-server`**:
   ```bash
   fly secrets set REDIS_URL=redis://anvil-redis.internal:6379 --app anvil-server
   ```
   The server's `index.ts` reads `process.env.REDIS_URL ?? "redis://localhost:6379"` — setting this secret makes it connect to the Fly Redis instance.

2. **Update `server/fly.toml`** — change `min_machines_running` from `0` to `1`. The gateway must be always-on to receive webhooks — it can't scale to zero.
   ```toml
   min_machines_running = 1
   ```

3. **Deploy the server**:
   ```bash
   cd server
   fly deploy --app anvil-server
   ```
   The Dockerfile builds from repo root context (per commit `a121907`), compiles TypeScript, and starts the production server.

4. **Verify deployment**:
   ```bash
   fly status --app anvil-server
   ```
   Confirm at least one machine is running.

### Notes
- The server already has ClickHouse secrets set — this just adds `REDIS_URL`.
- The gateway plugin loads automatically in `buildApp()` — no code changes needed.
- `ioredis` is already in `package.json` dependencies.

---

## Phase 3: Verify production deployment

Smoke-test the live gateway endpoints using `curl` commands.

### Steps

1. **Health check** (existing endpoint):
   ```bash
   curl -s https://anvil-server.fly.dev/health
   ```

2. **Register a test channel**:
   ```bash
   curl -s -X POST https://anvil-server.fly.dev/gateway/channels \
     -H "Content-Type: application/json" \
     -d '{"deviceId":"test-deploy-device","type":"github","label":"deploy-smoke-test"}' | jq .
   ```
   Expect `201` with `channelId` and `webhookUrl`.

3. **Post a test webhook event**:
   ```bash
   # Use the channelId from step 2
   curl -s -X POST https://anvil-server.fly.dev/gateway/channels/<channelId>/events \
     -H "Content-Type: application/json" \
     -H "X-GitHub-Event: push" \
     -d '{"ref":"refs/heads/main","test":true}' | jq .
   ```
   Expect `201` with `eventId`.

4. **Read events via SSE** (verify end-to-end):
   ```bash
   curl -s -N https://anvil-server.fly.dev/gateway/devices/test-deploy-device/events
   ```
   Should receive the buffered event as an SSE frame, then heartbeats.

5. **Clean up** — the test data is isolated by `deviceId` and will be trimmed naturally. No cleanup needed.

---

## Phase 4: Adapt functional tests for remote execution

Modify the test setup so tests can run against either a local server (default) or the production Fly deployment. The key constraint: **tests that inspect Redis state directly cannot run remotely** since we don't have direct Redis access in production. Only HTTP-level tests (those that only use `fetch` and `readSSEEvents`) are eligible for remote mode.

### Environment variable

```
GATEWAY_BASE_URL=https://anvil-server.fly.dev
```

When set, tests use this URL directly instead of spinning up a local Fastify server. When unset (default), behavior is unchanged — tests start a local server with local Redis.

### Changes to `setup.ts`

Add a `startRemoteOrLocal()` function that returns a `TestContext`:

```typescript
interface TestContext {
  baseUrl: string;
  /** null when running against remote — no direct Redis access */
  redis: Redis | null;
  mode: "local" | "remote";
}
```

When `GATEWAY_BASE_URL` is set:
- `baseUrl` = the env var value
- `redis` = `null` (no local Redis needed)
- `mode` = `"remote"`
- `stopTestServer()` is a no-op

When unset:
- Current behavior unchanged — spin up local Fastify + local Redis

### Test file changes

Tests that only use `baseUrl` and `fetch`/`readSSEEvents` work in both modes with no changes — they already don't depend on `redis` for assertions.

Tests that assert on Redis state directly (e.g. "stores channel in Redis with correct key structure", "creates idempotency lookup key", "trims events before Last-Event-ID") should **skip in remote mode**:

```typescript
it("stores channel in Redis with correct key structure", async ({ skip }) => {
  if (!redisAvailable) skip();  // existing check
  if (!redis) skip();           // skip in remote mode (no Redis access)
  // ... existing assertions using redis.get(), redis.xrange(), etc.
});
```

### Which tests run remotely

**`channels.test.ts`** — 6 tests:
| Test | Remote? | Reason |
|------|---------|--------|
| registers a new channel | Yes | HTTP only |
| idempotent upsert | Yes | HTTP only |
| rejects missing fields (400) | Yes | HTTP only |
| stores in Redis with correct keys | **No** | Reads Redis directly |
| adds channelId to device's channel set | **No** | Reads Redis directly |
| creates idempotency lookup key | **No** | Reads Redis directly |

**`channel-events.test.ts`** — 5 tests:
| Test | Remote? | Reason |
|------|---------|--------|
| accepts webhook (201) | Yes | HTTP only |
| 404 for non-existent channelId | Yes | HTTP only |
| constructs event type from header | **No** | Reads Redis stream directly |
| stores event in Redis stream | **No** | Reads Redis stream directly |
| correct channelId, payload, receivedAt | **No** | Reads Redis stream directly |

**`device-events.test.ts`** — 7 tests:
| Test | Remote? | Reason |
|------|---------|--------|
| streams live event | Yes | HTTP + SSE only |
| replays all buffered events | Yes | HTTP + SSE only |
| replays after Last-Event-ID | **No***  | Uses `postEvents()` which reads Redis for stream IDs |
| trims before Last-Event-ID | **No** | Reads Redis directly for trim verification |
| multiple channels on same stream | Yes | HTTP + SSE only |
| full pipeline (e2e) | Yes | HTTP + SSE only |
| reconnect replays missed | **No*** | Uses `postEvents()` which reads Redis for stream IDs |

\* These could be made remote-compatible by extracting stream IDs from SSE `id` fields instead of reading Redis, but that's a future optimization. For now, skip in remote mode.

**Summary**: 9 of 18 tests run in both modes. The remote-compatible tests cover the critical end-to-end flows: registration, webhook ingestion, SSE delivery, replay, and multi-channel routing.

### Running remote tests

```bash
# Local (default — unchanged)
cd server && pnpm test

# Against production
GATEWAY_BASE_URL=https://anvil-server.fly.dev pnpm test
```

### Implementation details

1. Modify `setup.ts` to check `process.env.GATEWAY_BASE_URL` and return appropriate `TestContext`
2. Update `channels.test.ts` — guard 3 Redis-dependent tests with `if (!redis) skip()`
3. Update `channel-events.test.ts` — guard 3 Redis-dependent tests with `if (!redis) skip()`
4. Update `device-events.test.ts` — guard 3 tests that use `postEvents()` (which depends on Redis) with `if (!redis) skip()`
5. Update `sse-reader.ts` — no changes needed (already uses `fetch` with any URL)
