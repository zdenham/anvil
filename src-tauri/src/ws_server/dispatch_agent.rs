//! Agent process spawning for the WebSocket server.
//!
//! Spawns node child processes server-side and streams stdout/stderr
//! as push events. This allows browser clients to spawn agents without
//! needing Tauri's shell plugin (which requires `window.__TAURI_INTERNALS__`).

use super::dispatch_helpers::extract_arg;
use super::WsState;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

/// Shared map of running agent PIDs, keyed by threadId.
pub type AgentPidMap = Arc<Mutex<HashMap<String, u32>>>;

/// Create a new empty agent PID map.
pub fn new_pid_map() -> AgentPidMap {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Dispatch an agent command.
pub async fn dispatch(
    cmd: &str,
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    match cmd {
        "agent_spawn" => spawn_agent(args, state).await,
        "agent_kill" => kill_agent(args, state).await,
        _ => Err(format!("unknown agent command: {}", cmd)),
    }
}

/// Spawn a node child process and stream its output as push events.
///
/// Returns `{ pid }` on success. Streams:
/// - `agent_stdout:{threadId}` with `{ data: "line\n" }`
/// - `agent_stderr:{threadId}` with `{ data: "line\n" }`
/// - `agent_close:{threadId}` with `{ code, signal }` on exit
async fn spawn_agent(
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    let thread_id: String = extract_arg(&args, "threadId")?;
    let command_args: Vec<String> = extract_arg(&args, "commandArgs")?;
    let cwd: String = extract_arg(&args, "cwd")?;
    let env: HashMap<String, String> = extract_arg(&args, "env")?;

    tracing::info!(thread_id = %thread_id, "Spawning agent process");

    let mut cmd = Command::new("node");
    cmd.args(&command_args)
        .current_dir(&cwd)
        .envs(&env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn agent: {}", e))?;

    let pid = child
        .id()
        .ok_or_else(|| "process exited immediately".to_string())?;

    // Take IO handles before moving child into close watcher
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Track PID for kill support
    state.agent_pids.lock().await.insert(thread_id.clone(), pid);

    // Spawn stdout line reader
    if let Some(stdout) = stdout {
        let broadcaster = state.broadcaster.clone();
        let tid = thread_id.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                broadcaster.broadcast(
                    &format!("agent_stdout:{}", tid),
                    serde_json::json!({ "data": format!("{}\n", line) }),
                );
            }
        });
    }

    // Spawn stderr line reader
    if let Some(stderr) = stderr {
        let broadcaster = state.broadcaster.clone();
        let tid = thread_id.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                broadcaster.broadcast(
                    &format!("agent_stderr:{}", tid),
                    serde_json::json!({ "data": format!("{}\n", line) }),
                );
            }
        });
    }

    // Spawn close watcher — owns the child, waits for exit
    let pids = state.agent_pids.clone();
    let broadcaster = state.broadcaster.clone();
    let tid = thread_id.clone();
    tokio::spawn(async move {
        let status = child.wait().await;

        // Remove from PID map
        pids.lock().await.remove(&tid);

        let (code, signal) = match status {
            Ok(s) => {
                #[cfg(unix)]
                {
                    use std::os::unix::process::ExitStatusExt;
                    (s.code(), s.signal())
                }
                #[cfg(not(unix))]
                {
                    (s.code(), None::<i32>)
                }
            }
            Err(e) => {
                tracing::error!(thread_id = %tid, error = %e, "Failed to wait on agent process");
                (None, None::<i32>)
            }
        };

        tracing::info!(
            thread_id = %tid,
            code = ?code,
            signal = ?signal,
            "Agent process exited"
        );

        broadcaster.broadcast(
            &format!("agent_close:{}", tid),
            serde_json::json!({ "code": code, "signal": signal }),
        );
    });

    tracing::info!(thread_id = %thread_id, pid = pid, "Agent process spawned");
    Ok(serde_json::json!({ "pid": pid }))
}

/// Kill an agent process by threadId using SIGTERM.
async fn kill_agent(
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    let thread_id: String = extract_arg(&args, "threadId")?;

    let pid = state.agent_pids.lock().await.get(&thread_id).copied();

    match pid {
        Some(pid) => {
            tracing::info!(thread_id = %thread_id, pid = pid, "Killing agent process");
            let killed = crate::process_commands::kill_process(pid).await?;
            Ok(serde_json::json!({ "killed": killed }))
        }
        None => {
            tracing::warn!(thread_id = %thread_id, "No agent process found to kill");
            Ok(serde_json::json!({ "killed": false }))
        }
    }
}
