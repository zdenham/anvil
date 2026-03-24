# Port Conflict Resilience

## Problem

When port 9600 (or the configured `ANVIL_WS_PORT`) is already taken:

1. **Non-Anvil process on the port**: Health check fails (connection refused or wrong response) → Rust spawns sidecar → `server.listen()` hits `EADDRINUSE` → sidecar crashes silently → frontend reconnects forever to nothing
2. **Stale Anvil sidecar from a previous session**: Health check returns 200 → Rust skips spawning → frontend connects to the old sidecar, which may have stale state or be from a different app-suffix/version
3. **No identity verification**: The `/health` endpoint returns `{ status: "ok", port: 9600 }` but nothing ties it to *this* Tauri instance

The port is baked at build time in three places:

- Rust: `build_info::WS_PORT` (compile-time `env!()`)
- Frontend: `__ANVIL_WS_PORT__` (Vite `define`)
- Agents: `ANVIL_WS_PORT` env var passed at spawn time

This means dynamic port selection would require a runtime discovery mechanism.

## Design Constraints

- Must guarantee the frontend connects to the sidecar spawned by *this* Tauri instance (not a rogue process or stale sidecar)
- Agents must connect to the same sidecar that manages them
- Should not require changing the build-time port baking for the common case (port is available)
- Solution should fail loudly when things go wrong, not silently degrade
- Avoid overly complex identity mechanisms — the main real-world conflict is dev vs prod running simultaneously

## Proposed Approach: App-Suffix Health Check + Sequential Port Increment

Two complementary mechanisms:

### 1. App-Suffix Verification (dev vs prod differentiation)

The primary real conflict scenario is a dev and prod Anvil running simultaneously. We already have `ANVIL_APP_SUFFIX` baked at build time — we can use this to differentiate.

**Sidecar side** (`server.ts`):

- Read `ANVIL_APP_SUFFIX` from env (already available)
- Include it in health check response: `{ status: "ok", port: 9600, appSuffix: "dev" }`

**Rust health check** (`lib.rs`):

- After getting 200 from `/health`, parse the response body
- If `appSuffix` field doesn't match our `build_info::APP_SUFFIX` → treat as port conflict (proceed to spawn on next port)
- If `appSuffix` matches → it's our sidecar variant, skip spawn

This is lightweight — no tokens to generate, store, or pass around. It solves the main real-world conflict (dev + prod coexisting) without the brittleness of per-instance UUIDs.

### 2. Sequential Port Increment on EADDRINUSE

When the preferred port is taken (either by a non-Anvil process or a different app-suffix):

**Sidecar side** (`server.ts`):

- Wrap `server.listen()` with EADDRINUSE error handling
- On EADDRINUSE: increment port by 1 and retry (e.g. 9600 → 9601 → 9602 ...)
- Cap retries at some reasonable limit (e.g. 10 attempts)
- After successful listen, write actual port to a known file: `$ANVIL_DATA_DIR/sidecar-<app-suffix>.port` → `{ "port": 9601, "appSuffix": "dev", "pid": 12345 }`
- Base port comes from `ANVIL_WS_PORT` env var, defaults to 9600 if not set

**Rust side** (`lib.rs`):

- After spawning sidecar, if health check on preferred port fails/times out:
  - Check ports sequentially (preferred+1, preferred+2, ...) for a health response with matching `appSuffix`
  - Or read the port file to discover actual port
- Expose actual port via Tauri IPC command (`get_ws_port`)
- Clean up port file on app exit

**Frontend** (`invoke.ts`):

- In Tauri mode: query actual port via IPC instead of using baked `__ANVIL_WS_PORT__`
- In web mode: try baked port first (web mode assumes default port is available)

**Agents**:

- Already receive the URL via env var at spawn time, so no change needed — Rust just passes the actual port

### 3. EADDRINUSE Error Handling (minimum viable fix)

Even without the full fallback, the sidecar should handle EADDRINUSE explicitly:

```typescript
server.listen(PORT, "127.0.0.1", () => { ... });
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log.error(`Port ${PORT} is already in use`);
    // attempt next port in sequence
  }
});
```

## Phases

- [x] Add EADDRINUSE error handling to sidecar `server.ts` with sequential port increment (base port from env var, default 9600, retry up to 10 ports)

- [x] Add `appSuffix` to sidecar `/health` response and port file write (`$ANVIL_DATA_DIR/sidecar-<app-suffix>.port`)

- [x] Update Rust health check to verify `appSuffix` matches `build_info::APP_SUFFIX`, treat mismatch as port conflict

- [x] Update Rust sidecar launch to discover actual port (sequential check or port file) when preferred port is taken

- [x] Wire frontend to discover actual port via Tauri IPC (`get_ws_port`) in Tauri mode

- [x] Wire agent spawn to pass actual port/URL

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Alternatives Considered

### Instance Token (per-instance UUID)

- Generate a random UUID per Tauri launch, pass to sidecar, verify on health check
- Heavier than needed — the real conflict is dev vs prod, not two identical builds racing
- Adds brittleness: token must be threaded through Rust → sidecar → frontend → agents
- Could revisit if app-suffix proves insufficient

### Unix Domain Socket instead of TCP

- Would eliminate port conflicts entirely
- But: browser WebSocket API can't connect to UDS, and the web standalone mode needs TCP
- Could use UDS for agent↔sidecar and TCP only for frontend, but adds complexity

### Always use port 0 (OS-assigned)

- Simple, no conflicts ever
- But: requires a discovery mechanism for every client, and dev mode becomes harder (can't bookmark `localhost:9600`)
- Sequential increment is more predictable — dev ends up on 9601 consistently if prod has 9600

### mDNS / Bonjour discovery

- Overkill for localhost-only communication

## Open Questions

1. **Port file cleanup on crash** — if the app crashes without cleaning up the port file, the next launch might read a stale file. Mitigation: include PID in port file, check if PID is alive before trusting it.

2. **Web standalone mode** — the baked port is the only option here (no Tauri IPC). Accept that web mode requires the default port to be available, or scan sequentially from the baked port on the client side.

3. **Max port increment range** — 10 feels reasonable. If all 10 are taken, something is very wrong and we should fail loudly.