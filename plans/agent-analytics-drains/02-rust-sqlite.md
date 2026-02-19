# 02 — Rust SQLite Layer + Hub Routing

## Summary

Build the Rust storage backend: a `tracing` layer that captures drain events (target `"drain"`) and writes them to SQLite via a background worker thread. Also extend `agent_hub.rs` to route `"drain"` messages from agents into tracing spans.

## Phases

- [x] Create `src-tauri/src/logging/sqlite_layer.rs` — tracing Layer impl
- [x] Create `src-tauri/src/logging/sqlite_worker.rs` — background thread + SQLite writes
- [x] Extend `src-tauri/src/agent_hub.rs` — route `"drain"` messages to tracing
- [x] Register `SQLiteLayer` in `src-tauri/src/logging/mod.rs`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## New File: `src-tauri/src/logging/sqlite_layer.rs`

### Pattern to clone

`log_server.rs:43-64` — `LogServerLayer` with `mpsc::Sender`. Same architecture:

```rust
pub struct SQLiteLayer {
    sender: mpsc::Sender<DrainRow>,
}
```

### DrainRow struct

Intermediate struct sent over the channel (decomposed from tracing fields):

```rust
pub struct DrainRow {
    pub event_id: String,          // UUID v4
    pub event: String,             // e.g. "tool:started"
    pub ts: i64,                   // Unix ms (generated here, not from agent)
    pub thread_id: String,
    pub properties: Vec<(String, PropertyValue)>,
}

pub enum PropertyValue {
    String(String),
    Number(f64),
    Bool(bool),
}
```

### Layer impl

Filter on `target == "drain"` in `on_event()`. Extract structured fields using a custom `Visit` impl:
- `thread_id` field → `DrainRow.thread_id`
- `event` field → `DrainRow.event`
- `properties` field → JSON string, parse into `Vec<(String, PropertyValue)>` using `serde_json::from_str`

Generate `event_id` with `uuid::Uuid::new_v4()` (already a dependency via Tauri). Generate `ts` with `chrono::Utc::now().timestamp_millis()` (already a dependency).

Non-blocking send — drop if channel full (same as `log_server.rs:287-290`).

### Key differences from LogServerLayer

| Aspect | LogServerLayer | SQLiteLayer |
|--------|---------------|-------------|
| Sink | HTTP POST to backend | SQLite INSERT |
| Filter | Excludes ureq/rustls | `target == "drain"` only |
| Row type | Single `LogRow` | `DrainRow` + N property rows |
| Batch size | 100 | 50 (fewer, but more rows per event) |

---

## New File: `src-tauri/src/logging/sqlite_worker.rs`

### Pattern to clone

`log_server.rs:71-124` — `batch_worker()`. Same structure:
- `mpsc::Receiver<DrainRow>`
- `recv_timeout` loop with flush on count (50) or interval (5s)
- Final flush on channel disconnect

### SQLite setup

```rust
fn open_db() -> rusqlite::Connection {
    let db_path = /* ~/.mort/drain.sqlite3 */;
    let conn = rusqlite::Connection::open(db_path).expect("Failed to open drain DB");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").unwrap();
    init_schema(&conn);
    conn
}
```

Schema from original plan (`plans/agent-analytics-drains.md` § SQLite Schema). Use `execute_batch` for table + index creation.

### Batch insert

```rust
fn flush_batch(conn: &rusqlite::Connection, buffer: &mut Vec<DrainRow>) {
    if buffer.is_empty() { return; }
    let tx = conn.unchecked_transaction().unwrap();
    {
        let mut event_stmt = tx.prepare_cached(
            "INSERT INTO drain_events (event_id, event, ts, thread_id) VALUES (?1, ?2, ?3, ?4)"
        ).unwrap();
        let mut prop_stmt = tx.prepare_cached(
            "INSERT INTO event_properties (event_id, key, value_string, value_number, value_bool) VALUES (?1, ?2, ?3, ?4, ?5)"
        ).unwrap();
        for row in buffer.iter() {
            event_stmt.execute((&row.event_id, &row.event, &row.ts, &row.thread_id)).unwrap();
            for (key, val) in &row.properties {
                match val {
                    PropertyValue::String(s) => prop_stmt.execute((&row.event_id, key, Some(s), None::<f64>, None::<i32>)),
                    PropertyValue::Number(n) => prop_stmt.execute((&row.event_id, key, None::<&str>, Some(n), None::<i32>)),
                    PropertyValue::Bool(b) => prop_stmt.execute((&row.event_id, key, None::<&str>, None::<f64>, Some(*b as i32))),
                }.unwrap();
            }
        }
    }
    tx.commit().unwrap();
    buffer.clear();
}
```

### DB path

Use `~/.mort/drain.sqlite3` — same directory as other mort state. Get path from `mort_dir` env or `dirs::home_dir().join(".mort")`.

### No retry logic needed

Unlike `LogServerLayer` (HTTP can fail), SQLite writes are local and reliable. If a write fails, log the error and drop the batch (don't retry).

---

## Modified File: `src-tauri/src/agent_hub.rs`

### Change

Add a new `msg_type == "drain"` branch in `handle_connection()` at line ~272 (after relay handling, before the catch-all `emit("agent:message")`).

```rust
// Handle drain messages — bridge to tracing for SQLite layer
if msg.msg_type == "drain" {
    if let (Some(event), Some(props)) = (
        msg.rest.get("event").and_then(|v| v.as_str()),
        msg.rest.get("properties"),
    ) {
        let props_str = props.to_string();
        tracing::info!(
            target: "drain",
            thread_id = %msg.thread_id,
            event = %event,
            properties = %props_str,
        );
    }
    continue;  // Don't forward to frontend — drain events are storage-only
}
```

This bridges the hub socket protocol to the tracing subscriber, where `SQLiteLayer` picks it up.

---

## Modified File: `src-tauri/src/logging/mod.rs`

### Change

Add `SQLiteLayer` to the subscriber registry at line ~428 (alongside `log_server_layer`).

```rust
// SQLite drain layer — always enabled, writes to ~/.mort/drain.sqlite3
let sqlite_drain_layer = sqlite_layer::SQLiteLayer::new();

tracing_subscriber::registry()
    .with(chrome_reload_layer)
    .with(console_layer)
    .with(json_layer)
    .with(BufferLayer)
    .with(log_server_layer)
    .with(sqlite_drain_layer)  // NEW
    .init();
```

Also add `pub mod sqlite_layer;` and `pub mod sqlite_worker;` to the module declarations.

### Filter

The `SQLiteLayer` itself filters on `target == "drain"` — no need for an `EnvFilter` wrapper. Regular logs (mort::*, web, etc.) pass through the layer's `on_event()` but get rejected by the target check immediately.
