# Sidecar Auth — Per-Session Token

**Goal:** Prevent any local process or browser tab from accessing the sidecar's WebSocket and HTTP endpoints without authorization. Addresses security audit findings #1, #2.

**Approach:** Generate a random token at sidecar startup, write it to the existing port file on disk, and require it on all WS and HTTP requests. The Tauri app already reads the port file — it will also read the token and pass it to the frontend.

---

## Phases

- [x] Generate token and write to port file (sidecar)

- [x] Require token on HTTP and WS endpoints (sidecar)

- [x] Read token from port file and pass to frontend (Tauri + frontend)

- [x] Pass token to spawned agent processes

- [x] Restrict CORS to localhost origins only

- [x] Update e2e tests to supply token

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Generate token and write to port file

**Files:** `sidecar/src/server.ts`

- On startup, generate a 32-byte random hex token via `crypto.randomBytes(32).toString('hex')`
- Include it in the port file JSON: `{ port, appSuffix, pid, token }`
- Export/share the token value so the auth middleware can reference it

## Phase 2: Require token on HTTP and WS endpoints

**Files:** `sidecar/src/server.ts`

**HTTP routes (**`/files`**,** `/hooks`**):**

- Add Express middleware that checks for `Authorization: Bearer <token>` header
- Skip auth on `GET /health` (already has no sensitive data, and is used for health probing before the token is known)
- Return 401 on missing/invalid token

**WebSocket upgrade (**`/ws`**,** `/ws/agent`**):**

- In the `server.on("upgrade", ...)` handler, parse the URL query string for `?token=<token>`
- If missing or invalid, call `socket.destroy()` and do not upgrade
- Query param is the simplest approach since `WebSocket` constructor doesn't support custom headers in browsers

## Phase 3: Read token and pass to frontend

**Files:** `src-tauri/src/lib.rs`, `src/lib/invoke.ts`

**Tauri side (**`lib.rs`**):**

- `read_port_file()` already parses JSON — extract the `token` field alongside `port`
- Update `SidecarSpawnResult` to include `token: String`
- Add a new Tauri IPC command `get_ws_token` (or extend `get_ws_port` to return both port and token)
- Store token in a managed state struct, similar to `SidecarPort`

**Frontend (**`invoke.ts`**):**

- In `resolveWsUrl()`, also fetch the token via IPC (`get_ws_token` or combined call)
- Append `?token=<token>` to the WS URL: `ws://localhost:{port}/ws?token={token}`
- For HTTP requests to `/files` and `/hooks`, include `Authorization: Bearer <token>` header
- Store the resolved token in module-level state alongside `resolvedWsUrl`

**Browser/dev mode fallback:**

- When running via `pnpm dev` (no Tauri IPC), the sidecar port file is at `ANVIL_DATA_DIR`. Two options:
  - Read the token from the port file at dev server startup and inject it as `__ANVIL_WS_TOKEN__` (similar to `__ANVIL_WS_PORT__`)
  - Or skip auth in dev mode via an env var `ANVIL_SIDECAR_NO_AUTH=1`
- Recommend the env var approach for simplicity — dev mode is local-only anyway

## Phase 4: Pass token to spawned agent processes

**Files:** `src/lib/agent-service.ts`, `core/lib/socket.ts`

Today the frontend sets `ANVIL_AGENT_HUB_WS_URL=ws://127.0.0.1:{port}/ws/agent` as an env var when spawning agents. The agent's `getHubEndpoint()` in `core/lib/socket.ts` returns this URL directly.

**Frontend (**`agent-service.ts`**):**

- After Phase 3, the frontend already has the token in module-level state
- Append the token as a query param to the URL passed to agents: `ws://127.0.0.1:{port}/ws/agent?token={token}`
- This applies to both `spawnSimpleAgent` and `resumeSimpleAgent` — both set `ANVIL_AGENT_HUB_WS_URL`

**Agent (**`core/lib/socket.ts`**):**

- No changes needed — `getHubEndpoint()` already returns the env var as-is, and the token will be embedded in the URL
- The sidecar's upgrade handler (Phase 2) will validate the `?token=` query param regardless of whether the connection is on `/ws` or `/ws/agent`

## Phase 5: Restrict CORS to localhost origins

**Files:** `sidecar/src/server.ts`

- Replace `Access-Control-Allow-Origin: *` with a check that only allows:
  - `tauri://localhost` (Tauri webview origin)
  - `http://localhost:*` (dev mode)
- Add `Authorization` to `Access-Control-Allow-Headers`
- This is a defense-in-depth layer on top of the token auth

## Phase 6: Update e2e tests

**Files:** `e2e/lib/wait-helpers.ts`, various `e2e/**/*.spec.ts`

- E2e tests hardcode `ws://localhost:9600/ws` — update to read token from port file or use the no-auth env var
- Simplest: set `ANVIL_SIDECAR_NO_AUTH=1` in e2e test environment config

---

## Notes

- **Why not Unix domain sockets?** Would be more secure but requires significant plumbing changes across Tauri, frontend, and dev tooling. Token auth gets us 95% of the security benefit with minimal change.
- **Tauri CSP (**`csp: null`**):** This plan doesn't address CSP (finding #3). CSP is disabled likely because Vite dev mode injects inline scripts, and the Tauri webview loads from localhost in dev. Enabling CSP requires configuring nonces or hashes for Vite's HMR scripts — worth doing but separate scope.
- **Token rotation:** Not needed for v1. The token lives for the lifetime of the sidecar process. If the sidecar restarts, a new token is generated and the port file is rewritten. The Tauri app will re-read it on reconnect.