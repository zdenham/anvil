//! Background worker thread for batched SQLite drain event writes.
//!
//! Receives `DrainRow` structs from the `SQLiteLayer` via mpsc channel
//! and inserts them into `<data_dir>/databases/drain.db` in batched transactions.
//! Same batch pattern as `log_server.rs::batch_worker`.

use super::sqlite_layer::{DrainRow, PropertyValue};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Flush when this many events accumulate.
const BATCH_SIZE: usize = 50;

/// Flush at least this often, even if batch is not full.
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Opens the drain SQLite database with WAL mode and creates schema.
fn open_db() -> rusqlite::Connection {
    let db_path = crate::paths::drain_database();

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create databases directory");
    }

    let conn =
        rusqlite::Connection::open(&db_path).expect("Failed to open drain SQLite database");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .expect("Failed to set WAL mode on drain database");
    init_schema(&conn);
    tracing::info!(path = %db_path.display(), "Drain SQLite database initialized");
    conn
}

/// Creates the drain_events and event_properties tables + indexes.
fn init_schema(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS drain_events (
            event_id    TEXT PRIMARY KEY NOT NULL,
            event       TEXT NOT NULL,
            timestamp   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS event_properties (
            event_id      TEXT NOT NULL,
            timestamp     INTEGER NOT NULL,
            key           TEXT NOT NULL,
            value_string  TEXT,
            value_number  REAL,
            value_bool    INTEGER,
            FOREIGN KEY (event_id) REFERENCES drain_events(event_id)
        );

        CREATE INDEX IF NOT EXISTS idx_drain_timestamp
            ON drain_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_props_event_id
            ON event_properties(event_id);
        CREATE INDEX IF NOT EXISTS idx_props_key
            ON event_properties(key);
        CREATE INDEX IF NOT EXISTS idx_props_event_key
            ON event_properties(event_id, key);
        ",
    )
    .expect("Failed to initialize drain database schema");
}

