# Rust ClickHouse Tracing Layer

## Overview

Add a ClickHouse transport to the existing Rust `tracing` logging system for uploading logs.

**Parallel execution:** This plan can be implemented independently of the orb CLI tool.

**Integration:** This layer writes logs to the same ClickHouse table that the orb CLI tool queries. Both components share the same environment variables and schema to ensure seamless data flow.

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
tokio = { version = "1", features = ["sync", "time", "rt"] }
```

Note: The `tokio` dependency may already be present via Tauri, but we need `sync` and `time` features for the channel and interval timer.

### Step 2: Create ClickHouse layer module

**File:** `src-tauri/src/logging/clickhouse.rs`

```rust
use clickhouse::{Client, Row};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing_subscriber::Layer;
use uuid::Uuid;

/// Session ID generated once at app startup, shared across all log entries
static SESSION_ID: OnceLock<String> = OnceLock::new();

fn get_session_id() -> &'static str {
    SESSION_ID.get_or_init(|| Uuid::new_v4().to_string())
}

/// Log row matching the ClickHouse table schema.
/// Field names and types must match exactly for the orb CLI to query correctly.
#[derive(Debug, Clone, Serialize, Row)]
pub struct LogRow {
    // Core fields (always present)
    #[serde(rename = "timestamp")]
    pub timestamp: i64,              // DateTime64(3) as milliseconds since epoch
    pub level: String,               // TRACE, DEBUG, INFO, WARN, ERROR
    pub message: String,
    pub target: String,              // Rust module path (e.g., "mort::clipboard")

    // Instance identification (always present)
    pub version: String,             // From CARGO_PKG_VERSION
    pub session_id: String,          // UUID generated on app start

    // Build identification
    pub app_suffix: String,          // Build suffix (e.g., "dev", "" for production)

    // Source context (optional)
    pub source: Option<String>,      // Window source (main, spotlight, task-panel)

    // Domain context (optional)
    pub task_id: Option<String>,
    pub thread_id: Option<String>,
    pub repo_name: Option<String>,
    pub worktree_path: Option<String>,

    // Operation metrics (optional)
    pub duration_ms: Option<i64>,

    // Extended data (optional)
    pub data: Option<String>,        // JSON blob for extra structured fields
}

/// Channel capacity - how many logs can queue before backpressure
const CHANNEL_CAPACITY: usize = 10_000;

/// Batch size - flush when this many logs accumulate
const BATCH_SIZE: usize = 100;

/// Flush interval - flush at least this often, even if batch not full
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Retry configuration
const MAX_RETRIES: u32 = 3;
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(100);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(5);

/// Maximum logs to buffer during connection issues (prevents unbounded memory growth)
const MAX_RETRY_BUFFER: usize = 5_000;

pub struct ClickHouseLayer {
    sender: mpsc::Sender<LogRow>,
}

impl ClickHouseLayer {
    /// Creates a new ClickHouse layer with the given configuration.
    /// Spawns a background worker thread that handles batching and async writes.
    pub fn new(config: ClickHouseConfig) -> Self {
        let (sender, receiver) = mpsc::channel::<LogRow>(CHANNEL_CAPACITY);

        // Spawn background worker thread with its own tokio runtime.
        // This isolates the async ClickHouse operations from the main app.
        std::thread::Builder::new()
            .name("clickhouse-logger".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Failed to create tokio runtime for ClickHouse logger");
                rt.block_on(batch_worker(receiver, config));
            })
            .expect("Failed to spawn ClickHouse logger thread");

