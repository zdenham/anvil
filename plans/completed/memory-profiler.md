# Memory Profiler for Frontend Webview Processes

## Problem

Multiple `tauri://localhost` webview processes are each consuming several GB of memory. The primary suspect is unbounded frontend JS state — particularly the `threadStates` cache in the threads Zustand store, which accumulates full thread states (messages, file changes, tool states) as users switch between threads and never evicts them.

## Approach

Add a **"Memory Snapshot"** option to the existing profiling dropdown in the logs toolbar (next to CPU Flamegraph and Chrome Trace). Clicking it captures a JSON report of all major Zustand store sizes and object counts, then writes it to the logs directory and opens it. This gives immediate visibility into _what_ is eating memory without requiring Chrome DevTools remote debugging.

Separately, add a **live memory indicator** to the diagnostic panel so memory pressure is visible at a glance during normal use.

## Phases

- [x] Add `captureMemorySnapshot()` utility that introspects all Zustand stores
- [x] Wire snapshot into the profiling dropdown in logs-toolbar
- [x] Add live memory summary section to DiagnosticPanel
- [x] Add a Rust command to capture the native process RSS for the report

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: `captureMemorySnapshot()` utility

Create `src/lib/memory-snapshot.ts` — a function that reads the current state of each major Zustand store and produces a structured report.

**Stores to introspect:**

| Store | Key fields | What to measure |
|-------|-----------|-----------------|
| `useThreadStore` | `threads`, `threadStates` | count of metadata entries, count of cached states, per-state message count + estimated byte size via `JSON.stringify().length` |
| `useTerminalSessionStore` | `sessions`, `outputBuffers` | count of sessions, total buffer size in bytes |
| `useStreamingStore` | `activeStreams` | count of active streams, total block content length |
| `useLogStore` | `logs` | count of log entries |
| `useHeartbeatStore` | `heartbeats`, `gapRecords` | counts |

**Report shape:**
```ts
interface MemorySnapshot {
  timestamp: string;
  jsHeap: { // performance.memory (Chrome/WebView only)
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
  nativeRss: number | null; // from Rust command (phase 4)
  stores: {
    threads: {
      metadataCount: number;
      cachedStateCount: number;
      cachedStateThreadIds: string[];
      perState: Record<string, {
        messageCount: number;
        fileChangeCount: number;
        toolStateCount: number;
        estimatedBytes: number;
      }>;
      totalEstimatedBytes: number;
    };
    terminalSessions: {
      sessionCount: number;
      bufferCount: number;
      totalBufferBytes: number;
      perBuffer: Record<string, number>; // bytes per terminal
    };
    streaming: {
      activeStreamCount: number;
      totalBlockContentBytes: number;
    };
    logs: { entryCount: number };
    heartbeat: { heartbeatCount: number; gapRecordCount: number };
  };
}
```

`JSON.stringify().length` is not a true heap measurement, but it's a good-enough proxy to find which threads are hogging memory. For actual heap profiling, users can use Chrome DevTools remote debugging — this tool is for quick triage.

**Implementation notes:**
- Import each store's `getState()` directly (no React needed)
- Use `JSON.stringify(value).length` for byte estimates (cheap enough for a one-shot snapshot)
- Guard `performance.memory` behind a type check (non-standard API, but available in WebView)

## Phase 2: Wire into profiling dropdown

Modify `src/components/main-window/logs-toolbar.tsx`:

1. Expand the `startProfiling` type union: `"cpu" | "trace" | "memory"`
2. Add a third button to the profiling dropdown menu: **"Memory Snapshot"** with label **"instant"** (instead of "10s")
3. When `type === "memory"`:
   - Call `captureMemorySnapshot()` (no Tauri invoke needed for the JS portion)
   - Write the JSON to the logs dir via a new Rust command `write_memory_snapshot` (or reuse existing file-write patterns)
   - Set `profilingResult` to the file path so the existing "Open result" popup works
4. Update the button title/tooltip to say "Profile" instead of "Profile CPU" since it's more general now

**Rust side** — add a simple `write_memory_snapshot` command in `profiling.rs`:
```rust
#[tauri::command]
pub async fn write_memory_snapshot(
    app: tauri::AppHandle,
    snapshot_json: String,
) -> Result<String, String>
```
This writes the JSON string to `{logs_dir}/memory-snapshot-{timestamp}.json` and returns the path. This keeps file I/O in Rust (consistent with the other profilers) and avoids needing the fs plugin.

## Phase 3: Live memory summary in DiagnosticPanel

