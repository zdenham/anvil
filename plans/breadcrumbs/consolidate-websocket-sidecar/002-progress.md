# Progress 002

## Done
- Created `sidecar/` workspace: package.json (@mort/sidecar), tsconfig.json (strict), tsup.config.ts
- Built full WS server foundation: server.ts (express+ws on port 9600), ws-handler.ts, dispatch.ts (prefix router), push.ts (EventBroadcaster), types.ts, helpers.ts, state.ts
- Implemented all ~91 command dispatchers across 5 domain files:
  - dispatch-fs.ts: 20 fs commands (read, write, mkdir, remove, grep, bulk_read, repo paths, etc.)
  - dispatch-git.ts: 26 git commands (branches, diffs, worktrees, grep, ls-files, etc.) + git-helpers.ts
  - dispatch-worktree.ts: 5 worktree commands (create, delete, rename, touch, sync)
  - dispatch-agent.ts: 3 agent commands (spawn, kill, cancel)
  - dispatch-misc.ts: ~37 misc commands (paths, threads, repos, search, identity, locks, shell, logging, process, diagnostics, agent hub stubs)
- Created managers: lock-manager.ts (file-based locks with expiry), agent-process-manager.ts (spawn/kill/cancel with SIGTERM→SIGKILL escalation)
- Created paths.ts helper (MORT_DATA_DIR, config dir, repositories, threads)
- Server includes /files HTTP endpoint, /health check, CORS, graceful shutdown

## Remaining
- Install dependencies (`cd sidecar && pnpm install`)
- TypeScript compilation verification (`pnpm build`)
- Fix any compile errors (there's a `require()` in dispatch-misc.ts checkDocumentsAccess that needs fixing for ESM)
- Add `sidecar:dev` and `sidecar:build` scripts to root package.json
- Update pnpm-workspace.yaml or root package.json to include sidecar workspace
- Integration test: start sidecar, connect from web frontend, verify commands work
- Mark Spike B0 and Phase B complete in plan file
- Phase C: Agent hub WS migration (C1–C3)
- Phase D: Rust WS removal, Tauri integration, final verification (D1–D3)

## Context
- All dispatch functions mirror Rust signatures exactly (same arg names, same return shapes)
- `send_to_agent` is stubbed — needs Phase C agent hub WS transport
- No terminal manager or file watcher manager yet — agent-process-manager handles agent spawning, but terminal PTY (node-pty) and chokidar file watching are not implemented
- Server uses express 5 + ws library (not socket.io)
- The `checkDocumentsAccess` function in dispatch-misc.ts uses `require()` which won't work in ESM — needs to use dynamic import or fs import
