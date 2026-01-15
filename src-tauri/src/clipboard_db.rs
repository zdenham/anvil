use crate::paths;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const MAX_CONTENT_SIZE: usize = 100_000; // 100KB
const PREVIEW_LENGTH: usize = 200;

/// Lightweight entry for list display (no full content)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardEntryPreview {
    pub id: String,
    pub preview: String,
    pub content_size: usize,
    pub timestamp: i64,
    pub app_source: Option<String>,
}

/// Global database connection
static DB_CONNECTION: OnceLock<Mutex<Connection>> = OnceLock::new();

fn get_db_path() -> PathBuf {
    let db_path = paths::clipboard_database();
    // Ensure parent directory exists (NEW consolidated location)
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    db_path
}

fn get_connection() -> &'static Mutex<Connection> {
    DB_CONNECTION.get_or_init(|| {
        let path = get_db_path();
        let conn = Connection::open(&path).expect("Failed to open clipboard database");
        init_schema(&conn).expect("Failed to initialize database schema");
        Mutex::new(conn)
    })
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS clipboard_entries (
            id TEXT PRIMARY KEY,
            preview TEXT NOT NULL,
            content TEXT NOT NULL,
            content_size INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            app_source TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_timestamp 
            ON clipboard_entries(timestamp DESC);
        ",
    )?;
    Ok(())
}

/// Generate a preview from content (first N chars, whitespace collapsed)
fn generate_preview(content: &str) -> String {
    let collapsed: String = content
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if collapsed.len() <= PREVIEW_LENGTH {
        collapsed
    } else {
        collapsed.chars().take(PREVIEW_LENGTH).collect()
    }
}

/// Truncate content if it exceeds the max size
fn truncate_content(content: String) -> String {
    if content.len() <= MAX_CONTENT_SIZE {
        return content;
    }

    let mut truncated: String = content.chars().take(MAX_CONTENT_SIZE).collect();
    truncated.push_str("… [truncated]");
    truncated
}

/// Initialize the database (call on app startup)
pub fn initialize() {
    // Accessing the connection initializes it
    let _ = get_connection();
    tracing::info!("Database initialized");
}

/// Insert a new clipboard entry
pub fn insert_entry(content: String, app_source: Option<String>) -> Result<String> {
    let content = truncate_content(content);
    let id = uuid::Uuid::new_v4().to_string();
    let preview = generate_preview(&content);
    let content_size = content.len();
    let timestamp = chrono::Utc::now().timestamp();

    let conn = get_connection().lock().unwrap();

    // Remove duplicate if exists (same content)
    conn.execute(
        "DELETE FROM clipboard_entries WHERE content = ?1",
        [&content],
    )?;

    conn.execute(
        "INSERT INTO clipboard_entries (id, preview, content, content_size, timestamp, app_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, preview, content, content_size, timestamp, app_source],
    )?;

    Ok(id)
}

/// Get recent entries (preview only, no full content)
pub fn get_recent_entries(limit: usize) -> Result<Vec<ClipboardEntryPreview>> {
    let conn = get_connection().lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, preview, content_size, timestamp, app_source 
         FROM clipboard_entries 
         ORDER BY timestamp DESC 
         LIMIT ?1",
    )?;

    let entries = stmt
        .query_map([limit], |row| {
            Ok(ClipboardEntryPreview {
                id: row.get(0)?,
                preview: row.get(1)?,
                content_size: row.get(2)?,
                timestamp: row.get(3)?,
                app_source: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(entries)
}

/// Search entries by content (preview only returned)
pub fn search_entries(query: &str, limit: usize) -> Result<Vec<ClipboardEntryPreview>> {
    let conn = get_connection().lock().unwrap();

    let pattern = format!("%{}%", query.to_lowercase());

    let mut stmt = conn.prepare(
        "SELECT id, preview, content_size, timestamp, app_source 
         FROM clipboard_entries 
         WHERE lower(content) LIKE ?1
         ORDER BY timestamp DESC 
         LIMIT ?2",
    )?;

    let entries = stmt
        .query_map(params![pattern, limit], |row| {
            Ok(ClipboardEntryPreview {
                id: row.get(0)?,
                preview: row.get(1)?,
                content_size: row.get(2)?,
                timestamp: row.get(3)?,
                app_source: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(entries)
}

/// Get full content for a specific entry
pub fn get_entry_content(id: &str) -> Result<Option<String>> {
    let conn = get_connection().lock().unwrap();

    let mut stmt = conn.prepare("SELECT content FROM clipboard_entries WHERE id = ?1")?;

    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Get the most recent entry's content (for deduplication check)
pub fn get_latest_content() -> Result<Option<String>> {
    let conn = get_connection().lock().unwrap();

    let mut stmt =
        conn.prepare("SELECT content FROM clipboard_entries ORDER BY timestamp DESC LIMIT 1")?;

    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Delete a single entry
pub fn delete_entry(id: &str) -> Result<bool> {
    let conn = get_connection().lock().unwrap();
    let rows_affected = conn.execute("DELETE FROM clipboard_entries WHERE id = ?1", [id])?;
    Ok(rows_affected > 0)
}

/// Clear all entries
pub fn clear_all() -> Result<()> {
    let conn = get_connection().lock().unwrap();
    conn.execute("DELETE FROM clipboard_entries", [])?;
    Ok(())
}

/// Get total entry count
pub fn get_entry_count() -> Result<usize> {
    let conn = get_connection().lock().unwrap();
    let count: usize = conn.query_row("SELECT COUNT(*) FROM clipboard_entries", [], |row| {
        row.get(0)
    })?;
    Ok(count)
}
