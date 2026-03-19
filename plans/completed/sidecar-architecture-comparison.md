# Sidecar Architecture: Full Comparison

Deep-dive comparison of 5 parallel implementations of the "Consolidate to WebSocket & Node.js Sidecar" refactor.

---

## Architecture Overview

All 5 implementations share the same high-level architecture. The refactor moves command execution from Rust into a Node.js sidecar process, with WebSocket as the transport layer.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Tauri Desktop App                            │
│                                                                     │
│  ┌──────────────────────────┐    ┌────────────────────────────────┐ │
│  │     Rust (src-tauri/)     │    │    React Frontend (src/)       │ │
│  │                           │    │                                │ │
│  │  ┌─────────────────────┐  │    │  ┌──────────────────────────┐ │ │
│  │  │   Native Commands   │  │    │  │     invoke(cmd, args)    │ │ │
│  │  │  - Window mgmt      │◄─┼────┼──│                          │ │ │
│  │  │  - Hotkeys           │ IPC  │  │  Routes:                 │ │ │
│  │  │  - Panels            │  │   │  │  - Native → Tauri IPC    │ │ │
│  │  │  - Clipboard         │  │   │  │  - Data   → WebSocket    │ │ │
│  │  │  - Accessibility     │  │   │  └──────────┬───────────────┘ │ │
│  │  └─────────────────────┘  │    │             │ WS               │ │
│  │                           │    └─────────────┼─────────────────┘ │
│  │  ┌─────────────────────┐  │                  │                   │
│  │  │  Sidecar Lifecycle  │  │                  │                   │
│  │  │  - spawn(node ...)  │  │                  │                   │
│  │  │  - SIGTERM/SIGKILL  │  │                  │                   │
│  │  │  - Port file read   │  │                  │                   │
│  │  └────────┬────────────┘  │                  │                   │
│  └───────────┼───────────────┘                  │                   │
│              │ spawn                            │                   │
└──────────────┼──────────────────────────────────┼───────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Node.js Sidecar Process                          │
│                                                                      │
│  ┌─────────────┐  ┌────────────────────────────────────────────────┐ │
│  │ Express HTTP │  │            WebSocket Server                    │ │
│  │  /files      │  │                                                │ │
│  │  /health     │  │  /ws ─────────────► Command Dispatch           │ │
│  └─────────────┘  │  │                   ┌──────────────────────┐  │ │
│                    │  │                   │  fs_*    → FS cmds   │  │ │
│                    │  │                   │  git_*   → Git cmds  │  │ │
│                    │  │                   │  shell_* → Shell     │  │ │
│                    │  │                   │  agent_* → Agents    │  │ │
│                    │  │                   │  *_terminal → PTY    │  │ │
│                    │  │                   │  *_watch   → Choki.  │  │ │
│                    │  │                   │  misc      → Catch   │  │ │
│  ┌─────────────┐  │  │                   └──────────────────────┘  │ │
│  │ Port File   │  │  │                                              │ │
│  │ ~/.mort/    │  │  /ws/agent ────────► Agent Hub                  │ │
│  │  sidecar-   │  │                      ┌─────────────────────┐   │ │
│  │  {hash}.port│  │                      │ register/relay/drain│   │ │
│  └─────────────┘  │                      │ pipeline stamping   │   │ │
│                    │                      │ sequence gap detect │   │ │
│  ┌─────────────────┤                     └──────────┬──────────┘   │ │
│  │    Managers      │                               │               │ │
│  │  TerminalMgr     │                               │               │ │
│  │  WatcherMgr      │         ┌─────────────────────┘               │ │
│  │  AgentProcessMgr │         │                                     │ │
│  │  LockMgr         │         │  ┌───────────────────────────────┐  │ │
│  │  EventBroadcaster│◄────────┘  │    Agent Processes (child)    │  │ │
│  └──────────────────┘            │  node agent-runner.js          │  │ │
│                                  │  Connects back to /ws/agent    │  │ │
│                                  └───────────────────────────────┘  │ │
└──────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │   Browser Web Build   │
                    │  (No Tauri — WS only) │
                    │                       │
                    │  Same React app       │
                    │  invoke() → WS only   │
                    │  Tauri API shims      │
                    │  /files for assets    │
                    └───────────┬───────────┘
                                │ WS
                                ▼
                     ws://127.0.0.1:9600/ws
