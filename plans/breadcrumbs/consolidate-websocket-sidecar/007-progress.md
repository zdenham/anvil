# Progress 007

## Done

- Removed dead `subscribe()` from `broadcast.rs` — was the only dead code warning, `cargo check` now 0 warnings.
- Fixed sidecar production path resolution: `spawn_sidecar()` now accepts `&tauri::App` and uses `app.path().resolve()` with `BaseDirectory::Resource` in release builds (was using `CARGO_MANIFEST_DIR` which only works in dev).
- Moved sidecar spawn from pre-builder into `setup()` closure where App handle is available.
- Added `../sidecar/dist/**/*` and `../sidecar/package.json` to `tauri.conf.json` bundle resources.
- Added `scripts/verify-web-build.sh` and `pnpm verify:web` for FR6 programmatic verification — checks HTML structure, asset existence, no leaked `@tauri-apps/` imports, core modules in bundle, bundle size sanity.
- Added `vitest.config.ts` and `pnpm test` script to sidecar workspace so agent hub integration tests are runnable.

## Remaining

- Full `pnpm tauri build` (production release build) not tested — only `cargo check` and `build:frontend` verified.
- FR6 runtime rendering not tested — verification script checks build output structure only, not actual DOM rendering.
- `EventBroadcaster` in Rust is still used by [terminal.rs](http://terminal.rs), file_watcher.rs, [clipboard.rs](http://clipboard.rs), [panels.rs](http://panels.rs), [tray.rs](http://tray.rs), logging — but events go nowhere since WS server was removed. These Tauri modules may be dead code now that the sidecar handles all data commands. Larger cleanup deferred.
- Sidecar `node_modules/` not bundled in Tauri resources — only `dist/` is bundled. Production sidecar runs pure `node dist/server.js` and assumes dependencies are available (may need esbuild bundling to produce a single-file output for production).

## Context

- `cfg!(debug_assertions)` + `app.path().resolve("_up_/...", BaseDirectory::Resource)` is the established Tauri pattern for dev/prod path resolution (same pattern used by `run_ts_migrations`).
- Sidecar vitest uses `vitest ^4.1.0` (same major as root workspace).
- All 6 verification checks pass: cargo check, web:build, verify:web, sidecar:build, sidecar tsc, sidecar tests (4/4).