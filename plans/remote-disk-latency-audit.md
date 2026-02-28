# Remote Disk Latency Audit & Refactoring Plan

## Context

We are considering supporting remote dev server disk (e.g. SSH/SFTP mount, remote container, cloud devbox), which would add **50-200ms latency per disk I/O operation**. This audit catalogs every disk read in the codebase, ranks them by frequency and latency sensitivity, and identifies what must be refactored.

---

## Phases

- [ ] P0: Eliminate hot-path synchronous disk reads in agent loop
- [ ] P1: Add caching/batching to startup hydration chain
- [ ] P2: Replace O(N) linear scans with indexed lookups
- [ ] P3: Move Rust-layer reads to async and add caching
- [ ] P4: Abstract filesystem access behind a latency-tolerant interface

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Severity Tiers

### Tier 0 — CRITICAL: Hot path, every turn/interaction

These fire on **every LLM turn or user keystroke** and are synchronous/blocking. Adding 50-200ms latency here would make the product feel broken.

| # | Location | What | Frequency | Current I/O |
|---|----------|------|-----------|-------------|
| 1 | `agents/src/output.ts:374-394` | `writeUsageToMetadata()` — read-modify-write `metadata.json` | **Every LLM turn** | `readFileSync` + `JSON.parse` + `writeFileSync` |
| 2 | `agents/src/runners/shared.ts:342-344` | `isPlanPath()` — `realpathSync` x2 for symlink resolution | **Every file-modifying tool call** (Edit, Write, NotebookEdit) | `realpathSync` x2 |
| 3 | `src/entities/threads/service.ts:552-644` | `loadThreadState()` — reads `state.json` for active thread | **Every thread switch + every AGENT_STATE event** | Tauri IPC `readJson` |
| 4 | `src/lib/prompt-history-service.ts:46-59` | `PromptHistoryService.load()` — reads prompt history | **Every up/down arrow keypress** | Tauri IPC `readJsonFile` |
| 5 | `src-tauri/src/clipboard_db.rs:121-209` | Clipboard dedup — `get_latest_content` SQLite query | **Every clipboard change** (~2/sec during copy bursts) | SQLite query |

**Refactoring needed:**
- **(1)** Accumulate usage in memory, flush to disk on a debounced timer (e.g. every 5s or on turn boundary) instead of per-turn sync read-modify-write
- **(2)** Cache `realpathSync` results in a Map keyed by path — invalidate on file rename/move events only
- **(3)** Already has stale-while-revalidate; need to also cache state in-memory and apply incremental diffs from socket events rather than re-reading full state.json from disk
- **(4)** Load prompt history once into memory, write-through on add. Never re-read from disk on navigation.
- **(5)** Already in-memory SQLite; fine as-is for remote disk since DB file is local. Flag if we move clipboard.db to remote.

---

### Tier 1 — HIGH: Startup / thread creation critical path

These block app launch or new-thread creation. Users wait directly on these.

| # | Location | What | Frequency | Current I/O |
|---|----------|------|-----------|-------------|
| 6 | `src/entities/threads/service.ts:82-107` | `threadService.hydrate()` — globs + reads ALL `metadata.json` | **App startup** | Tauri IPC: glob (multi-level) + N x `readJson` |
| 7 | `src/entities/plans/service.ts:25-54` | `planService.hydrate()` — globs + reads ALL plan metadata | **App startup** | Tauri IPC: glob + N x `readJson` |
| 8 | `src/entities/repositories/service.ts:88-158` | `repoService.hydrate()` — lists + reads repo settings | **App startup** | Tauri IPC: `listDir` + N x `readJson` |
| 9 | `src/entities/relations/service.ts:203-228` | `relationService.hydrate()` — lists + reads all edge files | **App startup** | Tauri IPC: `listDir` + N x `readJson` |
| 10 | `src/entities/settings/service.ts:14-18` | `settingsService.hydrate()` | **App startup** | 1 x Tauri IPC `readJson` |
| 11 | `src/stores/tree-menu/service.ts:21-43` | `treeMenuService.hydrate()` | **App startup** | 1 x Tauri IPC `readJson` |
| 12 | `src/entities/drafts/service.ts:55-58` | `draftService.hydrate()` | **App startup** | 1 x Tauri IPC `readJson` |
| 13 | `src/entities/quick-actions/service.ts:18-104` | `quickActionService.hydrate()` — registry + N manifests | **App startup** | Tauri IPC: 1 + N x `readJson` |
| 14 | `agents/src/runners/simple-runner-strategy.ts:57-74,116-165` | Worktree scan — reads ALL `repositories/*/settings.json` | **Every new thread creation** | `readdirSync` + N x `readFileSync` |
| 15 | `agents/src/runner.ts:46-53` | `loadPriorState()` — reads `state.json` for resume | **Thread resume** | `readFileSync` (potentially 1-10MB) |
| 16 | `migrations/src/runner.ts:43-44` | Migration version check | **App startup** | `readFileSync` |
| 17 | `src/lib/app-data-store.ts:179-246` | `AppDataStore.glob()` — recursive IPC per wildcard level | **Every hydration glob** | N Tauri IPC round-trips per glob level |

