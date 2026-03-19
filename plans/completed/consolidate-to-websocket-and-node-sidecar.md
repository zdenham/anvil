# Consolidate to WebSocket & Node.js Sidecar

## Goal

Serve a fully functional web version of Mort that runs entirely on Node.js — no Rust process required. A browser + the Node.js sidecar is all you need. The Tauri desktop app continues to work, but delegates all data communication to the same Node.js sidecar (Tauri keeps only IPC for native OS features).

To get there, we **delete** the Rust WebSocket server and all Rust command dispatch code that the sidecar replaces. This is not a deprecation — the replaced Rust code is removed from the codebase.

**The sidecar is TypeScript.** All sidecar code is written in TypeScript with strict typing — no `any`, no untyped JS files. Command request/response types are shared between the sidecar and the frontend. This is not optional.

**Non-goals:**
- Replacing Tauri with Electron
- Supporting native-only features (spotlight, clipboard, accessibility, panels) in the web view

## Functional Requirements (Hard)

These are non-negotiable. The project is not complete until every item is verified working.

**FR1: Node.js sidecar handles ALL WebSocket communication**
- Standalone Node.js process (express + ws) replaces the Rust/axum WS server
- Same protocol: `{id, cmd, args}` → `{id, result/error}`, push events, relay events
- All ~91 data commands implemented (fs, git, terminal, agent, search, etc.)
- Both Tauri webview and web browsers connect to this server

**FR2: Web build compiles and runs without Tauri packages at runtime**
- All `@tauri-apps/*` imports resolve to shims via Vite aliases
- `pnpm web:build` succeeds; output loads in a browser

**FR3: Rust WS server and replaced dispatch code are deleted**
- `src-tauri/src/ws_server/` is deleted (axum server, dispatch, push, files)
- WS server startup removed from `src-tauri/src/lib.rs`
- All Rust command handlers that the sidecar replaces are deleted — not deprecated, not dead code, gone
- Tauri manages the sidecar as a child process instead

**FR4: Tauri desktop app continues working (no regressions)**
- Data commands go to Node.js sidecar via WS
- Native features stay on Tauri IPC (panels, clipboard, spotlight, hotkeys, tray)

**FR5: Agent hub works over WebSocket**
- Agents connect via `ws://localhost:{port}/ws/agent` (replaces Unix socket)
- Same message types preserved (register, event, log, relay, drain, heartbeat, etc.)
- Full round-trip verified: frontend → sidecar → agent → sidecar → frontend

**FR6: Web view supports the core workflow**
- Threads, agent output streaming, terminal panel, file browser, changes view, settings (subset)
- NOT supported: spotlight, clipboard manager, control panel, global hotkeys, system tray

**FR7: Build scripts and run configurations exist for both modes**
- `pnpm web:build` — produces a standalone web frontend (no Tauri dependencies)
- `pnpm sidecar:build` — produces a runnable Node.js sidecar
- `pnpm sidecar:dev` — starts the sidecar, prints the URL
- `pnpm web:dev` — starts Vite dev server for the web build
- `pnpm tauri dev` / `pnpm tauri build` — desktop app (Tauri + sidecar), still works

### Verification Matrix

**Every requirement must be verified with a concrete, reproducible test.** The project is incomplete if any item is assumed to work but not proven.

| Requirement | Verification |
| --- | --- |
| FR1 | Integration test: send each command category over WS, verify response |
| FR2 | `pnpm web:build` succeeds; open in browser with NO Rust process running; navigate threads |
| FR3 | `src-tauri/src/ws_server/` does not exist; `cargo build` succeeds without it |
| FR4 | Full manual walkthrough of Tauri app features after changes |
| FR5 | Spawn agent via sidecar, verify full lifecycle: register → events → permission → response → completion |
| FR6 | Open web view (no Tauri), create thread, run agent, use terminal, browse files |
| FR7 | All build/dev scripts work: `web:build`, `sidecar:build`, `sidecar:dev`, `web:dev`, `tauri dev` |

## Phases

- [ ] Spike A0: Verify Vite can alias `@tauri-apps/*` imports to shim modules
- [ ] Phase A: Web build & Tauri shimming (A1–A4)
- [ ] Spike B0: Verify minimal Node.js WS server can serve commands to the web frontend
- [ ] Phase B: Node.js sidecar server (B1–B4)
- [ ] Phase C: Agent hub migration (C1–C3)
- [ ] Phase D: Rust WS removal, Tauri integration & final verification (D1–D3)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Development Methodology

