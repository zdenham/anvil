# Progress 001

## Done
- Completed Spike A0: Verified Vite can alias `@tauri-apps/*` imports to shim modules
- Completed Phase A1: Created 10 shim modules in `src/lib/tauri-shims/` for all @tauri-apps packages
- Completed Phase A4: Created `web.html` entry point, `vite.config.web.ts` with all aliases
- Added `web:build` and `web:dev` scripts to package.json
- `pnpm web:build` succeeds — produces `dist-web/` output (3163 modules, 5.25s build)
- Marked Spike A0 and Phase A complete in the plan file
- Committed: ff71354

## Remaining
- Spike B0: Verify minimal Node.js WS server can serve commands to web frontend
- Phase B: Node.js sidecar server (B1–B4) — create `sidecar/` workspace with express+ws
- Phase C: Agent hub migration (C1–C3)
- Phase D: Rust WS removal, Tauri integration & final verification (D1–D3)

## Context
- No existing `sidecar/` directory — needs to be created as new pnpm workspace
- `server/` directory exists but is a separate deployment (Fly.io API server), not the sidecar
- Workspaces not defined in package.json yet (no `pnpm-workspace.yaml` either)
- Rust WS server protocol fully understood: `{id, cmd, args}` → `{id, result/error}`, push `{event, payload}`, relay `{relay, event, payload}`
- All ~91 commands mapped from Rust dispatch files (dispatch_fs, dispatch_git, dispatch_misc, dispatch_worktree, dispatch_agent)
- Shims provide functional web fallbacks: plugin-opener uses window.open(), plugin-dialog uses native file picker/confirm, plugin-http re-exports globalThis.fetch, plugin-shell logs warnings
