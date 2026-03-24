# Fix: Gateway Channel "TypeError: Load failed"

## Problem

On app startup, entity hydration fails for every repository with:

```
[entities:hydrate] Failed to ensure gateway channel for anvil: TypeError: Load failed
```

The error appears in all three webview windows (spotlight, control-panel, main), indicating a systemic failure rather than a transient network issue.

## Root Cause

The `GatewayChannelService.create()` method (`src/entities/gateway-channels/service.ts:85`) uses the browser's native `fetch()` to POST to `https://anvil-server.fly.dev/gateway/channels`.

**Tauri v2 blocks external `fetch()` requests from the webview by default.** The app is missing the `@tauri-apps/plugin-http` Tauri plugin, which is required to make HTTP requests to external origins from the frontend.

Evidence:
- `src-tauri/Cargo.toml` has no `tauri-plugin-http` dependency
- `package.json` has no `@tauri-apps/plugin-http` dependency
- `src-tauri/capabilities/default.json` has no HTTP permissions
- `src-tauri/src/lib.rs` plugin registration has no `.plugin(tauri_plugin_http::init())`
- The only other external `fetch()` in the codebase is a localhost dev-server check in spotlight.tsx — which works because localhost is same-origin
- The gateway server itself is reachable (confirmed via curl — returns 404 on GET, which is expected for a POST-only endpoint)

Setting `"csp": null` in `tauri.conf.json` disables the Content Security Policy but does **not** bypass Tauri v2's IPC-based network isolation. The `fetch()` call fails at the Tauri layer before any network request is made, producing the generic `TypeError: Load failed`.

The `GatewayClient` SSE connection (`core/gateway/client.ts:86`) uses the same `fetch()` pattern and would also fail for the same reason, but doesn't currently trigger because channel creation fails first (no channels exist to activate).

## Affected Code Paths

1. **Channel creation** — `src/entities/gateway-channels/service.ts:85` — `fetch()` POST to register channel
2. **SSE streaming** — `core/gateway/client.ts:86` — `fetch()` GET for event stream
3. **Hydration caller** — `src/entities/index.ts:180` — `ensureGatewayChannelForRepo()` catches and logs the error

## Phases

- [x] Add `tauri-plugin-http` Rust dependency and register the plugin
- [x] Add `@tauri-apps/plugin-http` npm dependency
- [x] Configure HTTP permissions in capabilities
- [x] Replace native `fetch()` with the Tauri HTTP plugin's `fetch()` in gateway service and client
- [x] Verify the fix compiles and the gateway channel creation succeeds

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Add Rust dependency and register plugin

**`src-tauri/Cargo.toml`** — Add to `[dependencies]`:
```toml
tauri-plugin-http = "2"
```

**`src-tauri/src/lib.rs`** — Add to the plugin chain (alongside existing plugins around line 747):
```rust
.plugin(tauri_plugin_http::init())
```

### Phase 2: Add npm dependency

```sh
pnpm add @tauri-apps/plugin-http
```

### Phase 3: Configure HTTP permissions

**`src-tauri/capabilities/default.json`** — Add to `permissions` array:
```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "https://anvil-server.fly.dev/*" }
  ]
}
```

This scopes HTTP access to only the gateway server, following the principle of least privilege.

### Phase 4: Replace `fetch()` calls

There are two locations that need updating:

**`src/entities/gateway-channels/service.ts`** — Channel creation POST:
```typescript
import { fetch } from "@tauri-apps/plugin-http";
```
The Tauri HTTP plugin provides a drop-in `fetch()` replacement with the same API signature, so the call site at line 85 needs no changes — only the import.

**`core/gateway/client.ts`** — SSE streaming fetch:
This is trickier because `core/` is a shared package used by both the Tauri frontend and Node.js agents. Options:

**Option A (Recommended): Inject `fetch` via constructor options**
Add an optional `fetch` parameter to `GatewayClientOptions`. The Tauri frontend passes the plugin's `fetch`, while Node.js callers use the global `fetch`. Default to `globalThis.fetch` for backward compatibility.

```typescript
export interface GatewayClientOptions {
  // ... existing options ...
  /** Custom fetch implementation (e.g. Tauri HTTP plugin). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}
```

Then in `startStream()` at line 86:
```typescript
const fetchFn = this.options.fetch ?? globalThis.fetch;
const response = await fetchFn(url, { ... });
```

And in `gateway-client-lifecycle.ts`, when constructing the client:
```typescript
import { fetch } from "@tauri-apps/plugin-http";

gatewayClient = new GatewayClient({
  // ... existing options ...
  fetch,
});
```

**Option B: Conditional import based on environment**
Less clean — requires environment detection and dynamic imports. Not recommended.

### Phase 5: Verify

- Run `cargo build` in `src-tauri/` to confirm Rust compilation
- Run `pnpm build` to confirm frontend compilation
- Launch the app and confirm the "Load failed" errors are gone from logs
- Verify a gateway channel is created and SSE connection is established
