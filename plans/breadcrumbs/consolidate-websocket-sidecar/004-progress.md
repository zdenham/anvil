# Progress 004

## Done
- Phase C2: Added WebSocket transport to agent hub connection (`agents/src/lib/hub/connection.ts`) — dual-mode: detects `ws://` URLs vs Unix socket paths. Added `ws` dependency to agents package. Updated `core/lib/socket.ts` with `MORT_AGENT_HUB_WS_URL` env var and `isWebSocketEndpoint()` helper. Updated `client.ts` to skip `existsSync` for WS endpoints.
- Phase C3: Integration test (`sidecar/src/__tests__/agent-hub-roundtrip.test.ts`) — verifies agent registration, event push (agent→frontend), send_to_agent (frontend→agent), and WS URL discovery. All 4 tests pass.
- Fixed `server.ts` to use `noServer` WS routing (path-based `handleUpgrade`) — the previous `WebSocketServer({ server, path })` pattern caused 400 errors with Express.
- Phase D1 (partial): Extracted `EventBroadcaster` to `src-tauri/src/broadcast.rs` and `AgentProcessMap` to `src-tauri/src/agent_processes.rs`. Deleted `src-tauri/src/ws_server/` (11 files) and `src-tauri/src/agent_hub.rs`. Updated `lib.rs` module declarations, removed AgentHub startup/cleanup code, stubbed out agent IPC commands.

## Remaining
- Phase D1 (finish): Update remaining Rust modules that reference `crate::ws_server::push::EventBroadcaster` → `crate::broadcast::EventBroadcaster`: logging/mod.rs, clipboard.rs, file_watcher.rs, panels.rs, tray.rs, terminal.rs. Update `process_commands.rs` to use `crate::agent_processes::AgentProcessMap`. Remove `agent_hub::update_diagnostic_config` from invoke_handler in lib.rs. Remove `diagnostic_config` managed state.
- Phase D2: Verify Tauri delegates data commands to sidecar (may need sidecar auto-start)
- Phase D3: Verify `cargo build`, `pnpm tauri build`, `pnpm web:build` all succeed
- Remove unused Cargo dependencies (axum, tower-http, futures-util) from src-tauri/Cargo.toml

## Context
- `broadcast.rs` is identical to old `ws_server/push.rs` minus the `to_ws_message()` fn and axum import
- Agent IPC commands (`send_to_agent`, `list_connected_agents`, `get_agent_socket_path`) are now stubs in lib.rs — they return no-ops since sidecar handles agent communication
- The `diagnostic_config` Tauri managed state came from AgentHub and is now removed — any modules referencing it will need updating
- `cargo build` will NOT pass yet — the Rust reference updates are incomplete