**Every phase begins with a spike.** Small, throwaway experiments that test critical assumptions. If a spike fails, re-evaluate before proceeding.

> The approach below is a starting point, not dogma. If a spike reveals a better path, update this plan.

```
1. SPIKE — time-boxed experiment, disposable code, clear yes/no answer
2. IMPLEMENT — real code, project conventions, tests alongside
3. VERIFY — integration tests, both Tauri and web modes, document results
```

---

## Architecture

```
┌──────────────────────────────────┐
│ Node.js Sidecar                  │
│ (express+ws, port 9600)          │
│ ~89 data commands, agent hub,    │
│ file serving, terminal PTY       │
└──────────┬───────────────────────┘
           │ WS (same protocol for both clients)
┌──────────┴───────────────────────────────────────┐
│ Frontend (React) — shared codebase               │
│ invoke() routes per command:                     │
│ • NATIVE_COMMANDS → Tauri IPC (if isTauri())     │
│ • Everything else → WebSocket (to Node.js)       │
│                                                  │
│ Two build targets:                               │
│ • Tauri build: full features (IPC + WS)          │
│ • Web build: main view only (WS + shims)         │
└──────────┬───────────────────────────────────────┘
           │ Tauri IPC (native only, when isTauri())
┌──────────┴───────────────────────┐
│ Tauri Desktop App                │
│ (NO Rust WS server — removed)   │
│ IPC only: panels, clipboard,    │
│ spotlight, hotkeys, tray, a11y  │
│ Manages sidecar as child process│
└──────────────────────────────────┘
```

|  | Tauri App | Web (Standalone) |
| --- | --- | --- |
| **Data commands** | WS to Node.js sidecar | WS to Node.js sidecar |
| **Native features** | Tauri IPC | Disabled (`NATIVE_DEFAULTS`) |
| **Agent hub** | WS to sidecar | WS to sidecar |
| **File serving** | Tauri asset protocol + sidecar `/files` | Sidecar `/files` |
| **Sidecar lifecycle** | Tauri starts/manages it | CLI or manual |

### What Already Works for Web

`isTauri()` runtime gating, `NATIVE_DEFAULTS` for 41 native commands, `browser-stubs.ts`, all data commands over WebSocket, events over WebSocket, `convertFileSrc()` HTTP fallback.

### What Blocks a Web Build Today

1. **35 files** import `@tauri-apps/*` — build fails without these modules
2. **10 files** use `plugin-shell` directly (`Command.create`) — needs WS alternative
3. **6 files** use `plugin-dialog` — needs web fallback (+ 1 test setup)
4. **2 files** use `plugin-http` (`fetch`) — gateway-channels SSE service
5. **No sidecar exists** — Rust WS is the only backend
6. **AgentHub uses Unix socket** — no WS transport
7. **No web entry point** — only multi-page Tauri build

---

## What Moves to the Sidecar vs Stays in Tauri

### Sidecar (~89 commands, +2 new shell commands = ~91)

| Category | Count | Node.js Approach |
| --- | --- | --- |
| Filesystem | 20 | Node `fs` |
| Git | 26 | `child_process.execFile('git')` |
| Terminal PTY | 6 | `node-pty` (stateful) |
| Agent process | 3 | `child_process.spawn` (stateful, streaming) |
| Agent hub routing | 3 | WS-native hub (replaces Unix socket) |
| File watching | 3 | `chokidar` (stateful) |
| Worktree | 5 | JSON + `git worktree` CLI |
| Shell env | 4 | `execSync` |
| Logging | 4 | In-memory buffer |
| Config/Identity | 3 | JSON file I/O |
| Process mgmt | 3 | `process.kill()`, memory stats |
| Thread | 2 | JSON file reads |
| Repository | 2 | Validate/remove repo data dirs |
| Locks | 2 | `proper-lockfile` |
| Search | 1 | `grep` via child_process |
| Diagnostics | 1 | In-memory config state |
| Misc | 1 | `run_internal_update` |
| Shell exec (NEW) | 2 | `child_process` — replaces `plugin-shell` |
| HTTP file serving | — | Express route (see B1) |

### Stays in Tauri Only (~41 commands)

