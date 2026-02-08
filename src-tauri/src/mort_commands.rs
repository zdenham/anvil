//! Mort-specific filesystem operations exposed as Tauri commands.
//!
//! These commands provide mort-specific directory and file operations,
//! particularly for managing repositories and their settings.

use crate::paths;
use fs2::FileExt;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

/// Lock expiry duration (30 minutes)
const LOCK_EXPIRY_SECS: u64 = 30 * 60;

// ═══════════════════════════════════════════════════════════════════════════
// Lock Management State
// ═══════════════════════════════════════════════════════════════════════════

/// Manages file locks for repositories to prevent concurrent operations.
pub struct LockManager {
    locks: Mutex<HashMap<String, File>>,
    next_id: Mutex<u64>,
}

impl LockManager {
    pub fn new() -> Self {
        LockManager {
            locks: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }
}

impl Default for LockManager {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Filesystem Commands
// ═══════════════════════════════════════════════════════════════════════════

/// Get the mort repository directory for a repo
#[tauri::command]
pub async fn fs_get_repo_dir(repo_name: String) -> Result<String, String> {
    let repo_dir = paths::repositories_dir().join(&repo_name);
    Ok(repo_dir.to_string_lossy().to_string())
}

/// Get the source path for a repository (where the actual git repo is)
#[tauri::command]
pub async fn fs_get_repo_source_path(repo_name: String) -> Result<String, String> {
    let repo_dir = fs_get_repo_dir(repo_name.clone()).await?;
    let settings_path = PathBuf::from(&repo_dir).join("settings.json");

    // Try to read from settings.json
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        let settings: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(source_path) = settings.get("sourcePath").and_then(|v| v.as_str()) {
            return Ok(source_path.to_string());
        }
    }

    // Fallback to metadata.json for migration
    let metadata_path = PathBuf::from(&repo_dir).join("metadata.json");
    if metadata_path.exists() {
        let content = fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
        let metadata: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(source_path) = metadata.get("sourcePath").and_then(|v| v.as_str()) {
            return Ok(source_path.to_string());
        }
    }

    Err(format!("Repository '{}' not found", repo_name))
}

/// Get the user's home directory
#[tauri::command]
pub async fn fs_get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot find home directory".to_string())
}

/// List file/directory names in a directory (just names, not full entries)
#[tauri::command]
pub async fn fs_list_dir_names(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        names.push(entry.file_name().to_string_lossy().to_string());
    }

    Ok(names)
}

// ═══════════════════════════════════════════════════════════════════════════
// Lock Commands
// ═══════════════════════════════════════════════════════════════════════════

/// Check if a lock is expired based on its metadata file.
fn is_lock_expired(meta_path: &PathBuf) -> bool {
    if !meta_path.exists() {
        return true; // No metadata = treat as expired
    }

    let mut content = String::new();
    if let Ok(mut file) = File::open(meta_path) {
        if file.read_to_string(&mut content).is_ok() {
            if let Ok(timestamp) = content.trim().parse::<u64>() {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or(Duration::ZERO)
                    .as_secs();
                return now.saturating_sub(timestamp) > LOCK_EXPIRY_SECS;
            }
        }
    }
    true // Failed to read = treat as expired
}

/// Write the current timestamp to the lock metadata file.
fn write_lock_timestamp(meta_path: &PathBuf) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs();

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(meta_path)
        .map_err(|e| format!("Failed to write lock metadata: {}", e))?;

    write!(file, "{}", timestamp).map_err(|e| format!("Failed to write timestamp: {}", e))?;
    Ok(())
}

/// Acquire an exclusive lock for a repository.
/// Returns a lock ID that must be passed to lock_release_repo.
/// Locks expire after 30 minutes - expired locks are automatically released.
#[tauri::command]
pub async fn lock_acquire_repo(
    repo_name: String,
    lock_manager: State<'_, LockManager>,
) -> Result<String, String> {
    let repo_dir = fs_get_repo_dir(repo_name).await?;
    let lock_path = PathBuf::from(&repo_dir).join(".lock");
    let meta_path = PathBuf::from(&repo_dir).join(".lock.meta");

    // Create parent directory if needed
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create lock directory: {}", e))?;
    }

    // Create/open the lock file
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|e| format!("Failed to open lock file: {}", e))?;

    // Try to acquire lock (non-blocking first)
    match file.try_lock_exclusive() {
        Ok(()) => {
            // Got the lock immediately
        }
        Err(_) => {
            // Lock is held - check if it's expired
            if is_lock_expired(&meta_path) {
                // Expired lock - force acquire by blocking
                // The holder is likely dead, so this should succeed quickly
                // once the OS releases the dead process's lock
                tracing::warn!("Found expired lock, forcing acquisition");
                file.lock_exclusive()
                    .map_err(|e| format!("Failed to acquire expired lock: {}", e))?;
            } else {
                // Lock is valid and held - block waiting for it
                file.lock_exclusive()
                    .map_err(|e| format!("Failed to acquire lock: {}", e))?;
            }
        }
    }

    // Write timestamp to metadata file
    write_lock_timestamp(&meta_path)?;

    // Generate a unique lock ID and store the file handle
    let lock_id = {
        let mut next_id = lock_manager
            .next_id
            .lock()
            .map_err(|e| e.to_string())?;
        let id = format!("lock-{}", *next_id);
        *next_id += 1;
        id
    };

    {
        let mut locks = lock_manager.locks.lock().map_err(|e| e.to_string())?;
        locks.insert(lock_id.clone(), file);
    }

    Ok(lock_id)
}

/// Release a repository lock.
#[tauri::command]
pub async fn lock_release_repo(
    lock_id: String,
    lock_manager: State<'_, LockManager>,
) -> Result<(), String> {
    let mut locks = lock_manager.locks.lock().map_err(|e| e.to_string())?;

    if let Some(file) = locks.remove(&lock_id) {
        // Explicitly unlock (also happens when file is dropped, but be explicit)
        file.unlock()
            .map_err(|e| format!("Failed to release lock: {}", e))?;
    }

    Ok(())
}

/// Clear all repository locks on startup.
/// This removes stale .lock and .lock.meta files from previous sessions.
pub fn clear_all_locks() {
    let repos_dir = paths::repositories_dir();
    if !repos_dir.exists() {
        return;
    }

    let entries = match fs::read_dir(&repos_dir) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to read repositories directory");
            return;
        }
    };

    let mut cleared = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Remove .lock file
        let lock_path = path.join(".lock");
        if lock_path.exists() {
            if let Err(e) = fs::remove_file(&lock_path) {
                tracing::warn!(path = %lock_path.display(), error = %e, "Failed to remove lock file");
            } else {
                cleared += 1;
            }
        }

        // Remove .lock.meta file
        let meta_path = path.join(".lock.meta");
        if meta_path.exists() {
            if let Err(e) = fs::remove_file(&meta_path) {
                tracing::warn!(path = %meta_path.display(), error = %e, "Failed to remove lock meta file");
            }
        }
    }

    if cleared > 0 {
        tracing::info!(count = cleared, "Cleared stale repository locks on startup");
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Build Info Commands
// ═══════════════════════════════════════════════════════════════════════════

/// Get current paths info for debugging/display
#[tauri::command]
pub fn get_paths_info() -> paths::PathsInfo {
    paths::get_paths_info()
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent Commands
// ═══════════════════════════════════════════════════════════════════════════

/// Get the list of available agent types.
/// Used by the frontend to populate agent selection dropdowns.
#[tauri::command]
pub fn get_agent_types() -> Vec<&'static str> {
    vec!["research", "execution", "review", "merge"]
}

