# Consolidate to WebSocket & Node.js Sidecar

## Objective

Implement the full plan at `plans/consolidate-to-websocket-and-node-sidecar.md`. Serve a fully functional web version of Mort that runs entirely on Node.js — no Rust process required. A browser + the Node.js sidecar is all you need. The Tauri desktop app continues to work, but delegates all data communication to the same Node.js sidecar.

**All sidecar code is TypeScript** with strict typing — no `any`, no untyped JS files.

## Acceptance Criteria

Every item must be **programmatically verified** — no manual testing deferred.

1. **FR1: Node.js sidecar handles ALL WebSocket communication**
   - Standalone Node.js process (express + ws) replaces the Rust/axum WS server
   - Same protocol: `{id, cmd, args}` → `{id, result/error}`, push events, relay events
   - All ~91 data commands implemented (fs, git, terminal, agent, search, etc.)
   - Both Tauri webview and web browsers connect to this server
   - **Verified by**: Integration test sending each command category over WS

2. **FR2: Web build compiles and runs without Tauri packages at runtime**
   - All `@tauri-apps/*` imports resolve to shims via Vite aliases
   - `pnpm web:build` succeeds; output loads in a browser
   - **Verified by**: `pnpm web:build` succeeds in CI/script

3. **FR3: Rust WS server and replaced dispatch code are deleted**
   - `src-tauri/src/ws_server/` is deleted
   - WS server startup removed from `src-tauri/src/lib.rs`
   - `cargo build` still succeeds
   - **Verified by**: directory non-existence check + `cargo build` success

4. **FR4: Tauri desktop app continues working (no regressions)**
   - Data commands go to Node.js sidecar via WS
   - Native features stay on Tauri IPC
   - **Verified by**: `pnpm tauri build` succeeds (compile check)

5. **FR5: Agent hub works over WebSocket**
   - Agents connect via `ws://localhost:{port}/ws/agent`
   - Full round-trip verified: frontend → sidecar → agent → sidecar → frontend
   - **Verified by**: Integration test spawning agent, verifying lifecycle

6. **FR6: Web view supports the core workflow**
   - Threads, agent output streaming, terminal panel, file browser, changes view, settings
   - **Verified by**: Web build loads and core routes render (programmatic check)

7. **FR7: Build scripts and run configurations exist**
   - `pnpm web:build`, `pnpm sidecar:build`, `pnpm sidecar:dev`, `pnpm web:dev`
   - `pnpm tauri dev` / `pnpm tauri build` still work
   - **Verified by**: Each script exists and runs without error

## Phases (from plan)

- Spike A0: Verify Vite can alias `@tauri-apps/*` imports to shim modules
- Phase A: Web build & Tauri shimming (A1–A4)
- Spike B0: Verify minimal Node.js WS server can serve commands to the web frontend
- Phase B: Node.js sidecar server (B1–B4)
- Phase C: Agent hub migration (C1–C3)
- Phase D: Rust WS removal, Tauri integration & final verification (D1–D3)

## Codebase Context

- **Monorepo**: Root (Tauri+React), `agents/`, `core/`, `server/`, `migrations/`
- **Existing WS server**: `src-tauri/src/ws_server/` (13 Rust files: dispatch, push, types, files)
- **browser-stubs.ts**: `src/lib/browser-stubs.ts` — already has `isTauri()` gating, `convertFileSrc()` HTTP fallback
- **Vite config**: `vite.config.ts` — multi-page (5 entry points), port 1420, WS port 9600
- **No pnpm-workspace.yaml** — workspaces defined in package.json
- **Existing adapters**: `core/adapters/` pattern for dependency injection
- **Agent hub**: `src-tauri/src/agent_hub.rs` (31KB) — currently Unix socket based
- **WS port env var**: `MORT_WS_PORT` (default 9600) already used across codebase
- **35 files** import `@tauri-apps/*`, 10 use `plugin-shell`, 6 use `plugin-dialog`
