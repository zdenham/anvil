# Breadcrumb v1 vs v2 — Head-to-Head Comparison

Comparing azure-herring (breadcrumb v1, 5 iterations) against green-mosquito (breadcrumb v2, 11 iterations).

---

## Summary Verdict

**Green-mosquito (v2) is the stronger implementation.** It went further (production DMG build), caught a critical bug (dead event system), has tests, and has better process management. However, it traded some of v1's code elegance for pragmatic "get it done" splits — the 3-function dispatch pattern is worse than v1's clean module boundaries.

---

## Scorecard

| Category | v1 (azure-herring) | v2 (green-mosquito) | Winner |
| --- | --- | --- | --- |
| **Completeness** | Builds pass, events untested | Full DMG build, events fixed | **v2** |
| **Code Organization** | 24 small files, clean boundaries | 19 files, 2 over 250 lines | **v1** |
| **Testing** | 0 tests | 14 integration tests (383 lines) | **v2** |
| **Process Management** | Detached spawn, no escalation | SIGTERM → 5s → SIGKILL | **v2** |
| **State Management** | SidecarStateImpl + dispose() | Interface + managers, unbounded buffers | **v1** (cleaner) |
| **Error Handling** | Silent failures, 7× console.log | Silent failures, 14+ empty catches | **Tie** (both poor) |
| **Async Discipline** | execFileSync in worktree ops | execSync in shell init + searchThreads | **Tie** (both block) |
| **Type Safety** | strict, no any, no Zod | strict, no any, no Zod | **Tie** |
| **Security** | Path traversal (symlink-aware check) | Path traversal (no check at all) | **v1** |
| **File Size Discipline** | All files &lt;250 lines | 2 files 376–416 lines | **v1** |
| **Dependencies** | 4 runtime deps, hand-rolled mime | 3 runtime deps, npm mime-types | **v2** |
| **Build Verification** | cargo check only | Full tauri build + verify script | **v2** |
| **Event System** | Not addressed (broken) | Discovered + fixed | **v2** |
| **Git Hygiene** | 8 clean commits | 20+ commits, some WIP | **v1** |
| **Self-Correction** | Linear progression | Found and fixed event breakage | **v2** |

**Final: v2 wins 7, v1 wins 4, Tie 4**

---

## Deep Dive: Where v2 Improved

### 1. Completeness & Production Readiness

v1 stopped at "cargo check passes" and deferred manual testing. v2 pushed through to a full `pnpm tauri build` producing a DMG bundle, then added a `verify-web-build.sh` script for structural validation. This is the single biggest differentiator — v2 actually works as a production artifact.

### 2. Event System Discovery

v1 never noticed that `EventBroadcaster.broadcast()` was a no-op (zero subscribers after removing the WS server). v2 discovered this at iteration 008 and spent 3 iterations properly migrating to Tauri-native `app.emit()`. This is a real bug that would have blocked runtime functionality.

### 3. Testing

v1 shipped zero tests. v2 includes:

- `command-dispatch.test.ts` — 10 integration tests covering misc, fs, and git dispatch
- `agent-hub-roundtrip.test.ts` — 4 tests for registration, event push, messaging, and WS URL discovery

This gives v2 a regression safety net that v1 completely lacks.

### 4. Process Lifecycle

v1 spawns agents with `detached: true` and has no cleanup path — processes orphan on sidecar shutdown. v2's `AgentProcessManager` implements proper escalation (SIGTERM → 5s timeout → SIGKILL) and tracks all spawned processes.

### 5. Dependency Hygiene

v2 actively removed unused dependencies (chokidar, proper-lockfile) during implementation and uses `mime-types` from npm instead of v1's hand-rolled mime lookup.

---

## Deep Dive: Where v1 Was Better

### 1. Code Organization

v1's 24 small files with clean module boundaries are easier to navigate than v2's bloated dispatch files. v2's `dispatch-git.ts` (416 lines) and `dispatch-misc.ts` (376 lines) both violate the 250-line convention. The Part1/Part2/Part3 function split is a workaround, not a solution — it keeps the file large while fragmenting the logic.

v1's approach of separate `dispatch/git-branch.ts` (224), `dispatch/git-diff.ts` (189), `dispatch/git-misc.ts` (174) is genuinely better — each file owns a coherent subdomain.

### 2. State Management

