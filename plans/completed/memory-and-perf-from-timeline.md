# Memory & Performance Fixes (from Safari Timeline Analysis)

A Safari Web Inspector timeline recording (~10s during agent streaming) revealed concrete, data-backed performance issues. This plan addresses them in order of measured impact.

## Data Summary

- **Recording**: `~/Downloads/timelines-3.json`, ~10s during active agent streaming
- **JS Heap**: 249 MB → 416 MB (+167 MB), never reclaimed by GC
- **GC**: 5 pauses totaling 814ms (8.1% of wall time), worst = 286ms full GC
- **Worst frames**: 431ms, 149ms, 139ms (all GC-correlated)
- **FPS**: 55.4 avg, drops to 2.3 fps during full GC
- **143.6 MB WASM ArrayBuffer** is static and expected (likely Tauri bridge)

## Phases

- [ ] Batch frontend logging to eliminate IPC storm
- [ ] Debounce/coalesce loadThreadState during streaming bursts
- [ ] Remove render-path logging from hot components
- [ ] Audit and reduce forced layouts during streaming

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Batch frontend logging to eliminate IPC storm

**Measured cost**: 361 `web_log` IPC calls in 10s, consuming **5,686ms** total IPC time (more than all layout+paint+compositing combined). 30 calls took 100-200ms each, likely queued behind other IPC.

**Root cause**: `logger-client.ts:sendLog()` calls `invoke("web_log", ...)` on every single log statement — each one is a full Tauri IPC round-trip.

**Fix**: Buffer log messages in memory and flush them in a single batched IPC call on a timer (e.g. every 500ms or on `requestIdleCallback`).

```
Before: 361 IPC calls × 15.8ms avg = 5,686ms
After:  ~20 IPC calls × ~20ms avg = ~400ms (estimated 93% reduction)
```

**Files to change**:
- `src/lib/logger-client.ts` — add message queue + flush timer + batched `invoke("web_log_batch", ...)`
- `src-tauri/src/lib.rs` — add `web_log_batch` command that accepts `Vec<LogEntry>`
- `src-tauri/src/logging/mod.rs` — add `log_batch_from_web()` helper

**Constraints**:
- Must flush on `beforeunload` so logs aren't lost on window close
- Keep fire-and-forget semantics (don't await the batch invoke)
- `error` and `warn` levels should flush immediately (don't delay error visibility)

## Phase 2: Debounce/coalesce loadThreadState during streaming bursts

**Measured cost**: 4 `loadThreadState` cycles in 10s, each reading `metadata.json` (12 reads), `state.json` (4 reads), `tree-menu.json` (5 reads), and listing `plan-thread-edges/` dir (5 reads, 310KB each = 1.5MB total). Plus 50 `AGENT_STATE` events trigger 59 `activeState selector` evaluations and 28 full ThreadContent renders.

**Root cause**: Every `AGENT_STATE` event in `listeners.ts:108` calls `loadThreadState()` if the thread is active. During streaming, agent persists state rapidly → multiple state events per second → redundant disk reads via IPC.

**Fix**: Debounce/coalesce `loadThreadState` calls. When multiple AGENT_STATE events fire within a short window, only execute the last one.

**Files to change**:
- `src/entities/threads/service.ts` — add a per-threadId debounced wrapper around `loadThreadState()` (~200ms trailing edge debounce)
- `src/entities/threads/listeners.ts` — use the debounced version in the AGENT_STATE handler

**Constraints**:
- AGENT_COMPLETED should still trigger immediate (non-debounced) load
- First call for a newly-active thread should be immediate (leading edge)
- The debounce should be per-threadId so different threads don't interfere

## Phase 3: Remove render-path logging from hot components

**Measured cost**: 63 `[ThreadContent:TIMING]` logs, 29 `[ThreadView:TIMING]` logs, 28 `[ThreadContent] RENDER` logs — all via IPC during the 10s window. The ChatPane render log at `chat-pane.tsx:46` fires on *every render* (it's in the component body, not a useEffect).

**Root cause**: Debug logging was added during development and left in hot render paths.

**Fix**: Either remove these logs entirely or gate them behind a debug flag / `import.meta.env.DEV` check so they don't fire in production builds.

**Files to change**:
- `src/components/workspace/chat-pane.tsx` — remove or gate the render log
- `src/components/content-pane/thread-content.tsx` — remove or gate timing logs
- `src/components/thread/thread-view.tsx` — remove or gate timing logs
- `src/components/thread/message-list.tsx` — remove or gate timing log

**Note**: These logs become much cheaper after Phase 1 (batched), but they still cause unnecessary work in render paths and inflate the log volume.

## Phase 4: Audit and reduce forced layouts during streaming

**Measured cost**: 27 forced synchronous layouts, with 13 (48%) concentrated at t=100s during peak activity. Layout invalidations triple from ~55/sec baseline to ~160/sec during streaming. 1,524ms total compositing time.

**Root cause**: Code reading layout properties (e.g. `scrollHeight`, `offsetWidth`, `getBoundingClientRect()`) after DOM mutations forces synchronous layout computation.

**Approach**: This phase is investigative. The timeline data shows forced layouts happen but doesn't identify the exact JS call sites. Steps:
1. Use Chrome DevTools Performance panel (if possible via debug flags) or add instrumentation to identify which components trigger forced layouts
2. Common culprits in chat UIs: auto-scroll logic reading `scrollHeight` after message append, virtualized list measuring item heights
3. Look at scroll-to-bottom behavior in `message-list.tsx` and any `ResizeObserver` callbacks

**Files to investigate**:
- `src/components/thread/message-list.tsx` — scroll management
- `src/components/thread/thread-view.tsx` — container layout
- Any component using `getBoundingClientRect()`, `offsetHeight`, `scrollHeight` in render or effect paths

## What this plan does NOT address

- **JIT code accumulation** (+1,341 FunctionCodeBlocks, +4.5MB): This is a JSC engine behavior from compiling/recompiling functions during rapid React re-renders. The debouncing in Phase 2 should reduce re-render frequency, which indirectly reduces JIT churn. No direct fix available from app code.
- **GC pause duration** (286ms full GC): Reducing allocation pressure (Phases 1-3) will reduce GC frequency and severity, but pause duration is a JSC engine characteristic. The 143.6MB WASM ArrayBuffer is the main heap anchor.
- **rAF doubling during streaming**: The 2x requestAnimationFrame rate is a symptom of frequent React state updates. Phase 2's debouncing should naturally reduce this.
