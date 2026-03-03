# Frontend Performance Fixes

Analysis of Safari Web Inspector timeline recording (`~/Downloads/timelines-2.json`) — 60 seconds of recording revealing severe main-thread starvation.

## Executive Summary

The app runs at **~20 FPS average** with sustained periods of **<1 FPS** (1.4-1.6 second frames) during agent activity. The root cause is a **microtask storm**: 115,000 microtasks and 7,800 script evaluations in 60 seconds, primarily driven by excessive IPC calls that each create Promise chains which overwhelm the main thread's microtask queue.

## Key Metrics

| Metric | Value | Target |
|--------|-------|--------|
| Average frame time | 50.4ms (20 FPS) | <16.7ms (60 FPS) |
| Frames over 16ms | 1,126/1,179 (96%) | <5% |
| Frames over 200ms | 14 | 0 |
| Worst frame | 1,621ms | <16.7ms |
| Peak microtasks/sec | 7,112 (at t=335) | <100 |
| IPC calls (60s) | 12,846 total | <500 |

## Root Causes (ordered by impact)

### 1. Debug logging via Tauri IPC — 10,378 calls in 60s

**The #1 bottleneck.** Every `logger.debug()` call fires `invoke("web_log", ...)` which creates a Promise + microtask, even for debug-level messages in production.

**Files:**
- `src/lib/logger-client.ts:33-39` — `sendLog()` always calls `invoke()` regardless of log level
- `src/lib/agent-service.ts:146-150` — logs every single agent message received
- `src/lib/agent-service.ts:116` — logs pipeline trail for every message (when diagnostics enabled)
- `src/entities/terminal-sessions/listeners.ts:41-47` — logs every terminal output chunk

**Fix:** Add a client-side log level gate in `sendLog()`. Debug messages should never cross the IPC bridge in production. This alone would eliminate ~80% of IPC traffic.

```typescript
// logger-client.ts
const LOG_LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel: LogLevel = import.meta.env.DEV ? "debug" : "info";

function sendLog(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) return;
  const message = formatArgs(...args);
  invoke("web_log", { level, message, source: logSource }).catch(() => {});
}
```

### 2. Uncached `findThreadPath()` causes cascading fs_exists — 1,246 calls in 60s

Each `AGENT_STATE` event triggers `findThreadPath()` 2-3 times (once in `refreshById()`, again in `loadThreadState()`, again for parent). Each call does `fs_exists` IPC, and falls back to a recursive glob traversal if the new path doesn't match.

**Files:**
- `src/entities/threads/service.ts:44-58` — `findThreadPath()` with no caching
- `src/entities/threads/service.ts:126-160` — `refreshById()` calls it
- `src/entities/threads/service.ts:535-627` — `loadThreadState()` calls it again
- `src/entities/threads/listeners.ts:94-124` — listener triggers both + parent refresh

**Fix:** Add a path cache to `findThreadPath()` (threadId → path). Invalidate on thread creation/deletion only.

### 3. AGENT_STATE listener triggers redundant cascading work

Every single `AGENT_STATE` event (many per second during active sessions) triggers:
1. `refreshById(threadId)` — findThreadPath + readJson (2-3 IPC calls)
2. `loadThreadState(threadId)` — findThreadPath again + readJson (2-3 more IPC calls)
3. `refreshById(parentThreadId)` — same cascade for parent (2-3 more)

This means **6-9 IPC calls per state event**, with no debouncing.

**Files:**
- `src/entities/threads/listeners.ts:94-124` — the listener that triggers all of this

**Fix:** Debounce `AGENT_STATE` handling per threadId (e.g., 100-200ms). Multiple state updates within the debounce window collapse into a single refresh. Also, batch `refreshById` + `loadThreadState` to share the `findThreadPath` result.

### 4. Terminal output chunk logging adds to IPC pressure

Each terminal output chunk triggers a debug log with metadata. During active agent sessions, terminal output is continuous.

**File:** `src/entities/terminal-sessions/listeners.ts:41-47`

**Fix:** Already addressed by fix #1 (log level gating). Optionally, consider batching terminal output processing.

### 5. Glob pattern matching uses recursive IPC traversal

The fallback path discovery in `findThreadPath()` uses `appData.glob()` which recursively lists directories via IPC. Each directory listing is a separate `fs_list_dir` IPC call.

**File:** `src/lib/app-data-store.ts:186-253` — `globRecursive()` method

**Fix:** Already addressed by fix #2 (caching findThreadPath). The glob should rarely be needed once paths are cached.

## Phases

- [ ] Gate logger-client by log level to eliminate debug IPC calls
- [x] Add path cache to findThreadPath() with invalidation
- [ ] Debounce AGENT_STATE listener per threadId
- [ ] Batch refreshById + loadThreadState to share findThreadPath result

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Secondary Issues (lower priority)

### Forced Layouts (428 occurrences)
Individually fast (<2.2ms each), but they indicate read-write-read DOM patterns. Not the primary bottleneck but worth addressing later.

### 54,709 Paint Events
High paint count suggests DOM mutations are not batched. React should handle this, but frequent state updates from the IPC storm cause excessive re-renders. Fixing the IPC volume will naturally reduce paints.

### 7,807 Script Evaluations
Likely Tauri's internal module loading/evaluation. Not directly actionable but will decrease as IPC volume drops.

## Expected Impact

| Fix | IPC Reduction | Frame Time Impact |
|-----|--------------|-------------------|
| Log level gating | -10,378 calls (-81%) | Major — eliminates bulk of microtask storm |
| Path caching | -1,000+ calls (-8%) | Moderate — eliminates redundant fs_exists |
| Debounce AGENT_STATE | -50% of remaining | Significant — collapses rapid-fire refreshes |
| Batch thread operations | -30% of remaining | Moderate — shares path lookups |

Combined, these fixes should reduce IPC calls from ~12,800 to ~500-1,000 per 60 seconds, bringing frame times well under 16ms during normal operation.
