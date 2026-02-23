# Buffered Event Gateway — Implementation Sub-Plans

Parent plan: [buffered-event-gateway.md](../buffered-event-gateway.md)

Decomposed into four parallel workstreams. The parent plan contains all design decisions, schemas, and architecture — these sub-plans cover **implementation only**.

## Workstreams

| # | Plan | Scope | Dependencies |
|---|------|-------|--------------|
| A | [server-scaffolding.md](./server-scaffolding.md) | Redis Fly app, `buildApp()` refactor, gateway plugin skeleton, ioredis dep | None — start immediately |
| B | [gateway-routes.md](./gateway-routes.md) | All three gateway routes + Redis service layer (channels, ingestion, SSE) | A (needs plugin skeleton + Redis client) |
| C | [sse-client.md](./sse-client.md) | Pure TS fetch-based SSE client in `core/gateway/` | None — SSE wire format is defined in parent plan |
| D | [test-suite.md](./test-suite.md) | Functional test suite (real server + real Redis, no mocks) | A + B (needs working server) |

## Parallelism

```
Time ───────────────────────────────────────►

A: server-scaffolding  ████░░░░░░░░░░░░░░░░
C: sse-client          ████████████░░░░░░░░░
B: gateway-routes      ░░░░████████████░░░░░  (starts after A)
D: test-suite          ░░░░░░░░░░░░████████░  (starts after B)
```

- **A** and **C** have no dependencies — start immediately in parallel
- **B** starts after **A** completes (needs the plugin skeleton and Redis client)
- **D** starts after **B** completes (needs working routes to test against)
- **C** is fully independent — the SSE wire format is locked in the parent plan

## Shared Context

All sub-plans reference the parent for:
- Data models (`Channel`, `GatewayEvent` interfaces)
- Redis key schema (`gateway:channel:{channelId}`, `gateway:events:{deviceId}`, etc.)
- Design decisions (numbered 1–16 in parent)
- Architecture diagram and endpoint contracts
