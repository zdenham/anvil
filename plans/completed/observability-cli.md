# Observability CLI Plan

## Overview

Create a TypeScript CLI tool for querying ClickHouse log data. This tool will be invokable via `tsx` and provide direct command-line query execution with JSON output.

## Naming

Name: **`orb`**

## Directory Structure

```
anvil/
└── observability/
    └── orb/
        ├── index.ts          # Entry point, CLI argument parsing
        ├── commands.ts       # Command handlers (query, list, etc.)
        ├── query.ts          # SQL execution and JSON result formatting
        ├── types.ts          # TypeScript interfaces
        └── env.ts            # Environment variable loading
```

## Dependencies

Add to `package.json`:
```json
{
  "@clickhouse/client": "^1.0.0"  // Official ClickHouse client for Node.js
}
```

## Implementation Steps

### Phase 1: Core Infrastructure

1. **Create directory structure** - Set up `observability/orb/` directory

2. **Implement `types.ts`** - Define interfaces:
   ```typescript
   interface LogEntry {
     // === Core fields (always present) ===
     timestamp: string;         // ISO timestamp with ms precision
     level: string;             // debug, info, warn, error
     message: string;           // Human-readable message
     target: string;            // Rust module (e.g., "web", "worktree_commands", "clipboard")

     // === Instance identification ===
     version: string;           // App version from Cargo.toml (e.g., "0.0.15")
     session_id: string;        // UUID generated on each app start

     // === Source context (optional) ===
     source?: string;           // Window source for frontend logs (main, spotlight, task-panel)

     // === Domain context (optional - set when relevant) ===
     task_id?: string;          // Task being operated on
     thread_id?: string;        // Agent thread ID
     repo_name?: string;        // Repository being operated on
     worktree_path?: string;    // Git worktree path

     // === Operation metrics (optional) ===
     duration_ms?: number;      // Operation duration

     // === Extended data ===
     data?: string;             // JSON blob for additional structured fields
   }

   interface QueryResult {
     rows: Record<string, unknown>[];
     rowCount: number;
     elapsed: number;
   }
   ```

3. **Implement `env.ts`** - Environment loading:
   - Load from `.env` files (current dir, then parents)
   - Support `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_HOST`, `CLICKHOUSE_LOG_TABLE`
   - Merge with actual environment variables

### Phase 2: Query Engine

4. **Implement `query.ts`** - ClickHouse query execution:
   - Connect to ClickHouse with TLS
   - Execute SQL queries
   - Format results as JSON (omit empty/zero values)
   - Handle errors gracefully
   - Support query timeout

### Phase 3: Commands

5. **Implement `commands.ts`** - Command handlers:
   - `query "<SQL>"` - Execute SQL and return JSON
   - `list` - List all tables
   - `help` - Show usage

### Phase 4: CLI Entry Point

6. **Implement `index.ts`** - Entry point:
   - Parse CLI arguments
   - Route to appropriate command handler
   - Handle `--help`, `--version`
   - Default table from `CLICKHOUSE_LOG_TABLE` env var

### Phase 5: Integration

7. **Add npm script** to `package.json`:
   ```json
   {
     "scripts": {
       "orb": "tsx observability/orb/index.ts"
     }
   }
   ```

8. **Create `.env.example`** with required environment variables

## Usage Examples

```bash
# Direct query
pnpm orb "SELECT * FROM logs LIMIT 10"

# With command prefix
pnpm orb query "SHOW TABLES"

# List tables
pnpm orb list

# Show help
pnpm orb --help
```

## Log Schema

The tool will query logs with this schema (tailored for anvil desktop app):

| Field | Type | Description |
|-------|------|-------------|
| **Core fields** | | *Always present* |
| timestamp | DateTime64(3) | Event time (ms precision) |
| level | LowCardinality(String) | debug, info, warn, error |
| message | String | Event message |
| target | LowCardinality(String) | Rust module (e.g., "web", "worktree_commands") |
| **Instance identification** | | *Always present* |
| version | String | App version (e.g., "0.0.15") |
| session_id | String | UUID generated on each app start |
| **Source context** | | *Optional* |
| source | Nullable(LowCardinality(String)) | Window source (main, spotlight, task-panel) |
| **Domain context** | | *Optional - set when relevant* |
| task_id | Nullable(String) | Task being operated on |
| thread_id | Nullable(String) | Agent thread ID |
| repo_name | Nullable(String) | Repository being operated on |
| worktree_path | Nullable(String) | Git worktree path |
| **Operation metrics** | | *Optional* |
| duration_ms | Nullable(Int64) | Operation duration in milliseconds |
| **Extended data** | | *Optional* |
| data | Nullable(String) | JSON blob for additional structured fields |