/// Flushes a batch of DrainRows into SQLite within a single transaction.
fn flush_batch(conn: &rusqlite::Connection, buffer: &mut Vec<DrainRow>) {
    if buffer.is_empty() {
        return;
    }

    let result = (|| -> Result<(), rusqlite::Error> {
        let tx = conn.unchecked_transaction()?;
        {
            let mut event_stmt = tx.prepare_cached(
                "INSERT INTO drain_events (event_id, event, timestamp) \
                 VALUES (?1, ?2, ?3)",
            )?;
            let mut prop_stmt = tx.prepare_cached(
                "INSERT INTO event_properties \
                 (event_id, timestamp, key, value_string, value_number, value_bool) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;

            for row in buffer.iter() {
                event_stmt.execute((
                    &row.event_id,
                    &row.event,
                    &row.timestamp,
                ))?;

                for (key, val) in &row.properties {
                    match val {
                        PropertyValue::String(s) => prop_stmt.execute((
                            &row.event_id,
                            &row.timestamp,
                            key,
                            Some(s.as_str()),
                            None::<f64>,
                            None::<i32>,
                        ))?,
                        PropertyValue::Number(n) => prop_stmt.execute((
                            &row.event_id,
                            &row.timestamp,
                            key,
                            None::<&str>,
                            Some(*n),
                            None::<i32>,
                        ))?,
                        PropertyValue::Bool(b) => prop_stmt.execute((
                            &row.event_id,
                            &row.timestamp,
                            key,
                            None::<&str>,
                            None::<f64>,
                            Some(*b as i32),
                        ))?,
                    };
                }
            }
        }
        tx.commit()?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            tracing::debug!(
                count = buffer.len(),
                "Flushed drain events to SQLite"
            );
        }
        Err(e) => {
            // SQLite writes are local — if they fail, log and drop the batch.
            // No retry logic needed (unlike HTTP-based LogServerLayer).
            tracing::error!(
                error = %e,
                count = buffer.len(),
                "Failed to flush drain events to SQLite, dropping batch"
            );
        }
    }

    buffer.clear();
}

/// Background worker loop. Receives DrainRows and batch-inserts them.
///
/// Same structure as `log_server.rs::batch_worker`:
/// - recv_timeout loop
/// - flush on count (50) or interval (5s)
/// - final flush on channel disconnect
pub fn batch_worker(receiver: mpsc::Receiver<DrainRow>) {
    let conn = open_db();
    let mut buffer: Vec<DrainRow> = Vec::with_capacity(BATCH_SIZE);
    let mut last_flush = Instant::now();

    loop {
        let elapsed = last_flush.elapsed();
        let timeout = FLUSH_INTERVAL.saturating_sub(elapsed);

        match receiver.recv_timeout(timeout) {
            Ok(row) => {
                buffer.push(row);

                if buffer.len() >= BATCH_SIZE {
                    flush_batch(&conn, &mut buffer);
                    last_flush = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                flush_batch(&conn, &mut buffer);
                last_flush = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Final flush on shutdown
                flush_batch(&conn, &mut buffer);
                break;
            }
        }
    }

    tracing::debug!("Drain SQLite worker exiting");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_schema_creates_tables() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn);

        // Verify tables exist by querying them
        let event_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM drain_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count, 0);

        let prop_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_properties", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(prop_count, 0);
    }

    #[test]
    fn test_flush_batch_empty() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn);
        let mut buffer = Vec::new();
        // Should not panic on empty buffer
        flush_batch(&conn, &mut buffer);
    }

    #[test]
    fn test_flush_batch_inserts_rows() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn);

        let mut buffer = vec![DrainRow {
            event_id: "test-id-1".to_string(),
            event: "tool:started".to_string(),
            timestamp: 1700000000000,
            properties: vec![
                (
                    "toolName".to_string(),
                    PropertyValue::String("Bash".to_string()),
                ),
                ("durationMs".to_string(), PropertyValue::Number(123.0)),
                ("resultTruncated".to_string(), PropertyValue::Bool(false)),
            ],
        }];

        flush_batch(&conn, &mut buffer);
        assert!(buffer.is_empty(), "Buffer should be cleared after flush");

        // Verify event row
        let event: String = conn
            .query_row(
                "SELECT event FROM drain_events WHERE event_id = ?1",
                ["test-id-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event, "tool:started");

        // Verify property rows
        let prop_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM event_properties WHERE event_id = ?1",
                ["test-id-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prop_count, 3);

        // Verify string property
        let tool_name: String = conn
            .query_row(
                "SELECT value_string FROM event_properties \
                 WHERE event_id = ?1 AND key = 'toolName'",
                ["test-id-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tool_name, "Bash");

        // Verify number property
        let duration: f64 = conn
            .query_row(
                "SELECT value_number FROM event_properties \
                 WHERE event_id = ?1 AND key = 'durationMs'",
                ["test-id-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert!((duration - 123.0).abs() < f64::EPSILON);

        // Verify bool property
        let truncated: i32 = conn
            .query_row(
                "SELECT value_bool FROM event_properties \
                 WHERE event_id = ?1 AND key = 'resultTruncated'",
                ["test-id-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(truncated, 0);
    }

    #[test]
    fn test_flush_batch_multiple_events() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn);

        let mut buffer = vec![
            DrainRow {
                event_id: "ev-1".to_string(),
                event: "tool:started".to_string(),
                timestamp: 1700000000000,
                properties: vec![(
                    "toolName".to_string(),
                    PropertyValue::String("Bash".to_string()),
                )],
            },
            DrainRow {
                event_id: "ev-2".to_string(),
                event: "api:call".to_string(),
                timestamp: 1700000001000,
                properties: vec![
                    ("inputTokens".to_string(), PropertyValue::Number(500.0)),
                    ("outputTokens".to_string(), PropertyValue::Number(200.0)),
                ],
            },
        ];

        flush_batch(&conn, &mut buffer);

        let event_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM drain_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count, 2);

        let prop_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_properties", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(prop_count, 3);
    }
}
