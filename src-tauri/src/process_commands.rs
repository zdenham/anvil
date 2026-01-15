use crate::shell;
use std::collections::HashMap;
use std::process::{Child, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct ProcessManager {
    processes: Mutex<HashMap<String, Child>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        ProcessManager {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Get the path to the runner script
#[tauri::command]
pub async fn get_runner_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    // In production, use the bundled path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("agents")
        .join("dist")
        .join("runner.js");

    if resource_path.exists() {
        return Ok(resource_path.to_string_lossy().to_string());
    }

    // Fallback for development
    let dev_path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("agents")
        .join("dist")
        .join("runner.js");

    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err("Runner script not found".to_string())
}

/// Spawn an agent process
#[tauri::command]
pub async fn spawn_agent_process(
    args: Vec<String>,
    thread_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    let child = shell::command("node")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;

    let mut processes = process_manager.processes.lock().map_err(|e| e.to_string())?;
    processes.insert(thread_id, child);

    Ok(())
}

/// Terminate an agent process
#[tauri::command]
pub async fn terminate_agent_process(
    thread_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    let mut processes = process_manager.processes.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = processes.remove(&thread_id) {
        child
            .kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    }

    Ok(())
}

/// Check if a process is still running
#[tauri::command]
pub async fn is_process_running(
    thread_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<bool, String> {
    let mut processes = process_manager.processes.lock().map_err(|e| e.to_string())?;

    if let Some(child) = processes.get_mut(&thread_id) {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, remove from map
                processes.remove(&thread_id);
                Ok(false)
            }
            Ok(None) => Ok(true), // Still running
            Err(e) => Err(e.to_string()),
        }
    } else {
        Ok(false)
    }
}

/// Submit a tool result to resume agent execution.
/// Writes the result to a file that the agent process monitors.
///
/// File location: {working_directory}/.mort/tool-results/{tool_id}.json
///
/// The agent runner watches for this file and reads it to resume execution.
#[tauri::command]
pub async fn submit_tool_result(
    task_id: String,
    thread_id: String,
    tool_id: String,
    response: String,
    working_directory: String,
) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    tracing::info!(
        task_id = %task_id,
        thread_id = %thread_id,
        tool_id = %tool_id,
        "Submitting tool result"
    );

    // Create tool-results directory under .mort in the working directory
    let tool_results_dir = Path::new(&working_directory)
        .join(".mort")
        .join("tool-results");

    fs::create_dir_all(&tool_results_dir)
        .map_err(|e| format!("Failed to create tool-results directory: {}", e))?;

    // Write the result as JSON
    let result_file = tool_results_dir.join(format!("{}.json", tool_id));
    let payload = serde_json::json!({
        "taskId": task_id,
        "threadId": thread_id,
        "toolId": tool_id,
        "response": response,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    fs::write(&result_file, serde_json::to_string_pretty(&payload).unwrap())
        .map_err(|e| format!("Failed to write tool result: {}", e))?;

    tracing::info!(
        tool_id = %tool_id,
        path = %result_file.display(),
        "Tool result written to file"
    );

    Ok(())
}

/// Kill a process by PID using OS-level signals.
/// This allows any window to cancel an agent by reading the PID from thread metadata.
#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<bool, String> {
    tracing::info!(pid = %pid, "Killing process by PID");

    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        match kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
            Ok(_) => {
                tracing::info!(pid = %pid, "Sent SIGTERM to process");
                Ok(true)
            }
            Err(nix::errno::Errno::ESRCH) => {
                // Process doesn't exist (already exited)
                tracing::warn!(pid = %pid, "Process not found (already exited)");
                Ok(false)
            }
            Err(e) => {
                tracing::error!(pid = %pid, error = %e, "Failed to send SIGTERM");
                Err(format!("Failed to kill process: {}", e))
            }
        }
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        if output.status.success() {
            tracing::info!(pid = %pid, "Process terminated via taskkill");
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("not found") {
                tracing::warn!(pid = %pid, "Process not found (already exited)");
                Ok(false)
            } else {
                tracing::error!(pid = %pid, stderr = %stderr, "taskkill failed");
                Err(format!("taskkill failed: {}", stderr))
            }
        }
    }
}