## Future Enhancements (Not in Initial Scope)

- Admin mode for DDL operations (createtable, droptable, addcolumns, setttl)
- Skills/workflow system for automated analysis
- Web UI integration

---

## Logger Integration (ClickHouse Transport)

Add a ClickHouse transport to the existing Rust `tracing` logging system to upload logs.

### Current Architecture

The centralized logger in `src-tauri/src/logging.rs` uses `tracing-subscriber` with multiple layers:
1. **Console layer** - Colored, human-readable output
2. **JSON file layer** - Writes to `logs/structured.jsonl`
3. **Buffer layer** - In-memory circular buffer for frontend display

### Implementation Plan

#### 1. Add Dependencies

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
clickhouse = { version = "0.13", features = ["tls"] }
tokio = { version = "1", features = ["sync", "time"] }
```

#### 2. Create ClickHouse Layer

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

#### 3. Implement Batch Worker

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
            batch.clear(); // Drop logs on persistent failure
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

#### 4. Implement tracing Layer Trait

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
            // Core fields
            timestamp: chrono::Utc::now().timestamp_millis(),
            level: event.metadata().level().to_string(),
            message: visitor.message.unwrap_or_default(),
            target: event.metadata().target().to_string(),

            // Instance identification
            version: env!("CARGO_PKG_VERSION").to_string(),
            session_id: SESSION_ID.clone(), // Static UUID generated on init

            // Optional fields from visitor
            source: visitor.source,
            task_id: visitor.task_id,
            thread_id: visitor.thread_id,
            repo_name: visitor.repo_name,
            worktree_path: visitor.worktree_path,
            duration_ms: visitor.duration_ms,
            data: visitor.extra_fields_as_json(),
        };

        // Non-blocking send - drop if channel full
        let _ = self.sender.try_send(row);
    }
}
```

#### 5. Configuration

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

#### 6. Integrate into logging.rs

Update `src-tauri/src/logging.rs` initialization:

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

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLICKHOUSE_ENABLED` | Yes | Set to `true` or `1` to enable |
| `CLICKHOUSE_HOST` | Yes | ClickHouse server URL (e.g., `https://host:8443`) |
| `CLICKHOUSE_USER` | Yes | Username |
| `CLICKHOUSE_PASSWORD` | Yes | Password |
| `CLICKHOUSE_DATABASE` | No | Database name (default: `default`) |
| `CLICKHOUSE_LOG_TABLE` | No | Table name (default: `logs`) |

### Batching Behavior

- **Batch size:** 100 logs (configurable)
- **Flush interval:** 5 seconds (configurable)
- **Failure handling:** Logs are dropped on persistent connection failure (no local queue)
- **Channel:** Bounded channel to prevent memory growth; drops logs when full

### ClickHouse Table DDL

```sql
CREATE TABLE logs (
    -- Core fields (always present)
    timestamp DateTime64(3),
    level LowCardinality(String),
    message String,
    target LowCardinality(String),

    -- Instance identification (always present)
    version String,
    session_id String,

    -- Source context (optional)
    source Nullable(LowCardinality(String)),

    -- Domain context (optional)
    task_id Nullable(String),
    thread_id Nullable(String),
    repo_name Nullable(String),
    worktree_path Nullable(String),

    -- Operation metrics (optional)
    duration_ms Nullable(Int64),

    -- Extended data (optional)
    data Nullable(String)
) ENGINE = MergeTree()
ORDER BY (timestamp, session_id, level)
TTL timestamp + INTERVAL 30 DAY;
```

### Implementation Steps Summary

1. Add `clickhouse` crate to `Cargo.toml`
2. Create `src-tauri/src/logging/clickhouse.rs` with ClickHouseLayer
3. Create `src-tauri/src/logging/config.rs` for configuration
4. Update `src-tauri/src/logging.rs` to conditionally add the ClickHouse layer
5. Add `.env.example` entries for ClickHouse configuration
6. Test with local ClickHouse instance
