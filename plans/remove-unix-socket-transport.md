# Remove Unix Socket Transport (WebSocket Only)

## Goal

Remove Unix socket support from the agent hub transport layer, making WebSocket the sole transport. The dual-transport code is unnecessary complexity — the WebSocket path already works end-to-end via the sidecar's `/ws/agent` endpoint. Tauri daemon changes are out of scope.

**Hard requirement**: When this work is complete, there must be ZERO references to Unix sockets anywhere in the codebase — no `.sock` file paths, no `net` module imports for socket purposes, no `MORT_HUB_SOCKET_PATH`, no `socketPath` variables, no `createServer`/`connect` from `net`, no newline-delimited framing logic, no socket-file cleanup. A `grep -r` for `\.sock`, `unix.*socket`, `SOCKET_PATH`, `socketPath`, `from "net"` (in agent/core code) should return nothing.

## Context

The current `HubConnection` class supports both Unix socket and WebSocket, auto-detected from the endpoint string. The sidecar already accepts agent WebSocket connections at `/ws/agent`. The `MockHubServer` in tests uses Unix sockets exclusively. Removing Unix sockets simplifies the connection layer, eliminates the `net` module dependency in agents, removes socket-file cleanup logic, and makes the test infrastructure match the production transport.

## Phases

- [x] Simplify `core/lib/socket.ts` to return WebSocket URL only

- [x] Strip Unix socket transport from `HubConnection`

- [x] Remove `existsSync` socket-file check from `HubClient`

- [x] Rewrite `MockHubServer` to use WebSocket

- [x] Update `AgentTestHarness` to use WebSocket mock

- [x] Update tests and verify

- [x] Codebase-wide grep to confirm zero Unix socket references remain

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase Details

### 1. Simplify `core/lib/socket.ts`

**File**: `core/lib/socket.ts` (25 lines)

Current logic checks three sources in order: `MORT_AGENT_HUB_WS_URL`, `MORT_HUB_SOCKET_PATH`, then defaults to `{mortDir}/agent-hub.sock`.

Change to:

- Default to `ws://127.0.0.1:${MORT_WS_PORT || 9600}/ws/agent`
- Keep `MORT_AGENT_HUB_WS_URL` override for custom URLs
- Remove `MORT_HUB_SOCKET_PATH` env var support
- Remove `isWebSocketEndpoint()` helper (no longer needed — everything is WebSocket)
- Rename `getHubSocketPath()` → `getHubEndpoint()` since it's no longer a socket path

### 2. Strip Unix socket transport from `HubConnection`

**File**: `agents/src/lib/hub/connection.ts` (307 lines)

Remove:

- `import { connect, Socket } from "net"`
- `private socket: Socket | null` field
- `private buffer = ""` field (only used for newline-delimited socket framing)
- `private draining` / `writeQueue` fields (WebSocket handles backpressure internally)
- `connectSocket()` method (lines 43-66)
- `setupSocketDataHandler()` method (lines 68-78)
- `processBuffer()` method (lines 80-93)
- `writeSocket()` method with backpressure queue (lines 151-181)
- `flushQueue()` method (lines 210-218)
- `usingWebSocket` flag and all conditionals that branch on it
- Socket-specific paths in `connectionHealth`, `isConnected`, `destroy()`, `gracefulClose()`
- `backpressure` and `drain-complete` events (WebSocket `send()` is fire-and-forget or throws)

The `connect()` method becomes just `connectWebSocket()`. The `write()` method becomes just `writeWs()`. The class shrinks from \~307 to \~120 lines.

### 3. Remove `existsSync` socket-file check from `HubClient`

**File**: `agents/src/lib/hub/client.ts` (305 lines)

- Remove `import { existsSync } from "fs"` (line 1)

- Remove `import { isWebSocketEndpoint } from "@core/lib/socket.js"` (line 3, if `isWebSocketEndpoint` is deleted)

- Remove the socket-file existence check in `reconnect()` (lines 141-147):

  ```typescript
  // This entire block goes away:
  if (!isWebSocketEndpoint(this.socketPath) && !existsSync(this.socketPath)) {
    this.connectionState = "disconnected";
    this.emit("disconnect");
    return false;
  }
  ```

- Remove `backpressure` and `drain-complete` event handlers in `wireConnectionEvents()` (lines 67-73) — these only fired from the Unix socket write path

- Remove `totalBackpressureEvents` and `maxQueueDepth` counters

- Clean up `sessionSummary` string to remove backpressure stats

- Rename `socketPath` → `endpoint` for clarity

### 4. Rewrite `MockHubServer` to use WebSocket

**File**: `agents/src/testing/mock-hub-server.ts` (375 lines)

Replace the Unix socket server with a `WebSocketServer` (from the `ws` package, already a dependency).

Key changes:

