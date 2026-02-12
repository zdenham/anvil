# CPU Profiling: Diagnose 100% Idle CPU Usage

The Tauri binary consumes 100% CPU even at idle (no agents running, fresh launch). We need programmatic profiling to identify the hot path.

## Phases

- [ ] Add `tracing-chrome` for programmatic trace capture
- [ ] Instrument background threads with tracing spans
- [ ] Add a Tauri command to dump a CPU sample on demand
- [ ] Build and capture a trace, analyze results

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

Users report 100% CPU on the Tauri binary at idle — even immediately after a fresh launch with no agents running. Manual code review identified several background loops (clipboard polling at 500ms, agent hub accept at 50ms, terminal reader loops) but none individually explain the spike. We need real profiling data.

## Strategy

Use **`tracing-chrome`** to emit Chrome Trace Format (`.json`) files that can be opened in `chrome://tracing` or [Perfetto](https://ui.perfetto.dev). This leverages the existing `tracing` + `tracing-subscriber` infrastructure already in the codebase — we just add one more layer.

For CPU sampling, we add a Tauri IPC command that captures a **pprof-style CPU profile** using the `pprof` crate, writing a flamegraph SVG on demand.

Both approaches are programmatic — no manual Activity Monitor needed.

---

## Phase 1: Add `tracing-chrome` for Trace Capture

### Dependencies

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tracing-chrome = "0.7"
pprof = { version = "0.14", features = ["flamegraph", "criterion"] }
```

Note: `pprof` only works on Linux/macOS. Guard with `#[cfg(unix)]` if needed.

### Wire into logging layer stack

In `src-tauri/src/logging/mod.rs`, add a `tracing_chrome::ChromeLayerBuilder` alongside the existing layers:

```rust
use tracing_chrome::ChromeLayerBuilder;

// Inside init_logging() or equivalent:
let (chrome_layer, _chrome_guard) = ChromeLayerBuilder::new()
    .file(log_dir.join("trace.json"))
    .include_args(true)
    .build();

// Add to the subscriber layering:
// subscriber.with(chrome_layer)
```

The `_chrome_guard` must be held alive (store in a `OnceCell<FlushGuard>` or pass to app state) — dropping it flushes and finalizes the trace file.

### What this gives us

Every `#[tracing::instrument]` span and `tracing::info!()` event in the Rust code will appear as spans in the trace timeline. We can see:
- Which threads are active and for how long
- Which functions dominate CPU time
- Where busy-wait loops show up as solid blocks

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

## Phase 3: Add On-Demand CPU Profile Command

Add a Tauri command that captures a CPU profile for N seconds and writes a flamegraph:

### `src-tauri/src/mort_commands.rs` (or new `profiling.rs`)

```rust
use pprof::ProfilerGuardBuilder;
use std::fs::File;

#[tauri::command]
pub async fn capture_cpu_profile(
    app: tauri::AppHandle,
    duration_secs: u64,
) -> Result<String, String> {
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

Register in the Tauri command handler:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    capture_cpu_profile,
])
```

### Frontend trigger (optional convenience)

Add to the control panel or call from the dev console:
```typescript
import { invoke } from "@tauri-apps/api/core";
const path = await invoke<string>("capture_cpu_profile", { durationSecs: 10 });
console.log("Flamegraph written to:", path);
```

---

## Phase 4: Build and Capture

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
| `src-tauri/src/mort_commands.rs` | Add `capture_cpu_profile` command |
| `src-tauri/src/lib.rs` | Register new command |

## Alternatives Considered

- **`perf` / `Instruments.app`**: Manual tools, not programmatic. Good for one-off investigation but can't be triggered from the app itself or automated.
- **`tracing-flame`**: Outputs folded stacks for `inferno`. Similar to tracing-chrome but less visual. Chrome trace format is more universally useful.
- **`tokio-console`**: Only profiles async Tokio tasks. Mort uses `std::thread` for most background work, so this misses the key threads.
- **`samply`**: Excellent macOS sampling profiler. Could complement this work but requires manual invocation (`samply record ./mort`). Worth trying in addition to the built-in approach.
