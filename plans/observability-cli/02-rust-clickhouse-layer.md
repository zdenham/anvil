# Rust ClickHouse Tracing Layer

## Overview

Add a ClickHouse transport to the existing Rust `tracing` logging system for uploading logs.

**Parallel execution:** This plan can be implemented independently of the orb CLI tool.

## Current Architecture

The centralized logger in `src-tauri/src/logging.rs` uses `tracing-subscriber` with:
1. Console layer - Colored, human-readable output
2. JSON file layer - Writes to `logs/structured.jsonl`
3. Buffer layer - In-memory circular buffer for frontend display

## Implementation Steps

### Step 1: Add dependencies

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
clickhouse = { version = "0.13", features = ["tls"] }
```

Note: `tokio` with `sync` and `time` features should already be present.

### Step 2: Create ClickHouse layer module

**File:** `src-tauri/src/logging/clickhouse.rs`

```rust
use clickhouse::{Client, Row};
use serde::Serialize;
use std::sync::mpsc;
use std::time::Duration;
use tracing_subscriber::Layer;

#[derive(Debug, Clone, Serialize, Row)]
struct LogRow {
    // Core fields (always present)
    timestamp: i64,              // DateTime64(3) as milliseconds
    level: String,
    message: String,
    target: String,

    // Instance identification (always present)
    version: String,             // From env!("CARGO_PKG_VERSION")
    session_id: String,          // UUID generated on app start

    // Source context (optional)
    source: Option<String>,      // Window source (main, spotlight, task-panel)

    // Domain context (optional)
    task_id: Option<String>,
    thread_id: Option<String>,
    repo_name: Option<String>,
    worktree_path: Option<String>,

    // Operation metrics (optional)
    duration_ms: Option<i64>,

    // Extended data (optional)
    data: Option<String>,        // JSON blob for extra fields
}

pub struct ClickHouseLayer {
    sender: mpsc::Sender<LogRow>,
}

impl ClickHouseLayer {
    pub fn new(config: ClickHouseConfig) -> Self {
        let (sender, receiver) = mpsc::channel::<LogRow>();

        // Spawn background worker for batched inserts
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(batch_worker(receiver, config));
        });

        Self { sender }
    }
}
```

### Step 3: Implement batch worker

```rust
async fn batch_worker(receiver: mpsc::Receiver<LogRow>, config: ClickHouseConfig) {
    let client = Client::default()
        .with_url(&config.host)
        .with_user(&config.user)
        .with_password(&config.password)
        .with_database(&config.database);

    let mut batch: Vec<LogRow> = Vec::with_capacity(100);
    let flush_interval = Duration::from_secs(5);
    let max_batch_size = 100;

    loop {
        match receiver.recv_timeout(flush_interval) {
            Ok(row) => {
                batch.push(row);
                if batch.len() >= max_batch_size {
                    flush_batch(&client, &config.table, &mut batch).await;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !batch.is_empty() {
                    flush_batch(&client, &config.table, &mut batch).await;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

async fn flush_batch(client: &Client, table: &str, batch: &mut Vec<LogRow>) {
    if batch.is_empty() {
        return;
    }

    let mut insert = match client.insert(table) {
        Ok(insert) => insert,
        Err(e) => {
            eprintln!("ClickHouse insert error: {}", e);
            batch.clear();
            return;
        }
    };

    for row in batch.drain(..) {
        if let Err(e) = insert.write(&row).await {
            eprintln!("ClickHouse write error: {}", e);
        }
    }

    if let Err(e) = insert.end().await {
        eprintln!("ClickHouse flush error: {}", e);
    }
}
```

### Step 4: Implement tracing Layer trait

```rust
impl<S> Layer<S> for ClickHouseLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = LogVisitor::default();
        event.record(&mut visitor);

        let row = LogRow {
            timestamp: chrono::Utc::now().timestamp_millis(),
            level: event.metadata().level().to_string(),
            message: visitor.message.unwrap_or_default(),
            target: event.metadata().target().to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            session_id: SESSION_ID.clone(),
            source: visitor.source,
            task_id: visitor.task_id,
            thread_id: visitor.thread_id,
            repo_name: visitor.repo_name,
            worktree_path: visitor.worktree_path,
            duration_ms: visitor.duration_ms,
            data: visitor.extra_fields_as_json(),
        };

        let _ = self.sender.try_send(row);
    }
}
```

### Step 5: Create configuration module

**File:** `src-tauri/src/logging/config.rs`

```rust
#[derive(Debug, Clone)]
pub struct ClickHouseConfig {
    pub enabled: bool,
    pub host: String,
    pub user: String,
    pub password: String,
    pub database: String,
    pub table: String,
}

impl ClickHouseConfig {
    pub fn from_env() -> Option<Self> {
        let enabled = std::env::var("CLICKHOUSE_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        Some(Self {
            enabled,
            host: std::env::var("CLICKHOUSE_HOST").ok()?,
            user: std::env::var("CLICKHOUSE_USER").ok()?,
            password: std::env::var("CLICKHOUSE_PASSWORD").ok()?,
            database: std::env::var("CLICKHOUSE_DATABASE").unwrap_or_else(|_| "default".into()),
            table: std::env::var("CLICKHOUSE_LOG_TABLE").unwrap_or_else(|_| "logs".into()),
        })
    }
}
```

### Step 6: Integrate into logging.rs

Update `src-tauri/src/logging.rs`:

```rust
pub fn initialize() -> Result<(), Box<dyn std::error::Error>> {
    let console_layer = /* existing */;
    let json_layer = /* existing */;
    let buffer_layer = /* existing */;

    // Optional ClickHouse layer
    let clickhouse_layer = ClickHouseConfig::from_env()
        .map(|config| ClickHouseLayer::new(config));

    let subscriber = tracing_subscriber::registry()
        .with(console_layer)
        .with(json_layer)
        .with(buffer_layer)
        .with(clickhouse_layer);

    tracing::subscriber::set_global_default(subscriber)?;
    Ok(())
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLICKHOUSE_ENABLED` | Yes | Set to `true` or `1` to enable |
| `CLICKHOUSE_HOST` | Yes | ClickHouse server URL (e.g., `https://host:8443`) |
| `CLICKHOUSE_USER` | Yes | Username |
| `CLICKHOUSE_PASSWORD` | Yes | Password |
| `CLICKHOUSE_DATABASE` | No | Database name (default: `default`) |
| `CLICKHOUSE_LOG_TABLE` | No | Table name (default: `logs`) |

## Batching Behavior

- **Batch size:** 100 logs
- **Flush interval:** 5 seconds
- **Failure handling:** Logs dropped on persistent connection failure
- **Channel:** Bounded channel to prevent memory growth

## ClickHouse Table DDL

```sql
CREATE TABLE logs (
    timestamp DateTime64(3),
    level LowCardinality(String),
    message String,
    target LowCardinality(String),
    version String,
    session_id String,
    source Nullable(LowCardinality(String)),
    task_id Nullable(String),
    thread_id Nullable(String),
    repo_name Nullable(String),
    worktree_path Nullable(String),
    duration_ms Nullable(Int64),
    data Nullable(String)
) ENGINE = MergeTree()
ORDER BY (timestamp, session_id, level)
TTL timestamp + INTERVAL 30 DAY;
```