```

### Shared Protocol

```
Request:   { id: number, cmd: string, args: Record<string, unknown> }
Response:  { id: number, result?: unknown, error?: string }
Push:      { event: string, payload: unknown }
Relay:     { relay: true, event: string, payload: unknown }
```

---

## Decision Comparison Matrix

### A. Server Setup

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **HTTP framework** | Raw `http.createServer` | Express | Express | Express | Express |
| **WS library** | ws 8.18.0 | ws 8.18.0 | ws 8.18.0 | ws 8.18.0 | ws 8.18.2 |
| **WS server mode** | noServer | noServer | noServer | noServer | noServer |
| **Default port** | 9600 | 9600 | 9600 | 9600 | 9600 |
| **Port override** | CLI `--port` &gt; env &gt; default | CLI &gt; env &gt; default | env &gt; default | env &gt; default | CLI &gt; env &gt; default |
| **CORS** | `*` on all routes | `*` (too open) | Permissive (mirrors Rust) | Not mentioned | Not mentioned |
| **Health endpoint** | No | No | No | `/health` | No |
| **Sidecar LOC** | \~2,029 | \~4,161 | \~2,500 | \~3,420 | \~2,405 |

### B. Port Discovery / IPC

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Port file path** | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` |
| **Hash algorithm (Node)** | simpleHash (custom) | SHA-256 (12 chars) | SHA-256 (12 chars) | SHA-256 (12 chars) | SHA-256 (12 chars) |
| **Hash algorithm (Rust)** | simpleHash (matching) | build_info + port file | build_info + port file | **DefaultHasher (SipHash)** | build_info + env var |
| **Hash mismatch?** | No | No | No | **YES — showstopper** | No |
| **Rust readiness check** | None (fire & forget) | None (no readiness probe) | None | Polls port file 15s | None |
| **Port passed to Node via** | CLI `--port` | CLI `--port` + env | env `MORT_WS_PORT` | CLI `--port` + `--project` | env `MORT_SIDECAR_PORT` |
| **Port baked in frontend** | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) |

### C. Command Dispatch

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Routing pattern** | `Map<string, Handler>` registry | Prefix-based switch | Prefix-based switch | `Map<prefix, Dispatcher>` registry | Prefix-based if-chain |
| **Entry point** | `registerAll()` + Map lookup | `dispatchInner()` with if/switch | `dispatch()` with if/switch | `registerDispatcher()` + Map iteration | `dispatch()` with if-chain |
| **Commands implemented** | \~91 | \~86 of \~91 | \~70+ | \~100 | \~93 |
| **Arg validation** | `extractArg<T>` (cast) | `extractArg<T>` (cast) | `extractArg<T>` (cast) | `extractString/Number` (typed) | `extractArg<T>` (cast) |
| **Zod at boundary?** | No | No | No | No | No |
| **Unknown cmd handling** | Throws error | Falls through to misc | Falls through to misc | Falls through to misc | Falls through to misc |
| **Dispatch file count** | 1 router + 8 handler files | 1 router + 7 dispatch + 10 impl | 1 router + 6 dispatch files | 1 router + 18 command files | 1 router + 9 dispatch files |

### D. Manager Architecture

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Instantiation** | Global Maps (no class) | Singleton classes | Singleton classes | Singleton classes | Singleton classes |
| **TerminalManager** | Map + auto-increment ID | Class + auto-increment ID | Class + auto-increment ID | Class + auto-increment ID | Class + auto-increment ID |
| **WatcherManager** | Map + chokidar | Class + chokidar | Class + chokidar | Class + chokidar | Class + chokidar |
| **AgentProcessManager** | Map + threadId key | Class + threadId key | Class + threadId key | Class + threadId key | Map + threadId key |
| **LockManager** | In-memory counter | Class + UUID | File-based .lock files | Not found (in misc?) | In misc dispatch |
| **Debounce (watchers)** | 200ms | 200ms | 200ms + stability 200ms | 200ms | 200ms + stability 100ms |
| **PTY library** | node-pty 1.0.0 | node-pty 1.1.0 | node-pty 1.0.0 | node-pty (unspecified) | node-pty 1.0.0 |
| **chokidar version** | 4.0.3 | 5.0.0 | 4.0.0 | chokidar (unspecified) | 4.0.3 |
| **Lifecycle cleanup** | Manual per-map | `killAll()` / `cleanupAll()` | `killAll()` / `cleanupAll()` | `killAll()` / `stopAll()` | `dispose()` per manager |
| **State container** | Module-scoped Maps | `setManagers()` module fn | Module-scoped singletons | `CommandContext` passed | `SidecarStateImpl` class |

