# A: Server Scaffolding & Redis Infrastructure

Parent: [readme.md](./readme.md) | Design: [../buffered-event-gateway.md](../buffered-event-gateway.md) (Phase 6)

Sets up the structural foundation that all other workstreams build on. No business logic — just wiring, config, and the Redis deployment.

## Phases

- [x] Create Redis Fly app (`redis/` directory)
- [x] Add ioredis dependency and Redis service module
- [x] Refactor server entry to `buildApp()` pattern
- [x] Create gateway Fastify plugin skeleton
- [x] Add Vitest config and test harness

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create Redis Fly App

Create `redis/` at the repo root with two files:

**`redis/fly.toml`** — Fly app config for self-hosted Redis:
```toml
app = 'anvil-redis'
primary_region = 'sjc'

[build]
  image = 'redis:7-alpine'

[mounts]
  source = 'redis_data'
  destination = '/data'

[[vm]]
  memory = '256mb'
  cpu_kind = 'shared'
  cpus = 1
```

**`redis/Dockerfile`** — Redis with AOF persistence:
```dockerfile
FROM redis:7-alpine
COPY redis.conf /usr/local/etc/redis/redis.conf
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]
```

**`redis/redis.conf`** — Minimal config:
```
appendonly yes
dir /data
```

No public services — Redis is accessible only via Fly internal networking (`anvil-redis.internal:6379`).

---

## Phase 2: Add ioredis & Redis Service Module

**`server/package.json`** — add dependency:
```
pnpm add ioredis
```

**`server/src/gateway/services/redis.ts`** — Redis client singleton:
```typescript
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(url: string): Redis {
  if (!client) {
    client = new Redis(url);
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
```

The Redis URL comes from `REDIS_URL` env var (production: `redis://anvil-redis.internal:6379`, dev/test: `redis://localhost:6379`).

---

## Phase 3: Refactor Server Entry to `buildApp()`

The current `server/src/index.ts` calls `start()` at module level. Refactor to export a `buildApp()` function so tests can create Fastify instances without side effects.

**Create `server/src/app.ts`**:
```typescript
import Fastify from "fastify";
import { gatewayPlugin } from "./gateway/index.js";

export interface AppOptions {
  redisUrl: string;
  gatewayOnly?: boolean;
}

export async function buildApp(options: AppOptions) {
  const fastify = Fastify({ logger: options.gatewayOnly ? false : true });

  if (!options.gatewayOnly) {
    // Register existing ClickHouse routes (logs, identity, health)
    // ... move existing route registration here
  }

  await fastify.register(gatewayPlugin, {
    prefix: "/gateway",
    redisUrl: options.redisUrl,
  });

  return fastify;
}
```

**Update `server/src/index.ts`** to use `buildApp()`:
```typescript
import { buildApp } from "./app.js";

const app = await buildApp({
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});

// ... existing listen() call
```

The existing ClickHouse routes, health check, and identity endpoint continue working unchanged.

---

## Phase 4: Gateway Fastify Plugin Skeleton

**Create `server/src/gateway/index.ts`** — empty plugin with route stubs:
```typescript
import { FastifyPluginAsync } from "fastify";

export interface GatewayPluginOptions {
  redisUrl: string;
}

const gatewayPlugin: FastifyPluginAsync<GatewayPluginOptions> = async (fastify, opts) => {
  // Routes will be added by the gateway-routes workstream
  // POST /channels
  // POST /channels/:channelId/events
  // GET /devices/:deviceId/events
};

export default gatewayPlugin;
export { gatewayPlugin };
```

Create the directory structure:
```
server/src/gateway/
├── index.ts           # Plugin (this phase)
├── routes/            # Empty dir — filled by workstream B
├── services/
│   └── redis.ts       # Created in phase 2
└── types/             # Empty dir — filled by workstream B
```

---

## Phase 5: Vitest Config & Test Harness

**Create `server/vitest.config.ts`**:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 10000,
    include: ["src/**/*.test.ts"],
  },
});
```

**Add scripts to `server/package.json`**:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Install vitest** as dev dependency:
```
pnpm add -D vitest
```

**Create `server/src/gateway/__tests__/setup.ts`** — shared test harness:
```typescript
import { buildApp } from "../../app.js";
import Redis from "ioredis";
import type { FastifyInstance } from "fastify";

const REDIS_URL = "redis://localhost:6379";

let app: FastifyInstance;
let redis: Redis;

export async function startTestServer() {
  redis = new Redis(REDIS_URL);
  try {
    await redis.ping();
  } catch {
    console.warn("Redis not available — skipping gateway tests");
    throw new Error("Redis unavailable");
  }

  app = await buildApp({ redisUrl: REDIS_URL, gatewayOnly: true });
  await app.listen({ port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" ? address!.port : 0;
  return { app, redis, baseUrl: `http://localhost:${port}` };
}

export async function stopTestServer() {
  await app?.close();
  if (redis) {
    const keys = await redis.keys("gateway:*");
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  }
}
```

---

## Completion Criteria

- `redis/` directory exists with `fly.toml`, `Dockerfile`, `redis.conf`
- `ioredis` is in `server/package.json` dependencies
- `server/src/app.ts` exports `buildApp()` and the existing `index.ts` uses it
- `server/src/gateway/index.ts` exports a Fastify plugin (empty routes OK)
- `server/src/gateway/services/redis.ts` provides `getRedis()` / `closeRedis()`
- `server/vitest.config.ts` exists and `pnpm test` runs (even if no tests yet)
- `server/src/gateway/__tests__/setup.ts` provides `startTestServer()` / `stopTestServer()`
- Server starts and existing routes (`/logs`, `/identity`, `/health`) still work
