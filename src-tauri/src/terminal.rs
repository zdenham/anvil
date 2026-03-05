//! Terminal PTY management using portable-pty.
//!
//! This module provides the backend infrastructure for terminal emulation,
//! spawning PTY processes and communicating with xterm.js on the frontend.

use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::paths;
use crate::ws_server::push::EventBroadcaster;

/// Represents an active terminal session with its PTY master and child process.
pub struct TerminalSession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub writer: Box<dyn Write + Send>,
    pub cwd: String,
}

/// Manages all active terminal sessions.
pub struct TerminalManager {
    sessions: HashMap<u32, TerminalSession>,
    next_id: u32,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }

    /// Kill all terminal sessions (used on app exit).
    pub fn kill_all(&mut self) {
        for (id, mut session) in self.sessions.drain() {
            tracing::info!(terminal_id = id, "Killing terminal on shutdown");
            let _ = session.child.kill();
        }
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe state for terminal management.
pub type TerminalState = Arc<Mutex<TerminalManager>>;

/// Creates a new TerminalState for use with Tauri's state management.
pub fn create_terminal_state() -> TerminalState {
    Arc::new(Mutex::new(TerminalManager::new()))
}

/// Spawns a new terminal PTY (standalone, callable from WS server).
///
/// The `emit` callback is used to push events (`terminal:output`, `terminal:exit`)
/// to whatever transport is active (Tauri IPC or WS broadcast).
pub fn spawn_terminal_inner(
    state: &TerminalState,
    cols: u16,
    rows: u16,
    cwd: String,
    emit: Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", user);
    }
    cmd.env("PATH", paths::shell_path());

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let id = {
        let mut manager = state.lock().unwrap();
        let id = manager.next_id;
        manager.next_id += 1;
        id
    };

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    spawn_reader_thread(id, emit, reader);

    // Store the session
    {
        let mut manager = state.lock().unwrap();
        manager.sessions.insert(
            id,
            TerminalSession {
                master: pair.master,
                child,
                writer,
                cwd: cwd.clone(),
            },
        );
    }

    tracing::info!(
        terminal_id = id,
        cwd = %cwd,
        cols = cols,
        rows = rows,
        shell = %shell,
        "Spawned terminal"
    );

    Ok(id)
}

/// Spawns the reader thread that forwards PTY output via the emit callback.
fn spawn_reader_thread(
    id: u32,
    emit: Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let _span = tracing::info_span!("terminal_reader", terminal_id = id).entered();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    tracing::info!(terminal_id = id, "Terminal process exited");
                    emit("terminal:exit", serde_json::json!({ "id": id }));
                    break;
                }
                Ok(n) => {
                    tracing::trace!(terminal_id = id, bytes = n, "Emitting terminal:output");
                    emit(
                        "terminal:output",
                        serde_json::json!({
                            "id": id,
                            "data": &buf[..n]
                        }),
                    );
                }
                Err(e) => {
                    tracing::error!(terminal_id = id, error = %e, "Terminal read error");
                    emit("terminal:exit", serde_json::json!({ "id": id }));
                    break;
                }
            }
        }
    });
}

/// Spawns a new terminal PTY with the user's default shell.
///
/// Returns the terminal ID which can be used to write to, resize, or kill the terminal.
#[tauri::command]
pub async fn spawn_terminal(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: String,
) -> Result<u32, String> {
    let broadcaster = app.state::<EventBroadcaster>().inner().clone();
    let emit: Arc<dyn Fn(&str, serde_json::Value) + Send + Sync> =
        Arc::new(move |event: &str, payload: serde_json::Value| {
            broadcaster.broadcast(event, payload);
        });
    spawn_terminal_inner(&state, cols, rows, cwd, emit)
}

