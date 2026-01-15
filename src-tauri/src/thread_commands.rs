use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ThreadStatus {
    Running,
    Completed,
    Error,
    Paused,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMetadata {
    pub id: String,
    pub task_id: String,
    pub status: ThreadStatus,
}

fn get_threads_dir() -> Result<PathBuf, String> {
    Ok(paths::threads_dir())
}

/// Get the status of a thread
#[tauri::command]
pub async fn get_thread_status(
    thread_id: String,
) -> Result<Option<ThreadStatus>, String> {
    let threads_dir = get_threads_dir()?;
    let thread_path = threads_dir
        .join(&thread_id)
        .join("metadata.json");

    if !thread_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&thread_path).map_err(|e| e.to_string())?;
    let metadata: ThreadMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(metadata.status))
}

/// Get full thread metadata
#[tauri::command]
pub async fn get_thread(
    thread_id: String,
) -> Result<Option<ThreadMetadata>, String> {
    let threads_dir = get_threads_dir()?;
    let thread_path = threads_dir
        .join(&thread_id)
        .join("metadata.json");

    if !thread_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&thread_path).map_err(|e| e.to_string())?;
    let metadata: ThreadMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(metadata))
}
