# Sidecar Implementation Comparison

Cross-analysis of 5 independent implementations of the "Consolidate to WebSocket & Node.js Sidecar" plan. All branches diverge from commit `8beb7ef` (main).

## Branches

| Branch | Worktree | Commits | Status |
| --- | --- | --- | --- |
| `breadcrumb-loop` | azure-herring | 8 (incremental) | Committed |
| `decompose` | aquamarine-lamprey | 1 (squashed) | Committed |
| `baseline` | ivory-earwig | 0 | Uncommitted WIP |
| `vanilla-orchestrate` | magenta-blackbird | 0 | Uncommitted WIP |
| `cc-teams` | indigo-toucan | 0 | Uncommitted WIP |

## Diff Size & Scope

| Metric | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Files changed | 31 | 59 | 49 | 90 (src only) | 75 |
| Insertions | +178 | +290 | +370 | +6,508 | +3,452 |
| Deletions | \-1,753 | \-5,851 | \-1,776 | \-1,638 | \-1,560 |
| Net new code | \~1,575 | \~4,140 | \~2,074 | \~4,870 | \~1,892 |
| Sidecar LOC | \~2,029 | \~4,161 | \~3,480 | \~2,400 | \~2,405 |
| Commands impl'd | \~91 | \~91 | \~91 | \~100 | \~93 |

