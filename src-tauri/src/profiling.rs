//! On-demand CPU profiling commands.
//!
//! Both commands are triggered explicitly via IPC — nothing runs at startup.
//! The profilers activate for a bounded duration, write results to disk, then stop.

use std::sync::Mutex;
use tauri::Manager;

/// State to prevent concurrent profiling sessions.
pub struct ProfilingState(pub Mutex<bool>);

/// Captures a CPU flamegraph using pprof for the specified duration.
/// Writes an SVG flamegraph and a protobuf profile to the app's logs directory.
/// Only available on unix (macOS/Linux) where pprof is supported.
#[cfg(unix)]
#[tauri::command]
pub async fn capture_cpu_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProfilingState>,
    duration_secs: Option<u64>,
) -> Result<String, String> {
    let duration_secs = duration_secs.unwrap_or(10);

    // Prevent concurrent profiling
    {
        let mut active = state.0.lock().map_err(|e| e.to_string())?;
        if *active {
            return Err("Profiling already in progress".to_string());
        }
        *active = true;
    }

    let result = run_cpu_profile(&app, duration_secs).await;

    // Always release the lock
    if let Ok(mut active) = state.0.lock() {
        *active = false;
    }

    result
}

#[cfg(unix)]
async fn run_cpu_profile(app: &tauri::AppHandle, duration_secs: u64) -> Result<String, String> {
    use pprof::ProfilerGuardBuilder;
    use std::fs::File;
    use std::io::Write;

    tracing::info!(duration_secs, "Starting CPU profile capture");

    let guard = ProfilerGuardBuilder::default()
        .frequency(997) // ~1000 Hz, prime to avoid aliasing
        .blocklist(&["libc", "libsystem", "pthread"])
        .build()
        .map_err(|e| format!("Failed to start profiler: {}", e))?;

    // Sleep for the profiling duration using spawn_blocking (no direct tokio dep)
    let duration = std::time::Duration::from_secs(duration_secs);
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration))
        .await
        .map_err(|e| format!("Sleep task failed: {}", e))?;

    let report = guard.report().build().map_err(|e| format!("Failed to build report: {}", e))?;

    // Write flamegraph SVG
    let logs_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let svg_path = logs_dir.join(format!("cpu-profile-{}.svg", timestamp));

    let svg_file = File::create(&svg_path).map_err(|e| format!("Failed to create SVG: {}", e))?;
    report.flamegraph(svg_file).map_err(|e| format!("Failed to write flamegraph: {}", e))?;

    // Write protobuf for further analysis (compatible with `go tool pprof`)
    let proto_path = logs_dir.join(format!("cpu-profile-{}.pb", timestamp));
    let mut proto_file =
        File::create(&proto_path).map_err(|e| format!("Failed to create proto: {}", e))?;
    let profile = report.pprof().map_err(|e| format!("Failed to generate pprof: {}", e))?;

    use pprof::protos::Message;
    let encoded = profile.encode_to_vec();
    proto_file.write_all(&encoded).map_err(|e| format!("Failed to write proto: {}", e))?;

    let path_str = svg_path.to_string_lossy().to_string();
    tracing::info!(path = %path_str, "CPU profile captured");
    Ok(path_str)
}

/// Captures a tracing-chrome timeline for the specified duration.
/// Swaps a ChromeLayer into the global subscriber so all threads' spans are recorded.
/// Creates a Chrome Trace Format JSON file viewable in chrome://tracing or Perfetto.
#[tauri::command]
pub async fn start_trace(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProfilingState>,
    duration_secs: Option<u64>,
) -> Result<String, String> {
    use tracing_chrome::ChromeLayerBuilder;

    let duration_secs = duration_secs.unwrap_or(10);

    // Prevent concurrent profiling
    {
        let mut active = state.0.lock().map_err(|e| e.to_string())?;
        if *active {
            return Err("Profiling already in progress".to_string());
        }
        *active = true;
    }

    let handle = crate::logging::chrome_reload_handle()
        .ok_or("Chrome trace reload handle not initialized")?;

    let logs_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let trace_path = logs_dir.join(format!("trace-{}.json", timestamp));

    let (chrome_layer, guard) = ChromeLayerBuilder::new()
        .file(&trace_path)
        .include_args(true)
        .build();

    // Swap the chrome layer into the global subscriber — all threads now emit to it
    handle
        .modify(|layer| *layer = Some(chrome_layer))
        .map_err(|e| format!("Failed to activate chrome layer: {}", e))?;

    tracing::info!(duration_secs, path = %trace_path.display(), "Starting trace capture");

    // Sleep for the requested duration while all threads record spans
    let duration = std::time::Duration::from_secs(duration_secs);
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration))
        .await
        .map_err(|e| format!("Sleep task failed: {}", e))?;

    // Deactivate: swap back to None, then flush
    handle
        .modify(|layer| *layer = None)
        .map_err(|e| format!("Failed to deactivate chrome layer: {}", e))?;
    drop(guard);

    // Release lock
    if let Ok(mut active) = state.0.lock() {
        *active = false;
    }

    let path_str = trace_path.to_string_lossy().to_string();
    tracing::info!(path = %path_str, "Trace capture complete");
    Ok(path_str)
}
