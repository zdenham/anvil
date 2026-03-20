# Progress 006

## Done

- Phase D2: Added sidecar auto-start to Tauri app (`spawn_sidecar()` in [lib.rs](http://lib.rs)) — spawns Node.js sidecar on startup, skips if already running on port, kills on exit. Added `SidecarProcess` managed state.
- Added `sidecar:dev` to `dev:run` concurrently command so `pnpm dev` starts sidecar automatically.
- Added `sidecar:build` to `dev:run:no-hmr` pre-build step.
- Fixed TypeScript overload compatibility error in `plugin-shell.ts` shim (implementation signature must be assignable from overload signatures).
- Phase D3: Verified all builds pass — `cargo check`, `pnpm web:build`, `pnpm build:frontend`, sidecar `tsc --noEmit` + `tsup`, agent hub integration tests (4/4 pass).
- Marked Phase C and D complete in main plan file.

## Remaining

- Full `pnpm tauri build` (production release build) not tested — only `cargo build` and `build:frontend` verified.
- FR6 (web view core workflow) not programmatically verified — web build succeeds but no smoke test that routes render.
- `broadcast.rs::subscribe()` is dead code (warning) — used to be called by the Rust WS server, can be removed.
- Sidecar production bundling: `spawn_sidecar()` currently resolves path via `CARGO_MANIFEST_DIR` which won't work in a release .app bundle. Needs resource bundling via tauri.conf.json or env-based path resolution for production.

## Context

- `spawn_sidecar()` uses `ureq` (already a dependency) for health checks — tries /health endpoint with 5s timeout.
- In dev mode, sidecar runs via `tsx` (file watching) from `dev:run`; Tauri detects it's already running and skips spawning.
- The `pnpm tauri build` production path needs sidecar bundling work before it can ship — this is deferred.