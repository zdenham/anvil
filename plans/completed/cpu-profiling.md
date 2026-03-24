# CPU Profiling: Diagnose 100% Idle CPU Usage

The Tauri binary consumes 100% CPU even at idle (no agents running, fresh launch). We need programmatic profiling to identify the hot path.

> **IMPORTANT: All profiling is strictly on-demand.**
>
> Nothing in this plan runs at startup or during normal operation. Both the trace capture (`tracing-chrome`) and the CPU sampler (`pprof`) are **off by default** and only activate when explicitly triggered from the UI or dev console. There is **zero performance impact** on normal usage — no background threads, no file I/O, no sampling overhead unless the user opts in.

> **How it works at runtime:**
>
> - **Normal launch**: No profiling code executes. The `tracing-chrome` layer is not attached. The `pprof` sampler is not running. No trace files are written.
> - **User triggers profiling**: A Tauri IPC command (`start_trace` / `capture_cpu_profile`) activates the profiler for a bounded duration, writes results to disk, then stops.
> - **After profiling completes**: Everything returns to the normal no-overhead state.

## Phases

- [x] Add `tracing-chrome` and `pprof` deps (gated behind on-demand activation)
- [x] Instrument background threads with tracing spans (zero-cost when no subscriber active)
- [x] Add Tauri commands to start/stop trace and capture CPU profile on demand
- [x] Add profiling UI trigger to logs toolbar
- [ ] Build and capture a trace, analyze results

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

Users report 100% CPU on the Tauri binary at idle — even immediately after a fresh launch with no agents running. Manual code review identified several background loops (clipboard polling at 500ms, agent hub accept at 50ms, terminal reader loops) but none individually explain the spike. We need real profiling data.

## Strategy

