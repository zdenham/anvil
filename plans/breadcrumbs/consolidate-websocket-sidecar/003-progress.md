# Progress 003

## Done
- Fixed ESM `require("node:fs")` in dispatch-misc.ts → top-level `readdirSync` import
- Created `pnpm-workspace.yaml` with all workspace packages
- Added `sidecar:build` and `sidecar:dev` scripts to root package.json
- Installed sidecar dependencies via pnpm
- Verified sidecar: `tsc --noEmit` clean, `tsup` build succeeds, server starts and serves WS commands (tested health, get_paths_info, fs_read_file, fs_list_dir, get_github_handle, get_process_memory)
- Phase C1: Created `sidecar/src/managers/agent-hub.ts` — AgentHub class with connection tracking, pipeline stamping, sequence gap detection, relay routing, frontend-to-agent messaging
- Phase C1: Added `/ws/agent` WebSocket endpoint to server.ts
- Phase C1: Wired `send_to_agent` and `list_connected_agents` in dispatch-misc.ts to AgentHub
- Phase C1: Updated state.ts to include AgentHub in SidecarState
- All builds and type-checks pass

## Remaining
- Phase C2: Update `agents/src/lib/hub/connection.ts` to support WebSocket transport via `ANVIL_AGENT_HUB_WS_URL` env var (dual-mode: WS or Unix socket)
- Phase C3: Integration test — full round-trip: frontend → sidecar → agent → sidecar → frontend
- Phase D1: Delete `src-tauri/src/ws_server/` and remove WS startup from lib.rs
- Phase D2: Update Tauri to delegate data commands to sidecar
- Phase D3: Verify `cargo build`, `pnpm tauri build`, `pnpm web:build` all succeed
- Mark phases complete in plan file

## Context
- `isRequest()` in types.ts requires numeric `id` field (not string) — matches frontend invoke.ts which uses `++requestId`
- Port 9600 is typically occupied by existing Rust WS server in dev; tested sidecar on 9650
- AgentHub broadcasts agent messages as `agent:message` push events — frontend agent-service.ts already listens for this event name
- The agent HubConnection (`agents/src/lib/hub/connection.ts`) uses newline-delimited JSON over Unix socket; WS transport needs to send individual JSON messages (no newline framing needed)
