//! Terminal PTY management using portable-pty.
//!
//! This module provides the backend infrastructure for terminal emulation,
//! spawning PTY processes and communicating with xterm.js on the frontend.

use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::paths;

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
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Get user's default shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell - loads .zprofile/.bash_profile
    cmd.cwd(&cwd);

    // Set essential environment variables
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", user);
    }
    // Use the shell PATH to ensure homebrew tools are available
    cmd.env("PATH", paths::shell_path());

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    // Get the terminal ID
    let id = {
        let mut manager = state.lock().unwrap();
        let id = manager.next_id;
        manager.next_id += 1;
        id
    };

    // Spawn reader thread to emit output events to frontend
    let app_clone = app.clone();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    std::thread::spawn(move || {
        let _span = tracing::info_span!("terminal_reader", terminal_id = id).entered();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // PTY closed - process exited
                    tracing::info!(terminal_id = id, "Terminal process exited");
                    let _ = app_clone.emit("terminal:exit", serde_json::json!({ "id": id }));
                    break;
                }
                Ok(n) => {
                    // Send output data as array of bytes (for binary-safe transfer)
                    tracing::trace!(terminal_id = id, bytes = n, "Emitting terminal:output");
                    let _ = app_clone.emit(
                        "terminal:output",
                        serde_json::json!({
                            "id": id,
                            "data": &buf[..n]
                        }),
                    );
                }
                Err(e) => {
                    tracing::error!(terminal_id = id, error = %e, "Terminal read error");
                    let _ = app_clone.emit("terminal:exit", serde_json::json!({ "id": id }));
                    break;
                }
            }
        }
    });

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

/// Writes data to a terminal's PTY.
#[tauri::command]
pub async fn write_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();
    let session = manager
        .sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal {} not found", id))?;

    session
        .writer
        .write_all(&data)
        .map_err(|e| format!("Failed to write to terminal: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {}", e))?;

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
    let manager = state.lock().unwrap();
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

/// Kills a terminal and removes it from the manager.
#[tauri::command]
pub async fn kill_terminal(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    id: u32,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();

    if let Some(mut session) = manager.sessions.remove(&id) {
        let _ = session.child.kill();
        tracing::info!(terminal_id = id, "Killed terminal");

        // Emit killed event for frontend to update state
        let _ = app.emit("terminal:killed", serde_json::json!({ "id": id }));
    }

    Ok(())
}

/// Lists all active terminal IDs.
#[tauri::command]
pub async fn list_terminals(state: tauri::State<'_, TerminalState>) -> Result<Vec<u32>, String> {
    let manager = state.lock().unwrap();
    Ok(manager.sessions.keys().copied().collect())
}

/// Kills all terminals for a specific worktree path.
/// Used when a worktree is removed to clean up associated terminals.
#[tauri::command]
pub async fn kill_terminals_by_cwd(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    cwd: String,
) -> Result<Vec<u32>, String> {
    let mut manager = state.lock().unwrap();
    let mut killed_ids = Vec::new();

    // Find all terminals with matching cwd
    let ids_to_remove: Vec<u32> = manager
        .sessions
        .iter()
        .filter(|(_, session)| session.cwd == cwd)
        .map(|(id, _)| *id)
        .collect();

    // Remove and kill them
    for id in ids_to_remove {
        if let Some(mut session) = manager.sessions.remove(&id) {
            let _ = session.child.kill();
            let _ = app.emit("terminal:killed", serde_json::json!({ "id": id }));
            killed_ids.push(id);
            tracing::info!(terminal_id = id, cwd = %cwd, "Killed terminal for removed worktree");
        }
    }

    Ok(killed_ids)
}