Use **`tracing-chrome`** to emit Chrome Trace Format (`.json`) files that can be opened in `chrome://tracing` or [Perfetto](https://ui.perfetto.dev). This leverages the existing `tracing` + `tracing-subscriber` infrastructure already in the codebase — we just add one more layer.

For CPU sampling, we add a Tauri IPC command that captures a **pprof-style CPU profile** using the `pprof` crate, writing a flamegraph SVG on demand.

> **Both tools are activated only on demand** — triggered by explicit IPC calls from the UI or dev console. They are never enabled at startup and have no runtime cost during normal operation.

---

## Phase 1: Add `tracing-chrome` and `pprof` Dependencies

> **These are compile-time dependencies only.** Adding the crates does not activate any profiling at runtime. The profiling code paths are only invoked through explicit IPC commands (Phase 3).

### Dependencies

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tracing-chrome = "0.7"
pprof = { version = "0.14", features = ["flamegraph", "criterion"] }
```

Note: `pprof` only works on Linux/macOS. Guard with `#[cfg(unix)]` if needed.

### DO NOT wire into `init_logging()`

The `tracing-chrome` layer is **not** added to the default subscriber at startup. Instead, it will be activated on demand via Tauri IPC commands (see Phase 3). This ensures zero overhead during normal operation.

The tracing spans added in Phase 2 use the standard `tracing` macros which are effectively no-ops when no chrome layer subscriber is active — they compile down to a disabled atomic check.

---

## Phase 2: Instrument Background Threads

Add `#[tracing::instrument]` and named spans to the key background loops. These are the prime suspects:

### `src-tauri/src/agent_hub.rs` — Socket accept loop
```rust
// In the accept loop:
let _span = tracing::info_span!("agent_hub_accept_loop").entered();
// Inside each iteration:
tracing::trace!("agent_hub_tick");
```

### `src-tauri/src/clipboard.rs` — Clipboard polling loop
```rust
let _span = tracing::info_span!("clipboard_poll_loop").entered();
// Each poll:
tracing::trace!("clipboard_poll_tick");
```

### `src-tauri/src/terminal.rs` — Terminal reader loops
```rust
let _span = tracing::info_span!("terminal_reader", session_id = %id).entered();
```

### `src-tauri/src/logging/log_server.rs` — Log server recv loop
```rust
let _span = tracing::info_span!("log_server_loop").entered();
```

### `src-tauri/src/app-search.rs` — App search indexing
```rust
let _span = tracing::info_span!("app_search_index").entered();
```

### `src-tauri/src/icons.rs` — Icon extraction
```rust
let _span = tracing::info_span!("icon_extraction").entered();
```

### Tauri event emission / IPC handlers

Instrument the high-frequency IPC commands:
```rust
#[tracing::instrument(skip(app))]
#[tauri::command]
fn web_log(...) { ... }
```

---

## Phase 3: Add On-Demand Profiling Commands

> **All profiling is triggered explicitly via IPC.** Nothing starts at launch. The commands below are the only way to activate profiling, and each one stops automatically after the requested duration.

Two IPC commands — one for tracing timeline, one for CPU flamegraph:

### `src-tauri/src/profiling.rs` (new file)

#### Command 1: `start_trace` — On-demand tracing-chrome capture

```rust
use std::sync::Mutex;
use tracing_chrome::{ChromeLayerBuilder, FlushGuard};

// Held in Tauri managed state — None when not profiling
pub struct TraceState(pub Mutex<Option<FlushGuard>>);

#[tauri::command]
pub async fn start_trace(
    app: tauri::AppHandle,
    state: tauri::State<'_, TraceState>,
    duration_secs: u64,
) -> Result<String, String> {
    // Activate the chrome trace layer on demand
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let trace_path = data_dir.join("logs").join(format!(
        "trace-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));

    let (chrome_layer, guard) = ChromeLayerBuilder::new()
        .file(&trace_path)
        .include_args(true)
        .build();

    // Attach layer dynamically (via reload handle or similar)
    // Store guard so trace stays active
    *state.0.lock().unwrap() = Some(guard);

    // Auto-stop after duration
    tokio::time::sleep(std::time::Duration::from_secs(duration_secs)).await;

    // Drop guard to flush and finalize the trace file
    *state.0.lock().unwrap() = None;

    Ok(trace_path.to_string_lossy().to_string())
}
```

#### Command 2: `capture_cpu_profile` — On-demand pprof flamegraph

```rust
use pprof::ProfilerGuardBuilder;
use std::fs::File;

#[tauri::command]
pub async fn capture_cpu_profile(
    app: tauri::AppHandle,
    duration_secs: u64,
) -> Result<String, String> {
    // Profiler only runs for the requested duration, then stops
    let guard = ProfilerGuardBuilder::default()
        .frequency(997)  // ~1000 Hz sampling, prime to avoid aliasing
        .blocklist(&["libc", "libsystem", "pthread"])
        .build()
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(std::time::Duration::from_secs(duration_secs)).await;

    let report = guard.report().build().map_err(|e| e.to_string())?;

    // Write flamegraph SVG
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile_path = data_dir.join("logs").join(format!(
        "cpu-profile-{}.svg",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let file = File::create(&profile_path).map_err(|e| e.to_string())?;
    report.flamegraph(file).map_err(|e| e.to_string())?;

    // Also write proto for further analysis
    let proto_path = profile_path.with_extension("pb");
    let mut proto_file = File::create(&proto_path).map_err(|e| e.to_string())?;
    report.pprof().map_err(|e| e.to_string())?
        .write_to_writer(&mut proto_file)
        .map_err(|e| e.to_string())?;

    Ok(profile_path.to_string_lossy().to_string())
}
```

Register both in the Tauri command handler:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    start_trace,
    capture_cpu_profile,
])
```

### Frontend trigger (from dev console or UI)

```typescript
import { invoke } from "@tauri-apps/api/core";

// Capture a 10-second trace timeline
const tracePath = await invoke<string>("start_trace", { durationSecs: 10 });
console.log("Trace written to:", tracePath);