/// Writes data to a terminal's PTY (standalone, callable from WS server).
pub fn write_terminal_inner(state: &TerminalState, id: u32, data: &[u8]) -> Result<(), String> {
    let mut manager = state
        .lock()
        .map_err(|e| format!("Failed to lock terminal state: {}", e))?;
    let session = manager
        .sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal {} not found", id))?;

    session
        .writer
        .write_all(data)
        .map_err(|e| format!("Failed to write to terminal: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {}", e))?;

    Ok(())
}

/// Writes data to a terminal's PTY.
#[tauri::command]
pub async fn write_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    data: Vec<u8>,
) -> Result<(), String> {
    write_terminal_inner(&state, id, &data)
}

/// Resizes a terminal's PTY (standalone, callable from WS server).
pub fn resize_terminal_inner(
    state: &TerminalState,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let manager = state
        .lock()
        .map_err(|e| format!("Failed to lock terminal state: {}", e))?;
    let session = manager
        .sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal {} not found", id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {}", e))?;

    tracing::debug!(terminal_id = id, cols = cols, rows = rows, "Resized terminal");

    Ok(())
}

/// Resizes a terminal's PTY.
#[tauri::command]
pub async fn resize_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    resize_terminal_inner(&state, id, cols, rows)
}

/// Kills a terminal and removes it from the manager (standalone, callable from WS server).
pub fn kill_terminal_inner(
    state: &TerminalState,
    id: u32,
    emit: impl Fn(&str, serde_json::Value),
) -> Result<(), String> {
    let mut manager = state
        .lock()
        .map_err(|e| format!("Failed to lock terminal state: {}", e))?;

    if let Some(mut session) = manager.sessions.remove(&id) {
        let _ = session.child.kill();
        tracing::info!(terminal_id = id, "Killed terminal");
        emit("terminal:killed", serde_json::json!({ "id": id }));
    }

    Ok(())
}

/// Kills a terminal and removes it from the manager.
#[tauri::command]
pub async fn kill_terminal(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    id: u32,
) -> Result<(), String> {
    let broadcaster = app.state::<EventBroadcaster>();
    kill_terminal_inner(&state, id, |event, payload| {
        broadcaster.broadcast(event, payload);
    })
}

/// Lists all active terminal IDs (standalone, callable from WS server).
pub fn list_terminals_inner(state: &TerminalState) -> Result<Vec<u32>, String> {
    let manager = state.lock().map_err(|e| format!("Failed to lock terminal state: {}", e))?;
    Ok(manager.sessions.keys().copied().collect())
}

/// Lists all active terminal IDs.
#[tauri::command]
pub async fn list_terminals(state: tauri::State<'_, TerminalState>) -> Result<Vec<u32>, String> {
    list_terminals_inner(&state)
}

/// Kills all terminals for a specific cwd (standalone, callable from WS server).
pub fn kill_terminals_by_cwd_inner(
    state: &TerminalState,
    cwd: &str,
    emit: impl Fn(&str, serde_json::Value),
) -> Result<Vec<u32>, String> {
    let mut manager = state
        .lock()
        .map_err(|e| format!("Failed to lock terminal state: {}", e))?;
    let mut killed_ids = Vec::new();

    let ids_to_remove: Vec<u32> = manager
        .sessions
        .iter()
        .filter(|(_, session)| session.cwd == cwd)
        .map(|(id, _)| *id)
        .collect();

    for id in ids_to_remove {
        if let Some(mut session) = manager.sessions.remove(&id) {
            let _ = session.child.kill();
            emit("terminal:killed", serde_json::json!({ "id": id }));
            killed_ids.push(id);
            tracing::info!(terminal_id = id, cwd = %cwd, "Killed terminal for removed worktree");
        }
    }

    Ok(killed_ids)
}

/// Kills all terminals for a specific worktree path.
#[tauri::command]
pub async fn kill_terminals_by_cwd(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    cwd: String,
) -> Result<Vec<u32>, String> {
    let broadcaster = app.state::<EventBroadcaster>();
    kill_terminals_by_cwd_inner(&state, &cwd, |event, payload| {
        broadcaster.broadcast(event, payload);
    })
}
