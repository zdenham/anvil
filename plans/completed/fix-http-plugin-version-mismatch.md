# Fix: HTTP Plugin Version Mismatch (`streamChannel` error)

## Problem

The `PrAutoAddressToggle` fails when enabling auto-address because the Tauri HTTP plugin's Rust crate and JavaScript package are out of sync:

| Component | Version |
|---|---|
| `@tauri-apps/plugin-http` (JS) | **2.5.7** |
| `tauri-plugin-http` (Rust/Cargo.lock) | **2.5.4** |

The JS side (v2.5.7) sends a `streamChannel` parameter to `fetch_read_body` that the Rust side (v2.5.4) doesn't expect yet. This causes:

```
command fetch_read_body missing required key streamChannel
```

The second error (`http.fetch_cancel_body not allowed. Command not found`) is a cascade — the JS code tries to clean up after the failed body read, but the cancel command name also changed between these versions.

This is a [known issue](https://github.com/tauri-apps/plugins-workspace/issues/2546) in the Tauri plugins workspace — the Rust and JS packages must be at the **same version**.

## Root Cause

`Cargo.toml` specifies `tauri-plugin-http = "2"` (line 40), which resolved to **2.5.4** in `Cargo.lock`. Meanwhile `package.json` specifies `"@tauri-apps/plugin-http": "^2.5.7"`, which resolved to **2.5.7**. The JS bindings at 2.5.7 send parameters that the 2.5.4 Rust handler doesn't recognize.

## Phases

- [x] Pin `tauri-plugin-http` in `Cargo.toml` to `"2.5.7"` (matching the JS version) and run `cargo update -p tauri-plugin-http` to update `Cargo.lock`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix Details

**File: `src-tauri/Cargo.toml`** (line 40)

Change:
```toml
tauri-plugin-http = "2"
```
To:
```toml
tauri-plugin-http = "=2.5.7"
```

Then run:
```bash
cd src-tauri && cargo update -p tauri-plugin-http
```

This pins the Rust crate to exactly 2.5.7, matching the JS package. The `=` prefix ensures Cargo resolves to this exact version rather than a semver-compatible range.

### Why not downgrade JS instead?

Pinning up is preferred because 2.5.7 includes the streaming improvements (`streamChannel`) that the gateway SSE client actually needs for proper body streaming behavior.
