use crate::ws_server::AgentProcessMap;

/// Kill a process by PID using OS-level signals.
/// This allows any window to cancel an agent by reading the PID from thread metadata.
#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<bool, String> {
    tracing::info!(pid = %pid, "Killing process by PID");
    send_signal(pid, SignalKind::Term)
}

/// Cancel an agent by threadId: SIGTERM with auto-escalation to SIGKILL after 5s.
///
/// Uses the Rust-side AgentProcessMap (populated at spawn time) so cancellation
/// doesn't depend on socket health or JS-side PID lookups.
#[tauri::command(rename_all = "camelCase")]
pub async fn agent_cancel(
    thread_id: String,
    process_map: tauri::State<'_, AgentProcessMap>,
) -> Result<bool, String> {
    let entry = process_map
        .lock()
        .await
        .get(&thread_id)
        .map(|p| (p.pid, p.exited.clone()));

    let Some((pid, exited)) = entry else {
        tracing::warn!(thread_id = %thread_id, "cancel_agent: no process found (already exited)");
        return Ok(false);
    };

    // Try group kill first (works for process group leaders spawned via dispatch_agent).
    // Falls back to single-PID kill for children that don't lead their own group.
    tracing::info!(thread_id = %thread_id, pid = pid, "cancel_agent: sending SIGTERM");
    send_signal_or_group(pid, SignalKind::Term)?;

    // Race: process exits (event-driven via Notify) vs 5s timeout
    let graceful = tokio::select! {
        _ = exited.notified() => true,
        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => false,
    };

    if !graceful {
        tracing::warn!(thread_id = %thread_id, pid = pid, "cancel_agent: SIGTERM timed out, escalating to SIGKILL");
        let _ = send_signal_or_group(pid, SignalKind::Kill);
    } else {
        tracing::info!(thread_id = %thread_id, pid = pid, "cancel_agent: process exited gracefully");
    }

    Ok(true)
}

#[derive(Clone, Copy)]
pub enum SignalKind {
    Term,
    Kill,
}

pub fn send_signal(pid: u32, signal: SignalKind) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        let sig = match signal {
            SignalKind::Term => Signal::SIGTERM,
            SignalKind::Kill => Signal::SIGKILL,
        };

        match kill(Pid::from_raw(pid as i32), sig) {
            Ok(_) => {
                tracing::info!(pid = %pid, signal = ?sig, "Sent signal to process");
                Ok(true)
            }
            Err(nix::errno::Errno::ESRCH) => {
                tracing::warn!(pid = %pid, "Process not found (already exited)");
                Ok(false)
            }
            Err(e) => {
                tracing::error!(pid = %pid, error = %e, "Failed to send signal");
                Err(format!("Failed to send signal: {}", e))
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

/// Try group kill first; fall back to single-PID kill if no such process group.
/// This handles both process group leaders (spawned by dispatch_agent with setpgid)
/// and child agents (that inherit the parent's group).
pub fn send_signal_or_group(pid: u32, signal: SignalKind) -> Result<bool, String> {
    match send_signal_to_group(pid, signal) {
        Ok(true) => Ok(true),
        // Group not found (ESRCH) — try single PID (child that doesn't lead a group)
        Ok(false) => send_signal(pid, signal),
        Err(e) => Err(e),
    }
}

/// Send a signal to the entire process group led by `pid`.
/// On Unix, this uses kill(-pid, sig) to target all processes in the group.
pub fn send_signal_to_group(pid: u32, signal: SignalKind) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        let sig = match signal {
            SignalKind::Term => Signal::SIGTERM,
            SignalKind::Kill => Signal::SIGKILL,
        };

        match kill(Pid::from_raw(-(pid as i32)), sig) {
            Ok(_) => {
                tracing::info!(pid = %pid, signal = ?sig, "Sent signal to process group");
                Ok(true)
            }
            Err(nix::errno::Errno::ESRCH) => {
                tracing::warn!(pid = %pid, "Process group not found (already exited)");
                Ok(false)
            }
            Err(e) => {
                tracing::error!(pid = %pid, error = %e, "Failed to send signal to group");
                Err(format!("Failed to send group signal: {}", e))
            }
        }
    }

    #[cfg(windows)]
    {
        // taskkill /T kills the process tree
        let output = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        Ok(output.status.success())
    }
}
