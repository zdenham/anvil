# Batch Frontend Logging to Eliminate IPC Storm

Extracted from `memory-and-perf-from-timeline.md` Phase 1.

## Phases

- [x] Add log queue with creation-time timestamps and batched flush
- [x] Add `web_log_batch` Tauri command on the Rust side
- [x] Wire up flush-on-unload, immediate flush for error only

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

361 `web_log` IPC calls in 10s, consuming **5,686ms** total IPC time (more than all layout+paint+compositing combined). 30 calls took 100-200ms each, likely queued behind other IPC.

**Root cause**: `logger-client.ts:sendLog()` calls `invoke("web_log", ...)` on every single log statement — each is a full Tauri IPC round-trip.

```
Before: 361 IPC calls × 15.8ms avg = 5,686ms
After:  ~20 IPC calls × ~20ms avg = ~400ms (estimated 93% reduction)
```

## Timestamp Ordering Requirement

When logs are batched, the Rust side receives them at flush time, not creation time. Each log entry **must capture `Date.now()` at creation time** so the backend can order them correctly. This is critical — the timeline viewer relies on log ordering to make sense of event sequences.

The batch payload shape should be:
```ts
type BatchEntry = {
  level: LogLevel;
  message: string;
  source: string;
  timestamp: number; // Date.now() at log creation time
};
```

The Rust `web_log_batch` command should use the provided timestamp (not `SystemTime::now()`) when writing log entries.

## Implementation

### `src/lib/logger-client.ts`

- Add a `queue: BatchEntry[]` buffer
- In `sendLog()`: push `{ level, message, source, timestamp: Date.now() }` to queue instead of invoking IPC
- Add `flushQueue()` that calls `invoke("web_log_batch", { entries: queue })` and clears the queue
- Schedule flush via `setInterval(flushQueue, 500)` or `requestIdleCallback` with 500ms timeout
- For `error` level only: push to queue AND call `flushQueue()` immediately (`warn` is batched normally)
- Register `window.addEventListener("beforeunload", flushQueue)` so logs aren't lost on close
- Keep fire-and-forget semantics — don't await the batch invoke

### `src-tauri/src/lib.rs`

- Add `web_log_batch` command that accepts `Vec<LogEntry>` where `LogEntry` has `level`, `message`, `source`, `timestamp`
- Register in Tauri command list

### `src-tauri/src/logging/mod.rs`

- Add `log_batch_from_web(entries: Vec<LogEntry>)` helper
- Use provided `timestamp` field for log ordering, not `SystemTime::now()`
- Iterate entries and write each through existing log infrastructure

## Constraints

- Must flush on `beforeunload` so logs aren't lost on window close
- Keep fire-and-forget semantics (don't await the batch invoke)
- `error` level flushes immediately (don't delay error visibility); `warn` batches normally
- Each entry carries its own creation timestamp for correct ordering