Note: cc-teams deleted significantly more Rust than others ([filesystem.rs](http://filesystem.rs), git_commands.rs, [identity.rs](http://identity.rs), [search.rs](http://search.rs), [shell.rs](http://shell.rs), [terminal.rs](http://terminal.rs), thread_commands.rs, etc.)

---

## Component Scores

### A. Sidecar Server

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | 9 | 9 | 9 | 9 | 9 |
| Code Quality | 8 | 8 | 8 | 8 | 8 |
| Architecture | 9 | 9 | 9 | 9 | 9 |
| **Avg** | **8.7** | **8.7** | **8.7** | **8.7** | **8.7** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| I/O model | async | mixed sync/async | async | sync (execSync) | async |
| Logging | structured logger | console.log | console.error | no console.log | console.log (7x) |
| Shutdown | graceful | graceful+5s timeout | graceful | graceful | graceful+dispose |
| CORS | permissive | `*` (too open) | not mentioned | not mentioned | not mentioned |

All five are architecturally identical (Express + dual WSS). Key differentiator is I/O model — decompose uses `execSync` which blocks the event loop. breadcrumb-loop and baseline use proper async throughout.

---

### B. Sidecar Dispatch

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | 8 | 8 | 9 | 8 | **10** |
| Code Quality | 8 | 8 | 7.5 | 7 | **8** |
| Architecture | 9 | 9 | 7.5 | 8 | **9** |
| **Avg** | **8.3** | **8.3** | **8.0** | **7.7** | **9.0** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Git structure | single file (281L) | modular (530L/4 files) | modular (6 files) | **monolith (633L)** | modular (4 files, 605L) |
| FS I/O | async (fs/promises) | sync (readFileSync) | async (fs/promises) | sync (execSync for copy) | async (fs/promises) |
| misc.ts size | 279L | 380L | **542L monolith** | 145L | 233L |
| Known bugs | grep uses system binary | no timeouts | **fsRemove bug** (rmdir on non-empty) | no input validation | no regex validation |

**Winner: breadcrumb-loop.** Full command coverage, proper async I/O, modular git split, no monolith files.

---

### C. Sidecar Managers

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | 7 | 8 | **9** | **9** | **9** |
| Code Quality | 8 | 9 | **9** | **9** | **9** |
| Architecture | 8 | 9 | **9** | **9** | **9** |
| **Avg** | **7.7** | **8.7** | **9.0** | **9.0** | **9.0** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Terminal cleanup | on exit | on exit + list | on exit | on exit + killByCwd | on exit + killByCwd |
| Watcher debounce | 200ms | 200ms + smart flush | 200ms + awaitWriteFinish | 200ms | 200ms + awaitWriteFinish |
| Agent signal handling | SIGTERM only | SIGTERM→SIGKILL (5s) | SIGTERM→SIGKILL (5s) | SIGTERM→SIGKILL (5s, pgroup) | SIGTERM→SIGKILL (pgroup) |
| DI pattern | callbacks | setManagers() globals | constructor DI | CommandContext injection | constructor DI |

Three-way tie: vanilla-orchestrate, decompose, breadcrumb-loop. All have proper signal escalation and lifecycle management. baseline loses on lacking SIGKILL escalation.

---

### D. Web Build

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | 9 | 8 | 8 | **9** | 9 |
| Code Quality | 8 | 7 | 8 | **9** | 8 |
| Architecture | 9 | 8 | 8 | **9** | 8 |
| **Avg** | **8.7** | **7.7** | **8.0** | **9.0** | **8.3** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Dev proxy | /ws + /files | **none** | not mentioned | /ws + /files | /ws + /files |
| Port config | env var | **hardcoded 9600** | env var | env var | env var |
| Link handling | new tab | new tab | not mentioned | new tab + stopImmediate | new tab via openUrl() |
| Build artifacts | committed dist-web/ | — | — | **committed dist-web/** | .gitignored |

**Winner: decompose** for completeness — but committed dist-web/ artifacts is a blocker. breadcrumb-loop is cleanest overall (proper .gitignore).

---

### E. Tauri Shims

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | 9 | 9 | 8.5 | **10** | 9 |
| Code Quality | 7 | 8 | 7.5 | **9** | 8 |
| Architecture | 9 | 7 | 8 | **10** | 8 |
| **Avg** | **8.3** | **8.0** | **8.0** | **9.7** | **8.3** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Shim count | 10 | 10+10 | 10 | 8 + browser fallbacks | 10 |
| Shim location | src/lib/shims/ | **TWO dirs** | src/shims/ | src/shims/tauri-\*.ts | src/shims/tauri/ |
| global-shortcut | present | present | present | **missing** | present |
| plugin-dialog | stubs (throw) | stubs (throw) | browser fallbacks | **browser file picker + prompt** | stubs |
| Security (opener) | none | none | none | none | **noopener,noreferrer** |

**Winner: decompose** — browser-native fallbacks for dialogs/file pickers, native fetch passthrough. BUT missing global-shortcut shim. cc-teams has duplicate shim directories (maintenance problem). breadcrumb-loop has best security defaults.

---

### F. Agent Hub Client

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | **10** | 9 | 9 | 9 | 9 |
| Code Quality | **9** | 9 | 9 | 9 | 9 |
| Architecture | 9 | 9 | 9 | 9 | 9 |
| **Avg** | **9.3** | **9.0** | **9.0** | **9.0** | **9.0** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| ws-connection LOC | \~140 | 133 | 183 | 192 | 150 |
| Backpressure | not mentioned | failure tracking | bufferedAmount polling | bufferedAmount + 64KB | write queue + callback |
| Graceful close | not mentioned | 1s timeout | 1s timeout | 1s timeout | 1s timeout |
| Health tracking | stats + events | healthy/degraded/disconnected | healthy/degraded/disconnected | healthy/degraded/disconnected | consecutive failure count |

All implementations share unbounded write queue weakness. vanilla-orchestrate and decompose have most sophisticated backpressure. baseline has most complete stats tracking.

---

### G. Rust Changes

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Completeness | 9 | 9 | 9 | 9 | **10** |
| Code Quality | 8 | 8 | 8 | 9 | **9** |
| Architecture | 9 | 9 | 8 | 9 | **9** |
| **Avg** | **8.7** | **8.7** | **8.3** | **9.0** | **9.3** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| [sidecar.rs](http://sidecar.rs) | spawns in [lib.rs](http://lib.rs) | 105L, silent fail | spawns in [lib.rs](http://lib.rs) | **260L, blocks 15s polling** | **130L, non-blocking, setpgid** |
| Broadcast extraction | [push.rs](http://push.rs) (60L) | event_broadcaster.rs (56L) | [broadcast.rs](http://broadcast.rs) (60L) | event_broadcaster.rs (52L) | [broadcast.rs](http://broadcast.rs) (57L, has subscribe()) |
| AgentProcess | in [lib.rs](http://lib.rs) | separate file (24L) | not extracted | in agent_hub.rs | **separate file (25L)** |
| ws_server/ deleted | yes | yes | yes | yes | yes |
| Extra Rust deleted | — | **10 additional files** | — | — | — |
| Cargo cleanup | partial | extensive | partial | full | full |
| Startup behavior | non-blocking | non-blocking (silent) | non-blocking | **blocks 15s** | **non-blocking** |

**Winner: breadcrumb-loop.** Non-blocking spawn, process group isolation via setpgid, clean module extraction. decompose's 15-second blocking port file poll is a liability. cc-teams over-deleted Rust files that may still be needed.

---

### H. Plan & Progress Tracking

|  | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| **Score** | 8.5 | 7.0 | 9.0 | 8.5 | **10.0** |

| Detail | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| Phases marked | all done | **NOT marked** | all done | all done | all done |
| Progress files | verification matrix | spike-b0/ clutter | plan updated | 27 .result.md files | 5 breadcrumb files |
| Commit hygiene | uncommitted | uncommitted | uncommitted | 1 squash | **8 incremental** |
| Artifacts | dist-web/ committed | dist-sidecar/ untracked | clean | **dist-web/ committed** | **.gitignored** |

**Winner: breadcrumb-loop.** 8 clean commits, honest progress files, proper .gitignore.

---

## Grand Totals

| Component | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| A. Server | 8.7 | 8.7 | 8.7 | 8.7 | 8.7 |
| B. Dispatch | 8.3 | 8.3 | 8.0 | 7.7 | **9.0** |
| C. Managers | 7.7 | 8.7 | **9.0** | **9.0** | **9.0** |
| D. Web Build | 8.7 | 7.7 | 8.0 | **9.0** | 8.3 |
| E. Shims | 8.3 | 8.0 | 8.0 | **9.7** | 8.3 |
| F. Hub Client | **9.3** | 9.0 | 9.0 | 9.0 | 9.0 |
| G. Rust | 8.7 | 8.7 | 8.3 | 9.0 | **9.3** |
| H. Tracking | 8.5 | 7.0 | 9.0 | 8.5 | **10.0** |
| **Average** | **8.5** | **8.3** | **8.5** | **8.8** | **8.9** |

---

## Critical Defects by Implementation

| Implementation | Blockers | High-severity |
| --- | --- | --- |
| **baseline** | Sidecar path hardcoded to \~/.anvil/ (fragile) | No SIGKILL escalation; agent hub transport ambiguous |
| **cc-teams** | Duplicate shim directories; plan not updated; spike-b0/ clutter | Over-deleted Rust files; plugin-http throws instead of using native fetch; sidecar silent fail |
| **vanilla-orchestrate** | **fsRemove bug** (rmdir on non-empty dirs) | 542-line misc.ts monolith; advisory-only LockManager; no sidecar health checks |
| **decompose** | **Committed dist-web/ artifacts**; blocks 15s on port file | Missing global-shortcut shim; sync I/O (execSync); 633-line git.ts monolith |
| **breadcrumb-loop** | None | 7x console.log (convention violation); silent JSON drop in agent-hub; no regex validation in fs_grep |

---

## Final Ranking

| Rank | Branch | Score | Best At | Worst At |
| --- | --- | --- | --- | --- |
| **1** | **breadcrumb-loop** | 8.9 | Dispatch modularization, Rust changes, tracking, git hygiene | Shim completeness (no browser fallbacks) |
| **2** | **decompose** | 8.8 | Web build, shims, managers | Sync I/O, git monolith, committed artifacts |
| **3** | **baseline** | 8.5 | Hub client, sidecar server | Manager lifecycle (no SIGKILL), fragile paths |
| **4** | **vanilla-orchestrate** | 8.5 | Managers, backpressure handling | fsRemove bug, misc.ts monolith, lock manager |
| **5** | **cc-teams** | 8.3 | Manager patterns, signal handling | Duplicate shims, plan hygiene, over-deletion |

---

## Recommendation

**breadcrumb-loop** is the best foundation — no blockers, best git hygiene, strongest dispatch and Rust implementation. **decompose** has the best individual components (shims, web build) but is dragged down by committed artifacts, blocking spawn, and sync I/O.

The ideal merge would be breadcrumb-loop's foundation with decompose's dialog shims and web entry point cherry-picked in.

### Cherry-pick candidates from other branches

| Source | Component | Reason |
| --- | --- | --- |
| decompose | plugin-dialog.ts (browser file picker + prompt) | Best user experience for web build |
| decompose | web-entry.tsx (frame rate monitoring) | More complete initialization |
| decompose | dispatch.ts registry pattern | More extensible than if/else routing |
| decompose | shell.ts ID-based process tracking | Cleanup on shutdown, line-by-line streaming |
| vanilla-orchestrate | ws-connection.ts bufferedAmount polling | More robust backpressure detection |
| baseline | hub client stats tracking | Better observability |