- Replace `import { createServer, Server, Socket } from "net"` with `import { WebSocketServer, WebSocket } from "ws"`
- Remove socket file path logic (tmpdir, `.sock` files, `unlinkSync` cleanup)
- Constructor takes an optional port (default: 0 for random available port)
- `start()` creates a `WebSocketServer` on the port, resolves when `listening`
- `getEndpoint()` returns `ws://127.0.0.1:${port}/ws/agent` (replaces `getSocketPath()`)
- Connection handling: `wss.on("connection", ws => ...)` instead of `server.on("connection", socket => ...)`
- Message parsing: `ws.on("message", data => JSON.parse(data))` — no newline-delimited buffering needed
- `sendToAgent()`: `ws.send(JSON.stringify(message))` instead of `socket.write(JSON.stringify(message) + "\n")`
- `stop()`: close all WebSocket connections, close the server — no socket file cleanup
- Remove `buffers` Map (WebSocket messages are already framed)

The public API stays the same (`sendToAgent`, `sendCancel`, `sendPermissionResponse`, `sendQueuedMessage`, `waitForMessage`, `waitForRegistration`, `getMessages`, etc.) so test files need minimal changes.

### 5. Update `AgentTestHarness`

**File**: `agents/src/testing/agent-harness.ts` (294 lines)

- Change socket path construction (line 143) from:

  ```typescript
  const socketPath = join(this.mortDir!.path, `test-hub-${threadId}.sock`);
  ```

  to constructing a `MockHubServer` with a random port.

- Change env var passed to subprocess (line 153) from:

  ```typescript
  MORT_HUB_SOCKET_PATH: socketPath,
  ```

  to:

  ```typescript
  MORT_AGENT_HUB_WS_URL: this.mockHub.getEndpoint(),
  ```

- Update `getMockHub()` return type if the interface changes.

### 6. Update tests and verify

**Files** (5 test files that reference `MockHubServer` or `MORT_HUB_SOCKET_PATH`):

- `agents/src/testing/__tests__/mock-hub-server.test.ts` — rewrite to test WebSocket mock
- `agents/src/testing/__tests__/sub-agent.integration.test.ts` — should work via harness changes
- `agents/src/testing/__tests__/queued-messages.integration.test.ts` — should work via harness changes
- `agents/src/experimental/__tests__/worktree-interception.integration.test.ts` — should work via harness changes
- `agents/src/experimental/__tests__/permission-gate.integration.test.ts` — should work via harness changes

Also update:

- `agents/src/testing/index.ts` — update exports if `getSocketPath()` → `getEndpoint()`
- `agents/src/testing/assertions.ts` — check for any socket-path references

Run full test suite: `cd agents && pnpm test`

## Files Changed Summary

| File | Change |
| --- | --- |
| `core/lib/socket.ts` | Rewrite: WS-only default, remove `isWebSocketEndpoint` |
| `agents/src/lib/hub/connection.ts` | Major trim: remove Unix socket transport (\~180 lines deleted) |
| `agents/src/lib/hub/client.ts` | Minor: remove `existsSync`, backpressure tracking, rename field |
| `agents/src/testing/mock-hub-server.ts` | Rewrite: Unix socket → WebSocketServer |
| `agents/src/testing/agent-harness.ts` | Minor: port-based mock, `MORT_AGENT_HUB_WS_URL` env var |
| `agents/src/testing/__tests__/mock-hub-server.test.ts` | Rewrite tests for WS mock |
| `agents/src/testing/index.ts` | Update exports |

### 7. Codebase-wide grep to confirm zero Unix socket references remain

Run these searches across `agents/`, `core/`, and `sidecar/` (excluding `node_modules`, `dist`, lock files):

```bash
# All of these should return zero results:
grep -rn '\.sock"' agents/ core/ --include='*.ts'
grep -rn 'SOCKET_PATH' agents/ core/ --include='*.ts'
grep -rn 'socketPath' agents/ core/ --include='*.ts'
grep -rn 'from "net"' agents/ core/ --include='*.ts'
grep -rn 'unix.*socket\|socket.*file\|sock.*path' agents/ core/ --include='*.ts' -i
grep -rn 'unlinkSync.*sock\|existsSync.*sock' agents/ core/ --include='*.ts'
grep -rn 'agent-hub\.sock' agents/ core/ sidecar/ --include='*.ts'
grep -rn 'isWebSocketEndpoint' agents/ core/ --include='*.ts'
grep -rn 'newline.delimit\|buffer.*\\\\n\|processBuffer' agents/ core/ --include='*.ts' -i
```

If any hits remain, fix them. This phase is not complete until every grep returns empty.

---

## Risks

- **Sidecar must be running** for agents to connect (vs Unix socket which could be served by Tauri daemon). This is already the case in the current architecture for the WS path.
- **Port conflicts** in tests — mitigated by using port 0 (OS-assigned random port) in `MockHubServer`.
- **No offline/daemon fallback** — acceptable since we're explicitly scoping out Tauri daemon changes.