        Self { sender }
    }
}
```

### Step 3: Implement batch worker with retry logic

```rust
/// Background worker that batches logs and writes to ClickHouse.
/// Implements exponential backoff retry and graceful degradation.
async fn batch_worker(mut receiver: mpsc::Receiver<LogRow>, config: ClickHouseConfig) {
    let client = Client::default()
        .with_url(&config.host)
        .with_user(&config.user)
        .with_password(&config.password)
        .with_database(&config.database);

    let mut batch: Vec<LogRow> = Vec::with_capacity(BATCH_SIZE);
    let mut retry_buffer: Vec<LogRow> = Vec::new();
    let mut consecutive_failures: u32 = 0;
    let mut interval = tokio::time::interval(FLUSH_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            // Receive new log entries
            Some(row) = receiver.recv() => {
                batch.push(row);
                if batch.len() >= BATCH_SIZE {
                    flush_with_retry(
                        &client,
                        &config.table,
                        &mut batch,
                        &mut retry_buffer,
                        &mut consecutive_failures,
                    ).await;
                }
            }
            // Periodic flush
            _ = interval.tick() => {
                if !batch.is_empty() || !retry_buffer.is_empty() {
                    flush_with_retry(
                        &client,
                        &config.table,
                        &mut batch,
                        &mut retry_buffer,
                        &mut consecutive_failures,
                    ).await;
                }
            }
            // Channel closed - flush remaining and exit
            else => {
                if !batch.is_empty() {
                    let _ = flush_batch(&client, &config.table, &mut batch).await;
                }
                break;
            }
        }
    }
}

/// Attempts to flush with exponential backoff retry.
/// On persistent failure, moves logs to retry buffer (with size limit).
async fn flush_with_retry(
    client: &Client,
    table: &str,
    batch: &mut Vec<LogRow>,
    retry_buffer: &mut Vec<LogRow>,
    consecutive_failures: &mut u32,
) {
    // First, try to flush any previously failed logs
    if !retry_buffer.is_empty() {
        let mut retry_batch: Vec<LogRow> = retry_buffer.drain(..).collect();
        if flush_batch(client, table, &mut retry_batch).await.is_err() {
            // Still failing, put back what we can
            let space = MAX_RETRY_BUFFER.saturating_sub(retry_buffer.len());
            retry_buffer.extend(retry_batch.into_iter().take(space));
        } else {
            *consecutive_failures = 0;
        }
    }

    // Now flush the current batch
    if batch.is_empty() {
        return;
    }

    let mut delay = INITIAL_RETRY_DELAY;
    for attempt in 0..MAX_RETRIES {
        match flush_batch(client, table, batch).await {
            Ok(()) => {
                *consecutive_failures = 0;
                return;
            }
            Err(e) => {
                if attempt < MAX_RETRIES - 1 {
                    // Log retry attempt (to console only, not ClickHouse to avoid loops)
                    eprintln!(
                        "ClickHouse flush attempt {} failed: {}. Retrying in {:?}...",
                        attempt + 1, e, delay
                    );
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(MAX_RETRY_DELAY);
                }
            }
        }
    }

    // All retries exhausted - move to retry buffer or drop if buffer full
    *consecutive_failures += 1;
    let space = MAX_RETRY_BUFFER.saturating_sub(retry_buffer.len());

    if space > 0 {
        retry_buffer.extend(batch.drain(..).take(space));
        if *consecutive_failures == 1 {
            eprintln!(
                "ClickHouse temporarily unavailable. Buffering logs (up to {} entries).",
                MAX_RETRY_BUFFER
            );
        }
    } else {
        let dropped = batch.len();
        batch.clear();
        eprintln!(
            "ClickHouse retry buffer full. Dropped {} log entries.",
            dropped
        );
    }
}