Add a new **"Memory"** section to `src/components/diagnostics/diagnostic-panel.tsx`:

- Poll every 5s (or on-demand via Refresh button) using a `useEffect` interval
- Show:
  - **JS Heap**: `usedJSHeapSize / totalJSHeapSize` (from `performance.memory`)
  - **Cached thread states**: count + total estimated MB
  - **Terminal buffers**: count + total MB
  - **Active streams**: count
- Color-code: green < 500MB, amber 500MB–1GB, red > 1GB
- Include a "Capture Snapshot" button that triggers the full `captureMemorySnapshot()` and downloads the JSON (reuses phase 1 + 2 logic)

This section is lightweight — it only counts keys and sums buffer lengths, no full serialization on the polling path.

## Phase 4: Native RSS in the report

Add a Rust command `get_process_memory` that returns the resident set size of the main Tauri process. On macOS this can use `mach_task_basic_info` (via the `mach2` crate or raw FFI) or simply shell out to `ps -o rss= -p {pid}`. Include this in the snapshot report as `nativeRss`.

This helps distinguish "is the memory in JS heap or in native allocations (images, WebView internals, etc.)".

**Approach**: Use the `sysinfo` crate (lightweight, cross-platform) to get RSS for the current PID. Add `sysinfo = "0.33"` to `Cargo.toml` with minimal features.

```rust
#[tauri::command]
pub fn get_process_memory() -> Result<u64, String> {
    use sysinfo::{Pid, System};
    let pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();
    sys.refresh_process(pid);
    sys.process(pid)
        .map(|p| p.memory())
        .ok_or_else(|| "Process not found".to_string())
}
```

## Files to create/modify

| File | Action |
|------|--------|
| `src/lib/memory-snapshot.ts` | **Create** — snapshot capture utility |
| `src/components/main-window/logs-toolbar.tsx` | **Modify** — add Memory Snapshot to dropdown |
| `src/components/diagnostics/diagnostic-panel.tsx` | **Modify** — add Memory section |
| `src-tauri/src/profiling.rs` | **Modify** — add `write_memory_snapshot` + `get_process_memory` commands |
| `src-tauri/src/lib.rs` | **Modify** — register new commands in `generate_handler!` |
| `src-tauri/Cargo.toml` | **Modify** — add `sysinfo` dependency |

## Deep Heap Analysis via Safari Web Inspector

For full object-level heap profiling (closures, detached DOM trees, GC roots, etc.), Safari Web Inspector is the only option on macOS — Tauri uses WKWebView which has no programmatic heap snapshot API.

**How to connect:**

1. Enable the Develop menu: Safari → Settings → Advanced → "Show features for web developers"
2. Launch Anvil in dev mode (`pnpm tauri dev`)
3. In Safari: Develop → _your machine name_ → `tauri://localhost` (the webview process)
4. Go to the **Memory** tab in the inspector
5. Click **"Take Heap Snapshot"** for a full object graph, or use **"Record"** for allocation timeline

**What you get:**
- Full object graph with retainer chains (who's keeping what alive)
- Allocation timeline showing which objects are being created over time
- Detached DOM node identification
- Closure scope inspection (see what variables a closure captures)

**Exporting:**
- Cmd+S on a timeline recording exports a **JSON file** in Safari's proprietary format
- Heap snapshots themselves are not directly exportable in a standard format
- [Speedscope](https://speedscope.app) can visualize Safari timeline exports (performance, not heap)

**Limitations:**
- Manual only — no way to automate from page JS or Rust
- Can't be triggered from the profiling dropdown
- Requires dev mode (Safari won't inspect production builds unless code-signed with `get-task-allow`)

This is complementary to the automated profiler: use the snapshot tool (phases 1-4) for quick triage, then connect Safari Inspector when you need to trace a specific leak to its root cause.

## Out of scope (but noted for follow-up)

- **Automatic `threadStates` eviction** — the snapshot will make it obvious this is needed, but the eviction policy (LRU, max count, etc.) is a separate task
- **Bundled Chromium** — Tauri v2 can't swap WKWebView for Chromium on macOS; this is discussed for Tauri v3+ but has no timeline
- **Per-window memory** — Tauri doesn't expose per-webview memory easily; this profiles the main window's JS context. Other windows (control panel, spotlight) can capture their own snapshots if needed
- **JS-layer instrumentation** (addEventListener wrapping, timer tracking, WeakRef leak probes, React fiber walking) — these are feasible cross-browser but add complexity and fragility; consider as a follow-up if store introspection + RSS + Safari Inspector aren't sufficient
