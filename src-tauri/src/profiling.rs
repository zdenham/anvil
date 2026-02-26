//! On-demand profiling commands.
//!
//! All commands are triggered explicitly via IPC — nothing runs at startup.
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

/// Writes a memory snapshot JSON string to the logs directory.
/// Returns the file path for the UI to open.
#[tauri::command]
pub async fn write_memory_snapshot(
    app: tauri::AppHandle,
    snapshot_json: String,
) -> Result<String, String> {
    use std::fs;
    use std::io::Write;

    let logs_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let path = logs_dir.join(format!("memory-snapshot-{}.json", timestamp));

    let mut file =
        fs::File::create(&path).map_err(|e| format!("Failed to create snapshot file: {}", e))?;
    file.write_all(snapshot_json.as_bytes())
        .map_err(|e| format!("Failed to write snapshot: {}", e))?;

    let path_str = path.to_string_lossy().to_string();
    tracing::info!(path = %path_str, "Memory snapshot written");
    Ok(path_str)
}

/// Returns the resident set size (RSS) of the current process in bytes.
/// Uses macOS `proc_pidinfo` for lightweight, zero-dependency memory lookup.
#[tauri::command]
pub fn get_process_memory() -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        use std::mem;

        extern "C" {
            fn proc_pidinfo(
                pid: i32,
                flavor: i32,
                arg: u64,
                buffer: *mut std::ffi::c_void,
                buffersize: i32,
            ) -> i32;
        }

        // PROC_PIDTASKINFO = 4
        const PROC_PIDTASKINFO: i32 = 4;

        #[repr(C)]
        struct ProcTaskInfo {
            pti_virtual_size: u64,
            pti_resident_size: u64,
            pti_total_user: u64,
            pti_total_system: u64,
            pti_threads_user: u64,
            pti_threads_system: u64,
            pti_policy: i32,
            pti_faults: i32,
            pti_pageins: i32,
            pti_cow_faults: i32,
            pti_messages_sent: i32,
            pti_messages_received: i32,
            pti_syscalls_mach: i32,
            pti_syscalls_unix: i32,
            pti_csw: i32,
            pti_threadnum: i32,
            pti_numrunning: i32,
            pti_priority: i32,
        }

        let pid = std::process::id() as i32;
        let mut info: ProcTaskInfo = unsafe { mem::zeroed() };
        let size = mem::size_of::<ProcTaskInfo>() as i32;

        let ret = unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDTASKINFO,
                0,
                &mut info as *mut _ as *mut std::ffi::c_void,
                size,
            )
        };

        if ret <= 0 {
            return Err("proc_pidinfo failed".to_string());
        }

        Ok(info.pti_resident_size)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("get_process_memory only supported on macOS".to_string())
    }
}