/// Performs the actual ClickHouse insert operation.
async fn flush_batch(
    client: &Client,
    table: &str,
    batch: &mut Vec<LogRow>,
) -> Result<(), clickhouse::error::Error> {
    if batch.is_empty() {
        return Ok(());
    }

    let mut insert = client.insert(table)?;

    for row in batch.drain(..) {
        insert.write(&row).await?;
    }

    insert.end().await?;
    Ok(())
}
```

### Step 4: Implement tracing Layer trait with field extraction

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
            session_id: get_session_id().to_string(),
            app_suffix: crate::build_info::APP_SUFFIX.to_string(),
            source: visitor.source,
            task_id: visitor.task_id,
            thread_id: visitor.thread_id,
            repo_name: visitor.repo_name,
            worktree_path: visitor.worktree_path,
            duration_ms: visitor.duration_ms,
            data: visitor.extra_fields_as_json(),
        };

        // Non-blocking send - if channel is full, drop the log rather than blocking
        // This ensures logging never impacts app performance
        if self.sender.try_send(row).is_err() {
            // Channel full - log is dropped. This should be rare with 10k capacity.
            // We don't log this to avoid recursive issues.
        }
    }
}

/// Visitor that extracts known fields and collects extras into a JSON blob
#[derive(Default)]
struct LogVisitor {
    message: Option<String>,
    source: Option<String>,
    task_id: Option<String>,
    thread_id: Option<String>,
    repo_name: Option<String>,
    worktree_path: Option<String>,
    duration_ms: Option<i64>,
    extra_fields: std::collections::HashMap<String, serde_json::Value>,
}

impl LogVisitor {
    /// Converts extra fields to a JSON string, or None if empty
    fn extra_fields_as_json(&self) -> Option<String> {
        if self.extra_fields.is_empty() {
            None
        } else {
            serde_json::to_string(&self.extra_fields).ok()
        }
    }
}

impl tracing::field::Visit for LogVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let value_str = format!("{:?}", value);
        self.record_field(field.name(), serde_json::Value::String(value_str));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.record_field(field.name(), serde_json::Value::String(value.to_string()));
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.record_field(field.name(), serde_json::json!(value));
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.record_field(field.name(), serde_json::json!(value));
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.record_field(field.name(), serde_json::json!(value));
    }
}

impl LogVisitor {
    fn record_field(&mut self, name: &str, value: serde_json::Value) {
        match name {
            "message" => {
                self.message = value.as_str().map(|s| {
                    // Remove surrounding quotes if present (from debug formatting)
                    let s = s.trim();
                    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
                        s[1..s.len() - 1].to_string()
                    } else {
                        s.to_string()
                    }
                });
            }
            "source" => self.source = value.as_str().map(String::from),
            "task_id" => self.task_id = value.as_str().map(String::from),
            "thread_id" => self.thread_id = value.as_str().map(String::from),
            "repo_name" => self.repo_name = value.as_str().map(String::from),
            "worktree_path" => self.worktree_path = value.as_str().map(String::from),
            "duration_ms" => self.duration_ms = value.as_i64(),
            _ => {
                // Collect unknown fields into extra_fields
                self.extra_fields.insert(name.to_string(), value);
            }
        }
    }
}
```

### Step 5: Create configuration module

**File:** `src-tauri/src/logging/config.rs`

```rust
/// Configuration for ClickHouse log transport.
///
/// Environment variables are shared with the orb CLI tool:
/// - CLICKHOUSE_HOST: ClickHouse server URL (e.g., https://host:8443)
/// - CLICKHOUSE_USER: Username for authentication
/// - CLICKHOUSE_PASSWORD: Password for authentication
/// - CLICKHOUSE_DATABASE: Database name (default: "default")
/// - CLICKHOUSE_LOG_TABLE: Table name (default: "logs")
#[derive(Debug, Clone)]
pub struct ClickHouseConfig {
    pub host: String,
    pub user: String,
    pub password: String,
    pub database: String,
    pub table: String,
}

impl ClickHouseConfig {
    /// Attempts to load configuration from environment variables.
    ///
    /// Returns None if:
    /// - CLICKHOUSE_ENABLED is not "true" or "1"
    /// - Required variables (HOST, USER, PASSWORD) are missing
    ///
    /// This allows the app to run normally without ClickHouse configured.
    pub fn from_env() -> Option<Self> {
        // Check if explicitly enabled
        let enabled = std::env::var("CLICKHOUSE_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        // Required fields - return None if any are missing
        let host = std::env::var("CLICKHOUSE_HOST").ok()?;
        let user = std::env::var("CLICKHOUSE_USER").ok()?;
        let password = std::env::var("CLICKHOUSE_PASSWORD").ok()?;

        // Optional fields with defaults
        let database = std::env::var("CLICKHOUSE_DATABASE")
            .unwrap_or_else(|_| "default".into());
        let table = std::env::var("CLICKHOUSE_LOG_TABLE")
            .unwrap_or_else(|_| "logs".into());

        // Validate host URL format
        if !host.starts_with("http://") && !host.starts_with("https://") {
            eprintln!(
                "Warning: CLICKHOUSE_HOST should include protocol (http:// or https://). Got: {}",
                host
            );
        }

        Some(Self {
            host,
            user,
            password,
            database,
            table,
        })
    }
}
```

