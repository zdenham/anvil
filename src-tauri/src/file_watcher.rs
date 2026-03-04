//! File system watcher using notify-debouncer-mini.
//!
//! Provides debounced file change notifications to the frontend.
//! Follows the `terminal.rs` pattern: Arc<Mutex<Manager>> state,
//! `create_*_state()` constructor, `cleanup_all()` shutdown.

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Event payload emitted to frontend when watched files change.
/// Includes the specific paths that changed so the frontend can
/// update surgically instead of re-reading the entire directory.
#[derive(Clone, Serialize)]
struct FileWatcherEvent {
    #[serde(rename = "watchId")]
    watch_id: String,
    #[serde(rename = "changedPaths")]
    changed_paths: Vec<String>,
}

/// An active watch session. Dropping this stops the watcher automatically
/// because `Debouncer` cleans up on drop.
struct WatchSession {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

/// Manages all active file watcher sessions.
pub struct FileWatcherManager {
    sessions: HashMap<String, WatchSession>,
}

impl FileWatcherManager {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Kill all watchers (used on app exit).
    pub fn cleanup_all(&mut self) {
        let count = self.sessions.len();
        self.sessions.clear(); // Debouncer stops on drop
        tracing::info!(count, "Cleaned up all file watchers");
    }
}

impl Default for FileWatcherManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe state for file watcher management.
pub type FileWatcherState = Arc<Mutex<FileWatcherManager>>;

/// Creates a new FileWatcherState for use with Tauri's state management.
pub fn create_file_watcher_state() -> FileWatcherState {
    Arc::new(Mutex::new(FileWatcherManager::new()))
}

/// Creates a debounced watcher for a directory, emits `file-watcher:changed` events.
#[tauri::command]
pub fn start_watch(
    state: tauri::State<'_, FileWatcherState>,
    app: AppHandle,
    watch_id: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();

    // Prevent duplicate watches
    if manager.sessions.contains_key(&watch_id) {
        tracing::warn!(watch_id = %watch_id, "Watch already exists, stopping old one first");
        manager.sessions.remove(&watch_id);
    }

    let event_watch_id = watch_id.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        move |result: DebounceEventResult| match result {
            Ok(events) if !events.is_empty() => {
                let changed_paths: Vec<String> = events
                    .iter()
                    .map(|e| e.path.to_string_lossy().to_string())
                    .collect();
                let _ = app.emit(
                    "file-watcher:changed",
                    FileWatcherEvent {
                        watch_id: event_watch_id.clone(),
                        changed_paths,
                    },
                );
            }
            Err(e) => {
                tracing::warn!(error = %e, "File watcher error");
            }
            _ => {} // Empty events batch, ignore
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };

    debouncer
        .watcher()
        .watch(Path::new(&path), mode)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    tracing::info!(watch_id = %watch_id, path = %path, recursive, "Started file watch");
    manager.sessions.insert(
        watch_id,
        WatchSession {
            _debouncer: debouncer,
        },
    );
    Ok(())
}

/// Tears down a specific watcher (standalone, callable from WS server).
pub fn stop_watch_inner(state: &FileWatcherState, watch_id: &str) -> Result<(), String> {
    let mut manager = state
        .lock()
        .map_err(|e| format!("Failed to lock file watcher state: {}", e))?;

    if manager.sessions.remove(watch_id).is_some() {
        tracing::info!(watch_id = %watch_id, "Stopped file watch");
    } else {
        tracing::debug!(watch_id = %watch_id, "Stop requested for unknown watch (already stopped?)");
    }

    Ok(())
}

/// Tears down a specific watcher (Debouncer stops on drop).
#[tauri::command]
pub fn stop_watch(
    state: tauri::State<'_, FileWatcherState>,
    watch_id: String,
) -> Result<(), String> {
    stop_watch_inner(&state, &watch_id)
}

/// Returns active watch IDs (standalone, callable from WS server).
pub fn list_watches_inner(state: &FileWatcherState) -> Vec<String> {
    state
        .lock()
        .map(|manager| manager.sessions.keys().cloned().collect())
        .unwrap_or_default()
}

/// Returns active watch IDs (diagnostic).
#[tauri::command]
pub fn list_watches(state: tauri::State<'_, FileWatcherState>) -> Vec<String> {
    list_watches_inner(&state)
}