**Refactoring needed:**
- **(6-9, 13, 17)** Implement a **bulk read** Tauri command: `fs_read_batch(patterns: string[]) -> Map<path, content>`. One IPC round-trip instead of N+1. Alternatively, build a **manifest file** (`~/.mort/manifest.json`) that's an index of all metadata, updated on write — single file read to hydrate all stores.
- **(14)** Cache repo settings in-memory in the agent process. Read once at process start, not per-thread.
- **(15)** For remote disk: stream state.json rather than blocking read of entire file. Or keep a local LRU cache of recent state files.
- **(16)** Already one read; acceptable if local. If remote, cache version in a local sidecar file.

---

### Tier 2 — MEDIUM: Per-tool-call / per-event hooks

These fire during agent operation but not on every single turn. Adding 200ms latency would slow down agent operations noticeably but not catastrophically.

| # | Location | What | Frequency | Current I/O |
|---|----------|------|-----------|-------------|
| 18 | `agents/src/runners/shared.ts:880` | PostToolUse — reads plan file content for phase parsing | **Per plan file write** | `readFileSync` |
| 19 | `agents/src/runners/shared.ts:924` | PostToolUse — reads thread `metadata.json` for plan association | **Per plan file write** | `readFileSync` |
| 20 | `agents/src/runners/shared.ts:989-1039` | PostToolUse:Task — reads child `metadata.json` + `state.json` | **Per sub-agent completion** | `readFileSync` x2 |
| 21 | `agents/src/runners/message-handler.ts:376-377` | `updateChildMetadataField()` — read-modify-write child metadata | **Per task_started/notification** | `readFileSync` |
| 22 | `agents/src/runners/message-handler.ts:516-531` | `getChildThreadState()` — reads child `state.json` (cached after) | **Once per child thread** | `readFileSync` (cached in Map) |
| 23 | `agents/src/runners/shared.ts:138-148` | `propagateModeToChildren()` — scans ALL thread directories | **Per permission mode change** | `readdirSync` + N x `readFileSync` |
| 24 | `agents/src/core/persistence.ts:185-194` | `findPlanByPath()` — linear scan of ALL plan dirs | **Per plan file write** | `readdirSync` + N x `readFileSync` |
| 25 | `agents/src/lib/persistence-node.ts:39-77` | `read()` / `list()` / `listDirs()` — generic persistence ops | **Per plan operation** | Various sync fs calls |
| 26 | `core/adapters/node/path-lock.ts:118-137` | PathLock stale detection — reads lock file JSON | **Per lock acquisition** | `readFileSync` |
| 27 | `src/entities/threads/service.ts:280-395` | Thread update/addTurn/completeTurn — read-modify-write metadata | **Per thread lifecycle event** | Tauri IPC `readJson` |

**Refactoring needed:**
- **(18-19)** Cache plan file content + thread metadata in-memory during PostToolUse hook chain; don't re-read within same hook execution
- **(20-22)** Already has Map cache for child state (22). Consider making (20-21) also use the same cache or an async write pattern
- **(23)** Maintain an in-memory registry of running children (already tracked via task spawning). Don't scan disk.
- **(24)** **Build a plan index file** (`~/.mort/plans-index.json`) mapping `repoId:relativePath -> planId`. Single read instead of O(N) scan. Update on plan creation/deletion.
- **(26)** Lock files should remain local even when data dir is remote. Consider a local lock sidecar.

---

### Tier 3 — LOW: Startup-only, background, or user-initiated

These either happen once or are background operations where latency is acceptable.

