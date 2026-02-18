# HMR (Hot Module Replacement) Not Working — Diagnosis & Fix

## Diagnosis

### Dev Pipeline Flow

When you run `pnpm dev`:

1. `dev-mort.sh dev` sources `scripts/env-presets/dev.sh` setting:
   - `MORT_VITE_PORT=1421`
   - `MORT_APP_SUFFIX=dev`
   - `MORT_SKIP_MAIN_WINDOW=1`
2. Sets `TAURI_ARGS="--config src-tauri/tauri.conf.dev.json"`
3. Runs `pnpm dev:run` which uses `concurrently` to start:
   - `pnpm dev:agents` (watches agents/)
   - `pnpm dev:sdk` (watches core/sdk/)
   - `pnpm dev:migrations` (watches migrations/)
   - `tauri dev --config src-tauri/tauri.conf.dev.json`
4. `tauri dev` runs `beforeDevCommand: "vite"` → Vite starts on port **1421**
5. Tauri webview loads `http://localhost:1421` (from `tauri.conf.dev.json`)
6. HMR WebSocket configured on port **1422** (`vitePort + 1`)

### Root Cause: Port Mismatch Between Tauri devUrl and Vite HMR

**The HMR port configuration creates a mismatch that Tauri's webview cannot resolve.**

In `vite.config.ts` (lines 50-62):

```typescript
hmr: disableHmr
  ? false
  : host
    ? { protocol: "ws", host, port: vitePort + 1 }
    : vitePort !== 1420
      ? { port: vitePort + 1 }
      : undefined,
```

When `MORT_VITE_PORT=1421` (the dev preset):
- `TAURI_DEV_HOST` is NOT set → skips the first branch
- `vitePort !== 1420` is TRUE → takes the second branch
- HMR is configured with **only** `{ port: 1422 }` — no `host` or `protocol` specified

The problem: **Vite's HMR client in the browser/webview needs to know where to open its WebSocket connection.** When only `port` is specified but `host` is omitted, the HMR client infers the host from `window.location.host`, which in Tauri's webview resolves to `localhost:1421`. The WebSocket then tries to connect to `ws://localhost:1422/`, but because Vite's HTTP server is on 1421 and the HMR WebSocket server is a separate listener on 1422, there's a subtle issue:

**The separate HMR port (1422) requires that Vite actually starts a WebSocket server on that port.** Vite does this, but the Tauri webview's security context may block cross-port WebSocket connections or fail to establish them reliably. In a standard browser tab, this works fine because the browser's security model allows `ws://localhost:*` freely. In Tauri's WKWebView (macOS), the behavior can differ.

### Secondary Contributing Factor: No HMR Port Needed for localhost

The reason the HMR config has `vitePort + 1` at all is the comment pattern from the Tauri Vite template, which is designed for mobile development where `TAURI_DEV_HOST` is set. **For desktop development with `devUrl: "http://localhost:1421"`, there is no need for a separate HMR port.** The HMR WebSocket can run on the same port as the Vite server (the default behavior when `hmr` is `undefined`).

### Why `vitePort !== 1420` Branch Exists (and Why It's Wrong)

This branch was likely added to handle the case where a non-default port is used, assuming a separate HMR port would avoid conflicts. But Vite's default behavior (when `hmr` is `undefined`) already handles this correctly — it runs the HMR WebSocket on the **same** port as the HTTP server, regardless of what port that is.

### Verified Non-Issues

- **NSPanels / WebviewUrl::App**: The `tauri-nspanel` PanelBuilder delegates to `WebviewWindowBuilder`, which correctly resolves `WebviewUrl::App("spotlight.html")` against the `devUrl` in dev mode. Not the issue.
- **CSP**: `tauri.conf.json` has `"csp": null` — no content security restrictions.
- **HTTPS mixed content**: Desktop dev mode loads from `http://localhost:1421`, not `https://tauri.localhost`. Not applicable.
- **File watcher**: `watch.ignored` only ignores `**/src-tauri/**`, which is correct.
- **Environment variable propagation**: `concurrently` inherits the parent environment, so `MORT_VITE_PORT=1421` reaches the `vite` command.

---

## Proposed Fix

### Option A: Simplify HMR Config (Recommended)

Remove the `vitePort !== 1420` branch entirely. There's no reason to use a separate HMR port for desktop development. The separate port is only needed when `TAURI_DEV_HOST` is set (mobile dev).

**File: `vite.config.ts`, lines 50-62**

Change from:
```typescript
hmr: disableHmr
  ? false
  : host
    ? {
        protocol: "ws",
        host,
        port: vitePort + 1,
      }
    : vitePort !== 1420
      ? {
          port: vitePort + 1,
        }
      : undefined,
```

Change to:
```typescript
hmr: disableHmr
  ? false
  : host
    ? {
        protocol: "ws",
        host,
        port: vitePort + 1,
      }
    : undefined,
```

This lets Vite use its default HMR behavior (WebSocket on the same port as the HTTP server) for all desktop development, regardless of which port is used.

### Option B: Explicitly Set clientPort (Alternative)

If a separate HMR port is desired for some reason, the config needs `clientPort` so the HMR client in the webview knows to connect back to the right place:

```typescript
: vitePort !== 1420
  ? {
      port: vitePort + 1,
      clientPort: vitePort + 1,
    }
  : undefined,
```

### Recommendation

**Option A** is simpler and eliminates the unnecessary complexity. The separate HMR port pattern only makes sense for mobile development where the webview runs on a different device/host than the dev server.

## Phases

- [ ] Apply the fix to `vite.config.ts`
- [ ] Verify HMR works with `pnpm dev`
- [ ] Verify `dev:no-hmr` mode still works (regression check)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## References

- [Tauri v2 Develop docs](https://v2.tauri.app/develop/)
- [Vite HMR Troubleshooting](https://vite.dev/guide/troubleshooting)
- [Tauri + Vite setup guide](https://v2.tauri.app/start/frontend/vite/)
- [tauri-nspanel PanelBuilder](https://github.com/ahkohd/tauri-nspanel) — uses `WebviewWindowBuilder` internally, resolves `WebviewUrl::App` against `devUrl` in dev mode
- [Tauri WebSocket HMR issue #11165](https://github.com/tauri-apps/tauri/issues/11165)
