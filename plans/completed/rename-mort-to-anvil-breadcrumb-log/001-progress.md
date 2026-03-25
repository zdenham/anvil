# Progress 001

## Done

- Phase 1 complete: All Rust backend files renamed (Cargo.toml, [build.rs](http://build.rs), all .rs files in src-tauri/src/)
- Phase 2 complete: Tauri config files (tauri.conf.json, tauri.conf.dev.json)
- Phase 3 complete: All package.json name fields (root, agents, sidecar, migrations, core/sdk, server, api)
- Phase 4 partial: Vite/Vitest configs done (vite.config.ts, vite.config.web.ts, vitest.config.ts, vitest.config.ui.ts, src/vite-env.d.ts)
- Phase 4 remaining: Many TS files still reference MORT\_ env vars (see list below)
- Infrastructure URLs left as-is with TODO(anvil-rename) comments per plan

## Remaining

- Phase 4 remaining files with MORT\_ env vars: sidecar/src/server.ts, sidecar/src/logger.ts, sidecar/src/managers/terminal-manager.ts, sidecar/src/dispatch/paths.ts, sidecar/src/dispatch/dispatch-misc.ts, agents/src/runner.ts, agents/src/lib/persistence-node.ts, migrations/src/runner.ts, core/lib/socket.ts, core/lib/socket.test.ts, core/lib/mort-dir.ts, core/types/index.ts, src/lib/agent-service.ts, src/lib/claude-tui-args-builder.ts, src/lib/browser-stubs.ts, src/lib/invoke.ts, src/components/spotlight/spotlight.tsx, scripts/dev-mort.sh, scripts/build-mort.sh, scripts/env-presets/dev.sh
- Phases 5-18 entirely remaining (core library, agents, frontend, plugins, scripts, docs, plans, test fixtures, file renames, data migration, infra TODOs, git branch convention, build verification, [CLAUDE.md](http://CLAUDE.md))

## Context

- 3 commits made: da6d141 (Phase 1), 23c4353 (Phase 2), 5d204bc (Phases 3-4 partial)
- Plan file phases not yet marked complete (should be done once each phase is fully done)
- The **MORT_APP_SUFFIX** and **MORT_WS_PORT** defines are used in src/ code — those references also need updating in the TS source files that consume them
- `mortDir` variable names and `mort-repl` string constants are widespread in agents/ and src/