### Step 6: Create module structure

**File:** `src-tauri/src/logging/mod.rs`

Refactor `logging.rs` into a module structure:

```rust
mod clickhouse;
mod config;

pub use clickhouse::ClickHouseLayer;
pub use config::ClickHouseConfig;

// ... rest of existing logging.rs content ...
```

### Step 7: Integrate into logging initialization

Update `src-tauri/src/logging.rs` (or `logging/mod.rs`):

```rust
use crate::logging::{ClickHouseConfig, ClickHouseLayer};

pub fn initialize() {
    let _ = START_TIME.set(Instant::now());

    // Set up the console layer with colored, compact output
    let console_layer = fmt::layer()
        .with_timer(UptimeTimer)
        .with_target(true)
        .with_level(true)
        .with_ansi(true)
        .compact()
        .with_filter(EnvFilter::new("debug"));

    // Set up the JSON file layer
    let json_layer = match setup_json_layer() {
        Ok(layer) => Some(layer),
        Err(e) => {
            eprintln!("Warning: Could not set up JSON logging: {}", e);
            None
        }
    };

    // Optional ClickHouse layer - only enabled if configured
    let clickhouse_layer = ClickHouseConfig::from_env().map(|config| {
        tracing::info!(
            "ClickHouse logging enabled: {}@{}",
            config.database,
            config.host
        );
        ClickHouseLayer::new(config)
    });

    // Initialize the subscriber with all layers
    tracing_subscriber::registry()
        .with(console_layer)
        .with(json_layer)
        .with(BufferLayer)
        .with(clickhouse_layer)
        .init();

    tracing::info!("Logging initialized");
}
```

## Environment Variables

These environment variables are **shared with the orb CLI tool** to ensure consistent configuration:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `CLICKHOUSE_ENABLED` | Yes | Set to `true` or `1` to enable | `true` |
| `CLICKHOUSE_HOST` | Yes | ClickHouse server URL (include protocol) | `https://play.clickhouse.com:8443` |
| `CLICKHOUSE_USER` | Yes | Username for authentication | `default` |
| `CLICKHOUSE_PASSWORD` | Yes | Password for authentication | `secret` |
| `CLICKHOUSE_DATABASE` | No | Database name (default: `default`) | `observability` |
| `CLICKHOUSE_LOG_TABLE` | No | Table name (default: `logs`) | `app_logs` |

### Example .env file

```bash
# ClickHouse Configuration (shared between Rust layer and orb CLI)
CLICKHOUSE_ENABLED=true
CLICKHOUSE_HOST=https://your-clickhouse-host:8443
CLICKHOUSE_USER=your_user
CLICKHOUSE_PASSWORD=your_password
CLICKHOUSE_DATABASE=observability
CLICKHOUSE_LOG_TABLE=logs
```

## Batching and Resilience

### Performance Characteristics

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Channel capacity | 10,000 | Handles burst logging without blocking |
| Batch size | 100 | Balances network efficiency vs. latency |
| Flush interval | 5 seconds | Ensures timely writes even at low volume |

### Failure Handling

| Scenario | Behavior |
|----------|----------|
| ClickHouse temporarily unavailable | Exponential backoff retry (100ms -> 5s max) |
| Persistent connection failure | Buffer up to 5,000 logs, then drop oldest |
| Channel full (burst > 10k) | Drop new logs (non-blocking to protect app) |
| App shutdown | Final flush attempt before exit |

### Retry Logic

- **Max retries:** 3 attempts per flush
- **Backoff:** Exponential (100ms, 200ms, 400ms...) capped at 5 seconds
- **Recovery:** Automatically attempts to flush buffered logs when connection restores

## ClickHouse Table DDL

