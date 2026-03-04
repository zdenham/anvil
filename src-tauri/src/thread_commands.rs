use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;

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

/// Get the status of a thread (standalone, callable from WS server).
pub fn get_thread_status_inner(thread_id: &str) -> Result<Option<ThreadStatus>, String> {
    let thread_path = paths::threads_dir()
        .join(thread_id)
        .join("metadata.json");

    if !thread_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&thread_path).map_err(|e| e.to_string())?;
    let metadata: ThreadMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(metadata.status))
}

/// Get the status of a thread
#[tauri::command]
pub async fn get_thread_status(
    thread_id: String,
) -> Result<Option<ThreadStatus>, String> {
    get_thread_status_inner(&thread_id)
}

/// Get full thread metadata (standalone, callable from WS server).
pub fn get_thread_inner(thread_id: &str) -> Result<Option<ThreadMetadata>, String> {
    let thread_path = paths::threads_dir()
        .join(thread_id)
        .join("metadata.json");

    if !thread_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&thread_path).map_err(|e| e.to_string())?;
    let metadata: ThreadMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(metadata))
}

/// Get full thread metadata
#[tauri::command]
pub async fn get_thread(
    thread_id: String,
) -> Result<Option<ThreadMetadata>, String> {
    get_thread_inner(&thread_id)
}
