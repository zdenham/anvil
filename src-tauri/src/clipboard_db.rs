use crate::paths;
use rusqlite::{params, Connection, Result};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const MAX_CONTENT_SIZE: usize = 100_000; // 100KB
const PREVIEW_LENGTH: usize = 200;

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

/// Get total entry count
pub fn get_entry_count() -> Result<usize> {
    let conn = get_connection().lock().unwrap();
    let count: usize = conn.query_row("SELECT COUNT(*) FROM clipboard_entries", [], |row| {
        row.get(0)
    })?;
    Ok(count)
}
