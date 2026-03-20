# Remove Unix Socket Transport

## Objective

Remove Unix socket support from the agent hub transport layer, making WebSocket the sole transport. See `plans/remove-unix-socket-transport.md` for the full plan.

## Acceptance Criteria

1. `core/lib/socket.ts` exports `getHubEndpoint()` returning a WebSocket URL only
2. `HubConnection` has zero Unix socket code — no `net` imports, no buffer/framing, no socket fields
3. `HubClient` has no `existsSync` check, no backpressure tracking, field renamed to `endpoint`
4. `MockHubServer` uses `WebSocketServer` instead of Unix sockets
5. `AgentTestHarness` passes `MORT_AGENT_HUB_WS_URL` instead of `MORT_HUB_SOCKET_PATH`
6. All tests pass: `cd agents && pnpm test`
7. Codebase-wide grep for `.sock`, `SOCKET_PATH`, `socketPath`, `from "net"`, `isWebSocketEndpoint` returns zero hits in `agents/` and `core/`

## Key Files

- `core/lib/socket.ts` — hub endpoint resolution
- `core/lib/socket.test.ts` — tests for above
- `agents/src/lib/hub/connection.ts` — transport layer
- `agents/src/lib/hub/connection.test.ts` — tests for above
- `agents/src/lib/hub/client.ts` — hub client using connection
- `agents/src/lib/hub/client.test.ts` — tests for above
- `agents/src/testing/mock-hub-server.ts` — test mock server
- `agents/src/testing/__tests__/mock-hub-server.test.ts` — tests for mock
- `agents/src/testing/agent-harness.ts` — test harness
- `agents/src/testing/index.ts` — testing exports

## Phases (from plan)

1. Simplify `core/lib/socket.ts` to return WebSocket URL only
2. Strip Unix socket transport from `HubConnection`
3. Remove `existsSync` socket-file check from `HubClient`
4. Rewrite `MockHubServer` to use WebSocket
5. Update `AgentTestHarness` to use WebSocket mock
6. Update tests and verify
7. Codebase-wide grep to confirm zero Unix socket references remain