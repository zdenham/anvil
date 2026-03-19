# Decision Comparison Matrix

Side-by-side comparison across all 13 decision areas (A–M).

## A. Server Setup

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

## B. Port Discovery / IPC

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Port file path** | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` | `~/.mort/sidecar-{hash}.port` |
| **Hash algorithm (Node)** | simpleHash (custom) | SHA-256 (12 chars) | SHA-256 (12 chars) | SHA-256 (12 chars) | SHA-256 (12 chars) |
| **Hash algorithm (Rust)** | simpleHash (matching) | build_info + port file | build_info + port file | **DefaultHasher (SipHash)** | build_info + env var |
| **Hash mismatch?** | No | No | No | **YES — showstopper** | No |
| **Rust readiness check** | None (fire & forget) | None (no readiness probe) | None | Polls port file 15s | None |
| **Port passed to Node via** | CLI `--port` | CLI `--port` + env | env `MORT_WS_PORT` | CLI `--port` + `--project` | env `MORT_SIDECAR_PORT` |
| **Port baked in frontend** | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) | `__MORT_WS_PORT__` (Vite) |

## C. Command Dispatch

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Routing pattern** | `Map<string, Handler>` registry | Prefix-based switch | Prefix-based switch | `Map<prefix, Dispatcher>` registry | Prefix-based if-chain |
| **Entry point** | `registerAll()` + Map lookup | `dispatchInner()` with if/switch | `dispatch()` with if/switch | `registerDispatcher()` + Map iteration | `dispatch()` with if-chain |
| **Commands implemented** | \~91 | \~86 of \~91 | \~70+ | \~100 | \~93 |
| **Arg validation** | `extractArg<T>` (cast) | `extractArg<T>` (cast) | `extractArg<T>` (cast) | `extractString/Number` (typed) | `extractArg<T>` (cast) |
| **Zod at boundary?** | No | No | No | No | No |
| **Unknown cmd handling** | Throws error | Falls through to misc | Falls through to misc | Falls through to misc | Falls through to misc |
| **Dispatch file count** | 1 router + 8 handler files | 1 router + 7 dispatch + 10 impl | 1 router + 6 dispatch files | 1 router + 18 command files | 1 router + 9 dispatch files |

## D. Manager Architecture

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

## E. Agent Hub

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

## F. Rust Sidecar Management

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

## G. Frontend Transport (invoke.ts)

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **File size** | 294 lines | 344 lines | 294 lines | 294 lines | 294 lines |
| **Native command count** | 64 | 50+ | 64 | 64 | 65 |
| **Routing logic** | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC | Native→IPC, Data→WS→IPC |
| **Reconnect strategy** | Exp. backoff, max 10s | Exp. backoff, max 10s | Exp. backoff, max 10s | Exp. backoff, max 10s | Exp. backoff, max 10s |
| **Request timeout** | 30s | 30s | 30s | 30s | 30s |
| **Spawn callback registry** | Yes | Yes | Yes | Yes | Yes |
| **Event relay** | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` | `{ relay: true, event, payload }` |

## H. Tauri Plugin Shims

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

## I. File Serving

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Endpoint** | `GET /files?path=...` | `GET /files?path=...` | `GET /files?path=...` | `GET /files?path=...` | `GET /files?path=...` |
| **Path validation** | Absolute paths only | Absolute paths only | Absolute paths only | **Must be under project root** | Absolute paths only |
| **MIME types** | 40+ mappings | Module-level map | Module-level map | Module-level map | Separate `mime.ts` (37 lines) |
| **Caching** | `Cache-Control: no-cache` | Not specified | Not specified | Not specified | Not specified |
| **Streaming** | `fs.createReadStream()` | Not specified | Not specified | Not specified | Not specified |
| **dist-web fallback** | No | No | No | **Yes — express.static(dist-web)** | No |

## J. I/O Model

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **FS operations** | Mostly async | Mixed sync/async | Async | **All sync (readFileSync, writeFileSync, etc.)** | Mostly async |
| **Git operations** | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execSync` | `execFile` (async) |
| **Shell exec** | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execSync` | `execFile` (async) |
| **Worktree git ops** | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execFile` (async) | `execFileSync` (blocks 30s) |
| **Event loop risk** | Low | Low-medium | Low | **High — all sync I/O** | Low (except worktree) |

## K. Logging

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Mechanism** | Structured JSON logger | Structured logger (stderr) | console.error | process.stderr.write | console.log (7 instances) |
| **Format** | `{ level, ts, msg }` | `{ level, ts, msg }` | Plain text | Prefixed `[component]` | Plain text |
| **Web log buffer** | In-memory (max 1000) | Not found | Not found | Not found | Not found |
| **Follows convention?** | Yes (logger module) | Yes (logger module) | **No (console.error)** | Partial (stderr) | **No (console.log)** |

## L. Build System

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **TS compiler** | tsc | tsc | tsc | **tsup** (esbuild) | tsup |
| **Module format** | ES2022 + Node16 | ES2022 + Node16 | Not specified | ESM | ESM |
| **Target** | Not specified | Not specified | Not specified | Node 22 | Not specified |
| **Output dir** | `sidecar/dist/` | `dist-sidecar/` | `sidecar/dist/` | `sidecar/dist/` | `sidecar/dist/` |
| **Dev runner** | Not specified | tsx | tsx | tsx | tsx |
| **dist-web committed?** | No | No | No | **YES (22 MB, 2704 files)** | No |

## M. Git Hygiene & Tracking

| Decision | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Commits** | 0 (uncommitted WIP) | 0 (uncommitted WIP) | 0 (uncommitted WIP) | 1 (squashed) | **8 (incremental)** |
| **dist-sidecar gitignored?** | N/A | **No** | N/A | N/A | N/A |
| **dist-web committed?** | No | No | No | **Yes (blocker)** | No |
| **Plan file updated?** | No | No | No | No | Yes (breadcrumbs) |