### E. Agent Hub

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Hub location** | Same sidecar process | Same sidecar process | Same sidecar process | Same sidecar process | Same sidecar process |
| **WS endpoint** | `/ws/agent` | `/ws/agent` | `/ws/agent` | `/ws/agent` | `/ws/agent` |
| **Agent connects with** | `?threadId=xxx` query | `?threadId=xxx` query | `?threadId=xxx` query | `?threadId=xxx` query | `?threadId=xxx` query |
| **Pipeline stamping** | Yes (hub:received/emitted) | Yes (hub:received/emitted) | Yes (hub:received/emitted) | Yes (hub:received/emitted) | Yes (hub:received/emitted) |
| **Sequence gap detection** | Yes | Yes | Yes | Yes | Yes |
| **Agent→agent relay** | Yes (targetThreadId) | Yes (targetThreadId) | Yes (targetThreadId) | Yes (targetThreadId) | Yes (targetThreadId) |
| **Drain message handling** | Broadcast as agent:drain | Broadcast as agent:drain | Broadcast as agent:drain | Broadcast as agent:drain | Broadcast as agent:drain |
| **Hub tests** | None | **630+ lines of tests** | None | None | None |
| **Hub LOC** | 197 | 239 | 267 | 266 | 172 |

### F. Rust Sidecar Management

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Spawn mechanism** | `std::thread::spawn` | `sidecar.rs` module | `spawn_sidecar()` fn | `sidecar.rs` (261 lines) | `SidecarProcess` struct |
| **Dev mode entry** | node `sidecar/dist/server.js` | node `dist-sidecar/server.js` | npx tsx `sidecar/src/server.ts` | node `sidecar/dist/server.js` | node `sidecar/dist/server.js` |
| **Prod entry** | Same (relative to home) | `_up_/dist-sidecar/server.js` | node `sidecar/dist/server.js` | `_up_/sidecar/dist/server.js` | `../Resources/sidecar/dist/server.js` |
| **Process isolation** | Detached thread | Managed state | Managed state | Managed state + process group | **Process group (setpgid)** |
| **Shutdown signal** | SIGTERM only | SIGTERM → 5s → exit(1) | SIGTERM (assumed) | SIGTERM → 500ms → SIGKILL | **SIGTERM via pgid → 500ms → SIGKILL** |
| **Readiness check** | None | None | None | Port file poll (15s) | None |
| **Rust crates removed** | Minimal | **axum, portable-pty, tokio/rt-multi-thread, 6+ more** | Minimal | Minimal | ws crate removed |
| **Rust commands kept** | All native + fallback | Native only | All (fallback) | Native + stubs | Native only |
| **Port in [build.rs](http://build.rs)** | `MORT_WS_PORT` env | `MORT_WS_PORT` env | `MORT_WS_PORT` env | `MORT_WS_PORT` env | `MORT_WS_PORT` env |

### G. Frontend Transport (invoke.ts)

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **File size** | 294 lines | 344 lines | 294 lines | 294 lines | 294 lines |
| **Native command count** | 64 | 50+ | 64 | 64 | 65 |
| **Routing logic** | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC |
| **Reconnect strategy** | Exp. backoff, max 10s | Exp. backoff, max 10s | Exp. backoff, max 10s | Exp. backoff, max 10s | Exp. backoff, max 10s |
| **Request timeout** | 30s | 30s | 30s | 30s | 30s |
| **Spawn callback registry** | Yes | Yes | Yes | Yes | Yes |
| **Event relay** | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` |

### H. Tauri Plugin Shims

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Shim location** | `src/lib/browser-stubs.ts` | `src/web-shims/` directory | `src/lib/browser-stubs.ts` | `src/shims/` directory | `src/shims/tauri/` directory |
| **Strategy** | Eager import + fallback | Throw-to-redirect | Eager import + fallback | **Vite alias swaps** | Vite alias swaps |
| **Dialog shim** | No-op | Throw on direct call | No-op | **Browser file picker + prompt** | Returns null / window.confirm |
| **Shell shim** | No-op | Throw on direct call | No-op | Error message | Error message / window.open |
| **Path shim** | Posix string ops | Not found | Posix string ops | Posix string ops | Posix string ops |
| **Window shim** | No-op stub | No-op stub | No-op stub | No-op stub | No-op stub |
| **convertFileSrc** | `http://127.0.0.1:PORT/files?path=...` | Same pattern | Same pattern | Same pattern | Same pattern |
| **homeDir() shim** | Not noted | Not noted | Not noted | Not noted | **Returns "/" (bug)** |
| **global-shortcut** | Not found | Not found | Not found | Not found | **Present (stub)** |

### I. File Serving

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Endpoint** | `GET /files?path=...` | `GET /files?path=...` | `GET /files?path=...` | `GET /files?path=...` | `GET /files?path=...` |
| **Path validation** | Absolute paths only | Absolute paths only | Absolute paths only | **Must be under project root** | Absolute paths only |
| **MIME types** | 40+ mappings | Module-level map | Module-level map | Module-level map | Separate `mime.ts` (37 lines) |
| **Caching** | `Cache-Control: no-cache` | Not specified | Not specified | Not specified | Not specified |
| **Streaming** | `fs.createReadStream()` | Not specified | Not specified | Not specified | Not specified |
| **dist-web fallback** | No | No | No | **Yes — express.static(dist-web)** | No |

### J. I/O Model

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **FS operations** | Mostly async | Mixed sync/async | Async | **All sync (readFileSync, writeFileSync, etc.)** | Mostly async |
| **Git operations** | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execSync` | `execFile` (async) |
| **Shell exec** | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execSync` | `execFile` (async) |
| **Worktree git ops** | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execFileSync` (blocks 30s) |
| **Event loop risk** | Low | Low-medium | Low | **High — all sync I/O** | Low (except worktree) |

### K. Logging

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Mechanism** | Structured JSON logger | Structured logger (stderr) | console.error | process.stderr.write | console.log (7 instances) |
| **Format** | `{ level, ts, msg }` | `{ level, ts, msg }` | Plain text | Prefixed `[component]` | Plain text |
| **Web log buffer** | In-memory (max 1000) | Not found | Not found | Not found | Not found |
| **Follows convention?** | Yes (logger module) | Yes (logger module) | **No (console.error)** | Partial (stderr) | **No (console.log)** |

### L. Build System

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **TS compiler** | tsc | tsc | tsc | **tsup** (esbuild) | tsup |
| **Module format** | ES2022 + Node16 | ES2022 + Node16 | Not specified | ESM | ESM |
| **Target** | Not specified | Not specified | Not specified | Node 22 | Not specified |
| **Output dir** | `sidecar/dist/` | `dist-sidecar/` | `sidecar/dist/` | `sidecar/dist/` | `sidecar/dist/` |
| **Dev runner** | Not specified | tsx | tsx | tsx | tsx |
| **dist-web committed?** | No | No | No | **YES (22 MB, 2704 files)** | No |

### M. Git Hygiene & Tracking

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Commits** | 0 (uncommitted WIP) | 0 (uncommitted WIP) | 0 (uncommitted WIP) | 1 (squashed) | **8 (incremental)** |
| **dist-sidecar gitignored?** | N/A | **No** | N/A | N/A | N/A |
| **dist-web committed?** | No | No | No | **Yes (blocker)** | No |
| **Plan file updated?** | No | No | No | No | Yes (breadcrumbs) |

---

## Worktree Deep Dives

### 1. baseline (ivory-earwig)

**Philosophy:** Minimal, close-to-metal. No abstractions beyond necessary.

**Unique decisions:**

- **No Express** — uses raw `http.createServer()`, the only implementation to skip Express entirely
- **Global Maps instead of classes** — terminals, watchers, agents stored in module-scoped Maps rather than manager classes
- **Custom simpleHash** for port file path (not SHA-256, but matches between Rust and Node)
- **In-memory web log buffer** (max 1000 entries) accessible via commands — unique diagnostic feature
- **Lazy shell PATH init** — defers PATH resolution via `execSync` to first use

**Strengths:**

- Smallest footprint (\~2,029 lines)
- Clean handler separation (8 domain-specific files)
- Graceful degradation (missing node-pty/chokidar don't crash)
- Minimal dependencies (ws, chokidar, node-pty)

**Weaknesses:**

- No manager lifecycle classes — harder to test and extend
- `agent_cancel` has stale PID reference after thread reuse
- `wsInvoke` race: WS can close between readyState check and send()
- Sidecar path resolution uses `data_dir().parent()` — fails in packaged builds
- Shutdown calls `process.exit(0)` without killing child processes

---

### 2. cc-teams (indigo-toucan)

**Philosophy:** Production-quality with proper separation. Most files, most tests.

**Unique decisions:**

- **4-file dispatch split** — separate dispatch-\*.ts files for routing + implementation files for logic (cleanest separation)
- **630+ lines of agent hub integration tests** — only implementation with hub tests
- **Largest Rust cleanup** — removed axum, portable-pty, tokio/rt-multi-thread, and 6+ crates
- **Express dependency** but also `@types/express`, `@types/ws` dev deps
- **LockManager uses crypto.randomUUID()** for lock IDs (vs auto-increment)
- **dist-sidecar/ output directory** (not `sidecar/dist/`) — different build output path

**Strengths:**

- Best dispatch architecture (modular, testable, clear boundaries)
- Only implementation with substantial test coverage
- Largest Rust simplification (fewer native dependencies)
- Proper manager classes with full lifecycle methods

**Weaknesses:**

- No sidecar readiness probe (Tauri connects before sidecar listening)
- `dist-sidecar/` not gitignored
- Largest codebase (\~4,161 lines) — could be over-engineered
- CORS set to `*` (overly permissive)

---

### 3. vanilla-orchestrate (magenta-blackbird)

**Philosophy:** Pragmatic port of Rust logic. Keeps Rust commands as fallback.

**Unique decisions:**

- **Rust commands kept as fallback** — all original Rust handlers remain, sidecar is additive
- **Dev mode via** `npx tsx` — runs TypeScript directly in dev (no build step needed)
- **Dual Rust hub** — keeps Unix socket hub in Rust alongside WS hub in sidecar
- **File-based LockManager** — writes `.lock` files with `.lock.meta` timestamps (vs in-memory)
- `misc.ts` **at 543 lines** — largest single file across all implementations

**Strengths:**

- Safest migration path (Rust fallback if sidecar fails)
- Clean manager classes with proper lifecycle
- File-based locks survive sidecar restart

**Weaknesses:**

- `fsRemove` uses `rmdir` on non-empty directories (bug)
- Shutdown handler never calls `terminalManager.killAll()` / `watcherManager.closeAll()` (orphans processes)
- `misc.ts` at 543 lines violates &lt;250-line guideline
- Utility code duplicated between `misc.ts` and `worktree.ts`
- No dev proxy for WS in dev mode
- console.error logging (not structured)

---

### 4. decompose (aquamarine-lamprey)

**Philosophy:** Most ambitious — complete modular rewrite with web-first thinking.

**Unique decisions:**

- `registerDispatcher()` **Map pattern** — dynamic dispatcher registration, most extensible routing
- **Browser dialog shims** — `<input type="file">` for file picker, `window.prompt()` for directories (best UX)
- **Vite alias swaps** — shims injected at build time via resolve.alias, not runtime detection
- `dist-web/` **as Express static fallback** — serves compiled frontend from sidecar
- `tsup` **build** (esbuild-based) instead of tsc — faster builds
- **Port file polling in Rust** — 15s timeout, 100ms interval (only impl with readiness check)
- **Typed extractors** — `extractString()`, `extractNumber()` instead of generic `extractArg<T>()`

**Strengths:**

- Most commands implemented (\~100)
- Best dialog shims (actual browser file picker)
- Most modular command organization (18 command files)
- Only implementation with Rust-side readiness check
- Typed argument extraction (catches type errors earlier)

**Weaknesses:**

- **SHOWSTOPPER: Port file hash mismatch** — Rust uses `DefaultHasher` (SipHash), Node uses SHA-256. They will never produce the same hash. The Rust readiness check times out and kills the running sidecar.
- **22 MB committed** `dist-web/` — 2,704 build artifacts in git
- **All sync I/O** — `readFileSync`, `writeFileSync`, `execSync` throughout. Blocks event loop for ALL clients.
- `child.pid!` non-null assertion — `spawn()` can return undefined pid
- `fs_grep` iterates directories for literal filename match, not glob

---

### 5. breadcrumb-loop (azure-herring)

**Philosophy:** Incremental, well-tracked progress. Clean and pragmatic.

**Unique decisions:**

- **Incremental commits (8)** — only implementation with proper git history
- `SidecarStateImpl` **class** — wraps all managers + projectRoot + port in a single state container with `dispose()`
- **Process group isolation** — uses `setpgid` in Rust to put sidecar in its own process group (cleanest Unix signal handling)
- **Separate** `mime.ts` — MIME type lookup extracted to own file
- **Global shortcut shim** — only implementation that stubs `@tauri-apps/plugin-global-shortcut`
- **Compact dispatch** — router is just 22 lines (smallest)
- **Express 5.1.0** — newest Express version (others use 4.x)

**Strengths:**

- No showstopper bugs
- Best git hygiene (8 incremental commits, honest progress tracking)
- Clean state management (SidecarStateImpl with dispose pattern)
- Process group isolation (proper Unix process management)
- Most Tauri plugin shims (including global-shortcut)
- Compact, readable codebase (\~2,405 lines)

**Weaknesses:**

- `execFileSync` in `fsGitWorktreeAdd/Remove` blocks event loop up to 30s
- No Zod validation at WS boundary (same as all others)
- `homeDir()` shim returns `"/"` instead of actual home directory
- Dead code: `AgentHubManager.hierarchy` map populated but never read
- `console.log` instead of structured logger (7 instances)

---

## Summary: Unique Decisions by Area

### Where implementations diverge most

| Area | Range of approaches | Most divergent |
| --- | --- | --- |
| **Dispatch pattern** | Map registry vs prefix switch vs if-chain | baseline (Map) vs breadcrumb-loop (if-chain) |
| **Manager style** | Global Maps vs singleton classes vs state container | baseline (Maps) vs breadcrumb-loop (StateImpl) |
| **I/O model** | All async vs all sync vs mixed | decompose (all sync) vs baseline/breadcrumb-loop (async) |
| **Rust cleanup** | Minimal vs aggressive | cc-teams (removed 6+ crates) vs vanilla-orchestrate (kept everything) |
| **Dialog shims** | No-op vs throw vs browser file picker | decompose (file picker) vs cc-teams (throw) |
| **Lock strategy** | In-memory counter vs UUID vs file-based | vanilla-orchestrate (file-based) vs baseline (counter) |
| **Build tool** | tsc vs tsup | decompose/breadcrumb-loop (tsup) vs others (tsc) |
| **Readiness check** | None vs port file polling | decompose (15s poll, broken) vs all others (none) |
| **Test coverage** | None vs 630+ lines | cc-teams (tests) vs all others (none) |
| **Sidecar output path** | `sidecar/dist/` vs `dist-sidecar/` | cc-teams (dist-sidecar/) vs others (sidecar/dist/) |

### Where all implementations agree

Every implementation made these same choices:

 1. Express (or raw http) + `ws` library with `noServer` mode
 2. Two WS endpoints: `/ws` (frontend) + `/ws/agent` (agents)
 3. Port 9600 default with `MORT_WS_PORT` env override
 4. Port file at `~/.mort/sidecar-{hash}.port`
 5. Same wire protocol: `{ id, cmd, args }` → `{ id, result/error }`
 6. Same push event protocol: `{ event, payload }`
 7. Relay events via `{ relay: true, event, payload }`
 8. `/files?path=...` HTTP endpoint for asset serving
 9. `convertFileSrc()` → HTTP file server URL in browser mode
10. `invoke()` transport wrapper with native command list
11. Exponential backoff reconnection (max 10s)
12. 30s request timeout
13. Agent hub with pipeline stamping and sequence gap detection
14. node-pty for PTY sessions, chokidar for file watching
15. No Zod validation at WebSocket boundary (all use unsafe casts)
16. No authentication on localhost WebSocket
17. No TLS (plain WebSocket on loopback)