| # | Location | What | Frequency |
|---|----------|------|-----------|
| 28 | `agents/src/context.ts:25-68` | Git context — `execFileSync` x4 | Once per agent startup |
| 29 | `agents/src/runners/simple-runner-strategy.ts:266-313` | CWD validation — `existsSync` + `statSync` | Once per agent startup |
| 30 | `agents/src/runners/simple-runner-strategy.ts:322-330,481-563` | Thread metadata reads at startup/cleanup | Once per agent lifecycle |
| 31 | `agents/src/git.ts` | Various git commands | On-demand |
| 32 | `src-tauri/src/app-search.rs:46-84` | App index scan — `/Applications` | Once at startup (background) |
| 33 | `src-tauri/src/filesystem.rs:36-91` | `fs_read_file` / `fs_list_dir` Tauri commands | Passthrough (latency from callers) |
| 34 | `src-tauri/src/config.rs` | Config reads (no caching) | Per getter call |
| 35 | `src-tauri/src/git_commands.rs:1021` | Binary detection reads entire file | Per git diff |
| 36 | `agents/src/lib/hub/client.ts:142` | Socket file existence check | On disconnect (rare) |

**Refactoring needed (minor):**
- **(34)** Add in-memory cache to Rust config reader — currently re-reads on every getter
- **(35)** Use a small buffer (first 8KB) for binary detection instead of reading entire file

---

## Architecture Recommendations

### 1. Filesystem Abstraction Layer

Create a `DiskIO` interface that all code uses instead of direct `fs` calls:

```typescript
interface DiskIO {
  readJson<T>(path: string): Promise<T>
  readText(path: string): Promise<string>
  writeJson(path: string, data: unknown): Promise<void>
  writeText(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  listDir(path: string): Promise<string[]>
  glob(pattern: string): Promise<string[]>
}
```

- **Local implementation**: direct `fs/promises` calls (current behavior)
- **Remote implementation**: batched RPC over SSH/WebSocket with local LRU cache
- **Key**: All current `readFileSync` calls must become async

### 2. Eliminate All Synchronous Reads in Agent Process

The agent layer (`agents/src/`) uses `readFileSync` everywhere. This is the single biggest refactoring effort:
- 25+ callsites use `readFileSync`
- All are in the Node.js event loop — blocking
- With remote disk, each would add 50-200ms of blocked execution
- Must convert to `await readFile()` or cache-first patterns

### 3. Manifest-Based Hydration

Replace N individual file reads at startup with a single manifest:
```
~/.mort/manifest.json
{
  threads: { [id]: metadata },
  plans: { [id]: metadata },
  relations: { [edgeId]: relation },
  repos: { [slug]: settings }
}
```
- Written atomically on every metadata change
- One read to hydrate all stores
- Eliminates glob + N reads pattern entirely

### 4. Two-Tier Storage

Split data into **hot** (local) and **cold** (can be remote):
- **Hot (must stay local):** lock files, Unix sockets, SQLite databases, manifest.json, agent hub state
- **Cold (can be remote):** thread state.json, plan content, archived data, prompt history
- This separation means only cold-path reads need the remote-aware DiskIO

### 5. Incremental State Updates

Currently `loadThreadState()` re-reads the entire `state.json` (up to 2MB) on every agent event. Instead:
- Agent sends **incremental diffs** via socket (new messages only)
- Frontend applies diffs to in-memory state
- Full state.json read only on initial load or cache miss
- Eliminates the highest-frequency large read in the system

---

## Quantified Impact Summary

| Tier | Callsites | Approx reads/minute (active use) | Latency budget consumed at 100ms/read |
|------|-----------|----------------------------------|---------------------------------------|
| T0 | 5 | 30-60 (dominated by tool calls + state reload) | 3-6 seconds/minute of blocked time |
| T1 | 12 | 100+ at startup (burst), then 0 | 10+ seconds at startup |
| T2 | 10 | 5-15 (sub-agent operations, plan writes) | 0.5-1.5 seconds/minute |
| T3 | 9 | <1 | Negligible |

**Total estimated blocked time with naive remote disk: 15-25% of active agent operation time would be spent waiting on I/O.**

---

## Priority Order

1. **Convert `writeUsageToMetadata` to debounced in-memory** — single biggest per-turn win
2. **Cache `realpathSync` results** — eliminates 2 syscalls per tool call
3. **Build manifest.json for startup hydration** — eliminates 100+ IPC round-trips
4. **Build plan index for O(1) lookup** — eliminates O(N) scan per plan write
5. **Make `loadThreadState` incremental** — eliminates repeated large file reads
6. **Convert all agent `readFileSync` to async** — unblocks event loop for remote
7. **Implement `DiskIO` abstraction** — enables remote backend swap
8. **Add Rust-side config caching** — minor but easy win
