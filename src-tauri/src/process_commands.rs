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