Window/panel mgmt (13), spotlight (3), clipboard (5), accessibility (5), hotkeys (5), app search (3), onboarding (2), error panel (3), app lifecycle (2). Already return `NATIVE_DEFAULTS` when `isTauri()` is false.

---

## Phase A: Web Build & Tauri Shimming

### A1. Tauri Module Shims

Vite `resolve.alias` in web config points `@tauri-apps/*` to shim modules (~10 shims: core, window, event, path, app, plugin-shell, plugin-dialog, plugin-opener, plugin-http, plugin-global-shortcut). Each exports no-ops/stubs matching the Tauri API surface. Note: `plugin-http` shim must provide a working `fetch` wrapper (gateway-channels SSE depends on it).

### A2. Replace `plugin-shell` with WS Commands

10 files using `Command.create()` → `invoke("shell_exec"|"shell_spawn", ...)`. Some (spotlight, file browser reveal) can be gated with `isTauri()`. Includes 3 gh-cli files (`client.ts`, `executor.ts`, `webhooks.ts`), plus `quick-action-executor.ts`, `quick-actions-build.ts`, `pr-actions.ts`, `node-detection.ts`, `worktree-menus.tsx`, `spotlight.tsx`, `file-tree-node.tsx`.

### A3. Handle `plugin-dialog`

6 production files — gate behind `isTauri()`, show web-native file picker or text input fallback. Files: `main-window-layout.tsx`, `project-creation-service.ts`, `spotlight.tsx`, `RepositoryStep.tsx`, `repository-settings.tsx`, `empty-pane-content.tsx`.

### A4. Web Build Entry Point

`web.html` + `vite.config.web.ts` + `src/web-entry.tsx` — single-page, Main view only, no Tauri initialization.

---

## Phase B: Node.js Sidecar Server

### B1. Foundation

New `sidecar/` pnpm workspace, **100% TypeScript** (`strict: true` in tsconfig, no `.js` source files). Structure: `server.ts` (entry), `ws-handler.ts`, `dispatch.ts` (prefix-based router), `push.ts` (event broadcaster), `static.ts` (web build + `/files`), plus `dispatch/` and `managers/` subdirectories. Command request/response types shared between the sidecar and the frontend live in the existing `core/types/` package (not a new package).

WS protocol identical to current Rust server (which it replaces): `{id, cmd, args}` → `{id, result/error}`, push `{event, payload}`, relay `{relay, event, payload}`.

**`/files` HTTP endpoint:** Serves project files from disk for the frontend (file previews, image rendering, diff content). Route: `GET /files?path=<absolute-path>`. In Tauri mode the webview can also use the Tauri asset protocol for same-origin file access, but `/files` is the universal path both modes share. Content-type is inferred from extension. Access is scoped to the project root.

### B2. Port Commands (89 current + 2 new shell = ~91 total)

**Wave 1 — Stateless (75 commands).** Pure request→response, no session state. Direct translations from Rust.
- Filesystem (20): `fs_read_file`, `fs_write_file`, `fs_exists`, `fs_list_dir`, `fs_mkdir`, `fs_remove`, `fs_remove_dir_all`, `fs_move`, `fs_copy_file`, `fs_copy_directory`, `fs_is_git_repo`, `fs_git_worktree_add`, `fs_git_worktree_remove`, `fs_grep`, `fs_write_binary`, `fs_bulk_read`, `fs_get_repo_dir`, `fs_get_repo_source_path`, `fs_get_home_dir`, `fs_list_dir_names`
- Git (26): all `git_*` commands (diff, branch, worktree, ls-files, grep, etc.)
- Worktree (5): `worktree_create`, `worktree_delete`, `worktree_rename`, `worktree_touch`, `worktree_sync`
- Shell env (4): `initialize_shell_environment`, `is_shell_initialized`, `check_documents_access`, `get_shell_path`
- Logging (4): `web_log`, `web_log_batch`, `get_buffered_logs`, `clear_logs`
- Thread (2): `get_thread_status`, `get_thread`
- Search (1): `search_threads`
- Config/identity (3): `get_paths_info`, `get_agent_types`, `get_github_handle`
- Repository (2): `validate_repository`, `remove_repository_data`
- Process (3): `kill_process`, `get_process_memory`, `write_memory_snapshot`
- Misc (6): `lock_acquire_repo`, `lock_release_repo`, `run_internal_update`, `update_diagnostic_config`, `get_agent_socket_path`, and shell commands from B3