// Capture a 10-second CPU flamegraph
const flamePath = await invoke<string>("capture_cpu_profile", { durationSecs: 10 });
console.log("Flamegraph written to:", flamePath);
```

---

## Phase 4: Add Profiling UI to Logs Toolbar

The Tauri commands exist but there's no UI to trigger them — only dev console invocations. Add a dropdown button to the logs toolbar.

### Single file change: `src/components/main-window/logs-toolbar.tsx`

#### Imports to add

```tsx
import { Activity, Check, ChevronDown, Copy, Loader2, Search, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
```

#### State + handlers

- `profilingType: "cpu" | "trace" | null` — tracks active profiling session
- `profilingResult: string | null` — output file path on success
- `profilingError: string | null` — error message on failure
- `showProfilingMenu: boolean` — dropdown visibility
- `profilingMenuRef` — for outside-click dismissal

Handler calls `invoke<string>("capture_cpu_profile" | "start_trace", { durationSecs: 10 })`. Auto-resets result/error after 5s following the existing `isCopied` feedback pattern.

#### Button UI in the right-side button group (before copy button)

A single button with a dropdown containing two options:

| State | Icon | Color | Behavior |
|-------|------|-------|----------|
| Idle | `Activity` | gray | Click opens dropdown with "CPU Flamegraph" / "Chrome Trace" |
| Profiling | `Loader2` (spinning) | amber | Disabled, tooltip shows type |
| Success | `Check` | green (5s) | Inline "Open" link appears, calls `open(path)` from shell plugin |
| Error | `Activity` | red (5s) | Error message in tooltip |

Dropdown styling matches the existing level-filter dropdown: `bg-surface-800 border border-surface-700 rounded-lg shadow-lg`.

#### `capture_cpu_profile` is `#[cfg(unix)]` only

Let it fail gracefully on non-unix — the error gets caught and shown in tooltip. This is a dev tool targeting macOS, so no platform gating needed in the UI.

---

## Phase 5: Build and Capture

### Build with debug symbols

Ensure `Cargo.toml` has a profile that keeps symbols for profiling:

```toml
[profile.release]
debug = 1  # Line tables only — minimal size increase, enables symbol resolution
```

Or for dev builds (already has full debug info), just:
```bash
cd src-tauri && cargo build
```

### Capture traces

1. Launch the app
2. Wait 10-20 seconds at idle
3. Either:
   - Call `capture_cpu_profile` from dev console (flamegraph approach)
   - Kill the app gracefully to flush the `tracing-chrome` trace file
4. Open `trace.json` in `chrome://tracing` or Perfetto
5. Open the `.svg` flamegraph in a browser

### What to look for

- **In the trace timeline**: Solid blocks of color = threads that never sleep. Gaps = proper idle. Zoom into the first 10 seconds after launch.
- **In the flamegraph**: Tall/wide stacks = functions consuming the most CPU. Look for:
  - `std::thread::sleep` being absent (busy-wait)
  - `poll` / `recv` / `accept` in tight loops
  - WebKit/WKWebView rendering cycles
  - Serialization (serde) in hot paths
  - Lock contention (Mutex/RwLock)

---

## Files to Modify

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tracing-chrome`, `pprof` deps |
| `src-tauri/src/logging/mod.rs` | Add chrome trace layer |
| `src-tauri/src/agent_hub.rs` | Add tracing spans |
| `src-tauri/src/clipboard.rs` | Add tracing spans |
| `src-tauri/src/terminal.rs` | Add tracing spans |
| `src-tauri/src/logging/log_server.rs` | Add tracing spans |
| `src-tauri/src/app-search.rs` | Add tracing spans |
| `src-tauri/src/icons.rs` | Add tracing spans |
| `src-tauri/src/anvil_commands.rs` | Add `capture_cpu_profile` command |
| `src-tauri/src/lib.rs` | Register new command |
| `src/components/main-window/logs-toolbar.tsx` | Add profiling dropdown button (Phase 4) |

## Alternatives Considered

- **`perf` / `Instruments.app`**: Manual tools, not programmatic. Good for one-off investigation but can't be triggered from the app itself or automated.
- **`tracing-flame`**: Outputs folded stacks for `inferno`. Similar to tracing-chrome but less visual. Chrome trace format is more universally useful.
- **`tokio-console`**: Only profiles async Tokio tasks. Anvil uses `std::thread` for most background work, so this misses the key threads.
- **`samply`**: Excellent macOS sampling profiler. Could complement this work but requires manual invocation (`samply record ./anvil`). Worth trying in addition to the built-in approach.