```sql
-- Create the logs table
-- This schema is shared between the Rust layer (writes) and orb CLI (reads)
CREATE TABLE IF NOT EXISTS logs (
    -- Core fields
    timestamp DateTime64(3),
    level LowCardinality(String),
    message String,
    target LowCardinality(String),

    -- Instance identification
    version String,
    session_id String,
    app_suffix LowCardinality(String),

    -- Source context
    source Nullable(LowCardinality(String)),

    -- Domain context
    task_id Nullable(String),
    thread_id Nullable(String),
    repo_name Nullable(String),
    worktree_path Nullable(String),

    -- Operation metrics
    duration_ms Nullable(Int64),

    -- Extended data
    data Nullable(String)
) ENGINE = MergeTree()
ORDER BY (timestamp, session_id, level)
TTL timestamp + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;

-- Optional: Create indexes for common query patterns
ALTER TABLE logs ADD INDEX idx_task_id task_id TYPE bloom_filter GRANULARITY 4;
ALTER TABLE logs ADD INDEX idx_thread_id thread_id TYPE bloom_filter GRANULARITY 4;
ALTER TABLE logs ADD INDEX idx_level level TYPE set(5) GRANULARITY 4;
```

## Testing

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_visitor_extracts_known_fields() {
        // Test that known fields are extracted correctly
    }

    #[test]
    fn test_log_visitor_collects_extra_fields() {
        // Test that unknown fields go to extra_fields JSON
    }

    #[test]
    fn test_config_from_env_disabled() {
        std::env::remove_var("CLICKHOUSE_ENABLED");
        assert!(ClickHouseConfig::from_env().is_none());
    }

    #[test]
    fn test_config_from_env_missing_required() {
        std::env::set_var("CLICKHOUSE_ENABLED", "true");
        std::env::remove_var("CLICKHOUSE_HOST");
        assert!(ClickHouseConfig::from_env().is_none());
    }
}
```

### Integration Testing

1. Set up a local ClickHouse instance (Docker recommended):
   ```bash
   docker run -d --name clickhouse-test \
     -p 8123:8123 -p 9000:9000 \
     clickhouse/clickhouse-server
   ```

2. Create the table using the DDL above

3. Run the app with ClickHouse enabled:
   ```bash
   CLICKHOUSE_ENABLED=true \
   CLICKHOUSE_HOST=http://localhost:8123 \
   CLICKHOUSE_USER=default \
   CLICKHOUSE_PASSWORD= \
   cargo run
   ```

4. Query logs using orb:
   ```bash
   pnpm orb "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10"
   ```

## Integration with orb CLI

This layer and the orb CLI form a complete observability pipeline:

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   Rust Application  │     │     ClickHouse      │     │      orb CLI        │
│                     │     │                     │     │                     │
│  tracing::info!()   │────▶│   logs table        │◀────│  SELECT queries     │
│  ClickHouseLayer    │     │   (shared schema)   │     │  JSON output        │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
        WRITES                    STORAGE                      READS
```

### Shared Contract

Both components depend on:
1. **Same environment variables** for connection details
2. **Same table schema** (LogRow struct matches orb's LogEntry interface)
3. **Same field names** - no mapping required

### Example Queries (via orb)

```bash
# Recent errors from this session
pnpm orb "SELECT timestamp, message FROM logs WHERE level = 'ERROR' ORDER BY timestamp DESC LIMIT 20"

# Slow operations (duration > 1 second)
pnpm orb "SELECT target, message, duration_ms FROM logs WHERE duration_ms > 1000"

# Logs by task
pnpm orb "SELECT * FROM logs WHERE task_id = 'abc123' ORDER BY timestamp"

# Session overview
pnpm orb "SELECT session_id, min(timestamp), max(timestamp), count(*) FROM logs GROUP BY session_id ORDER BY min(timestamp) DESC"
```

## File Structure

After implementation:

```
src-tauri/src/
├── logging/
│   ├── mod.rs           # Module exports + existing logging.rs content
│   ├── clickhouse.rs    # ClickHouseLayer implementation
│   └── config.rs        # ClickHouseConfig
├── lib.rs               # Add: mod logging;
└── ...
```