v1's `SidecarStateImpl` class with a `dispose()` method is a cleaner pattern. All managers are constructed and destroyed together. v2 uses a plain interface with individually-constructed managers and has unbounded state growth risks (logBuffer, diagnosticConfig).

### 3. Security (Relative)

Neither is good, but v1 at least has a path traversal check in `static.ts` (uses `path.relative()` + checks for `..`). v2's `/files` endpoint does zero path validation — `path.resolve()` alone allows traversal.

### 4. Git Hygiene

v1 has 8 clean, descriptive commits with phase markers. v2 has 20+ commits including WIP saves and breadcrumb checkpoints — noisier history.

---

## Shared Weaknesses (Both Need Fixing)

| Issue | v1 | v2 |
| --- | --- | --- |
| `execSync` / `execFileSync` blocks event loop | worktree ops (30s) | shell init (30s) + search |
| No Zod validation at WS boundary | `Record<string, unknown>` | Same |
| `console.log` instead of structured logger | 7 instances | Throughout |
| No WebSocket authentication | Any localhost client | Same |
| Silent error swallowing | Multiple catch blocks | 14+ empty catches |
| No backpressure on large WS messages | Unbounded | Same |
| CORS wildcard `*` | Yes | Yes |

---

## Architectural Decisions Comparison

### Dispatch Pattern

|  | v1 | v2 |
| --- | --- | --- |
| **Pattern** | if-chain in 22-line router | switch-case in 37-line router |
| **Module split** | By subdomain (git-branch, git-diff, git-misc) | By top-level prefix (dispatch-git, dispatch-misc) |
| **File count** | 10 dispatch files | 6 dispatch files |
| **Max file size** | 238 lines | 416 lines |

v1's finer-grained split is better for maintainability.

### Manager Architecture

|  | v1 | v2 |
| --- | --- | --- |
| **State container** | `SidecarStateImpl` class | `SidecarState` interface |
| **Dispose pattern** | Class method, sequential | No explicit dispose |
| **Agent processes** | Module-global Map (leaked) | `AgentProcessManager` class |
| **Locks** | In-memory counter | File-based with 30min expiry |
| **Agent hub** | `AgentHubManager` class | `AgentHub` class |

v2's `AgentProcessManager` is better, but v1's overall state lifecycle is cleaner.

### Build & Verification

|  | v1 | v2 |
| --- | --- | --- |
| **Build tool** | tsup | tsup |
| **Express** | 5.1.0 | 5.1.0 |
| **Source maps** | No | Yes |
| **Type checking** | No (tsup only) | No (tsup only) |
| **Production build** | cargo check only | Full tauri build + DMG |
| **Verification** | Manual | `verify-web-build.sh` script |

v2 is clearly ahead here.

---

## Recommendations for Final Implementation

Take the best from each:

1. **From v2:** Tests, event system fix, production build, process manager, dependency cleanup
2. **From v1:** File organization (split dispatch by subdomain), SidecarStateImpl dispose pattern, path traversal check
3. **Fix in both:** Replace execSync, add Zod validation, structured logging, auth, bounded buffers

### Ideal File Structure (Hybrid)

```
sidecar/src/
├── server.ts                    ← v1 style entry
├── types.ts                     ← Shared protocol types
├── state.ts                     ← v1's SidecarStateImpl + dispose
├── dispatch.ts                  ← v1's compact router
├── ws-handler.ts                ← v2's handler (with tests)
├── push.ts                      ← Event broadcaster
├── helpers.ts                   ← Arg extraction
├── dispatch/
│   ├── fs.ts                    ← v1 style (single domain)
│   ├── git-branch.ts            ← v1 split
│   ├── git-diff.ts              ← v1 split
│   ├── git-misc.ts              ← v1 split
│   ├── git-helpers.ts           ← Shared
│   ├── worktree.ts              ← Both similar
│   ├── agent.ts                 ← v2's process manager
│   ├── shell.ts                 ← v1 split
│   ├── misc-thread.ts           ← v1 split
│   └── misc.ts                  ← Remaining misc
├── managers/
│   ├── agent-hub.ts             ← v2 style
│   ├── agent-process-manager.ts ← v2 (SIGTERM escalation)
│   ├── terminal-manager.ts      ← v1 style
│   ├── file-watcher-manager.ts  ← v1 style
│   └── lock-manager.ts          ← v2 (file-based)
└── __tests__/
    ├── command-dispatch.test.ts  ← v2
    └── agent-hub-roundtrip.test.ts ← v2
```