**Wave 2 — Stateful (13 commands).** Require session pools, streaming, or push events.
- Terminal (6): `spawn_terminal`, `write_terminal`, `resize_terminal`, `kill_terminal`, `kill_terminals_by_cwd`, `list_terminals` — node-pty session pool, output streams via broadcaster
- File watcher (3): `start_watch`, `stop_watch`, `list_watches` — chokidar, push events via broadcaster
- Agent process (3): `agent_spawn`, `agent_kill`, `agent_cancel` — child_process lifecycle, stdout/stderr streaming
- Agent hub routing (1+): `list_connected_agents`, `send_to_agent` — route through hub state

**Wave 3 — Agent Hub WS transport (Phase C).** WS endpoint at `/ws/agent?threadId=xxx`. Same message types, pipeline stamping, hierarchy tracking. Agent client (`agents/src/lib/hub/`) gets dual-mode: WS when `MORT_AGENT_HUB_WS_URL` set, Unix socket fallback.

### B3. Shell Commands

`shell_exec` → `{stdout, stderr, code}`. `shell_spawn` → push events (`shell_stdout:{id}`, `shell_stderr:{id}`, `shell_exit:{id}`).

### B4. Port Selection

CLI `--port` flag > `MORT_WS_PORT` env var (already used by Vite config, Rust server, and `browser-stubs.ts`) > default `9600`. Write `~/.mort/sidecar-{projectHash}.port` on startup, delete on clean shutdown. Web client derives WS URL from `window.location`. Agents get `MORT_AGENT_HUB_WS_URL` in env. Multi-instance / dynamic port discovery is deferred.

---

## Phase C: Agent Hub Migration

**C1.** Sidecar hub accepts agent WS connections on `/ws/agent`, routes to frontend WS broadcast, routes frontend→agent messages (permissions, cancels), tracks hierarchy + sequence numbers.

**C2.** Agent hub client: check `MORT_AGENT_HUB_WS_URL` → WS; else → Unix socket. Keep both transports during transition.

**C3.** Verify full round-trip: frontend → sidecar → agent → sidecar → frontend.

---

## Phase D: Tauri Integration, Rust Removal & Verification

### D1. Delete Rust WS Server

Delete `src-tauri/src/ws_server/` and all Rust command dispatch code the sidecar replaces. Remove WS server startup from `src-tauri/src/lib.rs`. Verify `cargo build` still succeeds.

**Sidecar lifecycle from Tauri:** Tauri spawns the sidecar via `std::process::Command` (not Tauri's built-in sidecar management, which requires bundling a binary). On startup, Tauri runs `node <path-to-sidecar-entry> --project <project-root> --port <port>`, waits for the sidecar to write its port file (`~/.mort/sidecar-{projectHash}.port`), then connects. On app quit, Tauri sends SIGTERM to the sidecar child process. The sidecar entry point is resolved relative to the app's resources directory (Tauri build) or the workspace root (dev mode). The Node.js binary is assumed to be on the user's PATH.

### D2. Build Scripts & Dev Workflows

Add to `package.json`:

- `pnpm sidecar:dev` — starts sidecar, prints URL
- `pnpm sidecar:build` — compiles sidecar to `dist-sidecar/`
- `pnpm web:dev` — Vite dev server for web build, proxies `/ws` to sidecar
- `pnpm web:build` — Vite build with Tauri shims → `dist-web/`

Existing scripts unchanged: `pnpm tauri dev`, `pnpm tauri build` (desktop, Tauri manages sidecar).

### D3. Final Verification

Run full verification matrix (see FR1–FR8 above). Additionally test: sidecar restart resilience (kill, restart, frontend reconnects). Verify web app works with **no Rust process running** — just Node.js sidecar + browser.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| node-pty behavior | Mature (VS Code uses it), spike early |
| WS agent hub reliability | Keep seq/pipeline stamping; spike before full build |
| Tauri import shim gaps | Spike A0; CI web build catches missing shims |
| Feature parity drift | Shared integration tests; compare responses during migration |
| Port conflicts | Fixed default port (9600), CLI/env override, port file cleanup on shutdown |
| Bundle size (dead desktop code) | Tree-shaking + `isTauri()` conditionals + lazy imports |

## Scale

~91 WS commands (89 existing + 2 new shell), ~10 shims, ~10 files for plugin-shell migration, ~6 for plugin-dialog, 1 new workspace (`sidecar/`), 1 new Vite config.
