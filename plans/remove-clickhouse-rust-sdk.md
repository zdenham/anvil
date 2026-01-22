# Remove ClickHouse Rust SDK - Use HTTP REST API Instead

## Problem

The `clickhouse` Rust crate with `native-tls` feature adds **217 transitive dependencies** to the build, significantly increasing compile times. The heavy dependencies include:

- Full TLS/crypto stack (native-tls, OpenSSL bindings)
- HTTP client stack (hyper, http, http-body)
- Async runtime extras (tokio features)

This makes the Rust build very resource-intensive.

## Current State

- **Rust side** (`src-tauri/src/logging/clickhouse.rs`): Uses `clickhouse` crate to **send logs** to ClickHouse via native protocol
- **Node.js side** (`observability/orb/`): Uses `@clickhouse/client` to **query logs** for the orb CLI

The Rust SDK is overkill - we only need to insert log rows, which ClickHouse supports via a simple HTTP REST API.

## Solution

Replace the `clickhouse` Rust crate with direct HTTP POST requests using `reqwest` (which Tauri already depends on transitively, or use `ureq` for a lighter sync client).

ClickHouse HTTP interface: `POST /?query=INSERT INTO table FORMAT JSONEachLine` with JSON body.

## Implementation Steps

### 1. Remove heavy dependencies from Cargo.toml

```toml
# REMOVE these lines:
clickhouse = { version = "0.14", features = ["native-tls"] }
tokio = { version = "1", features = ["sync", "time", "rt"] }

# ADD (if not already present via Tauri):
ureq = { version = "2", features = ["json", "tls"] }
# OR use reqwest if already available
```

### 2. Rewrite `src-tauri/src/logging/clickhouse.rs`

Replace the SDK-based implementation with HTTP POST:

```rust
use serde::Serialize;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

// LogRow struct stays the same (remove #[derive(Row)])
#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp: i64,
    pub level: String,
    pub message: String,
    // ... rest of fields unchanged
}

/// Background worker using ureq (sync HTTP client)
fn batch_worker(receiver: mpsc::Receiver<LogRow>, config: ClickHouseConfig) {
    let url = format!(
        "{}/?query=INSERT%20INTO%20{}%20FORMAT%20JSONEachLine",
        config.host, config.table
    );

    let mut batch: Vec<LogRow> = Vec::with_capacity(BATCH_SIZE);

    loop {
        // Collect batch with timeout
        let deadline = std::time::Instant::now() + FLUSH_INTERVAL;

        while batch.len() < BATCH_SIZE {
            match receiver.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
                Ok(row) => batch.push(row),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // Flush remaining and exit
                    if !batch.is_empty() {
                        let _ = flush_batch_http(&url, &config, &mut batch);
                    }
                    return;
                }
            }
        }

        if !batch.is_empty() {
            let _ = flush_batch_http(&url, &config, &mut batch);
        }
    }
}

fn flush_batch_http(
    url: &str,
    config: &ClickHouseConfig,
    batch: &mut Vec<LogRow>,
) -> Result<(), Box<dyn std::error::Error>> {
    if batch.is_empty() {
        return Ok(());
    }

    // Convert to JSONEachLine format (one JSON object per line)
    let body: String = batch
        .drain(..)
        .map(|row| serde_json::to_string(&row).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n");

    ureq::post(url)
        .set("X-ClickHouse-User", &config.user)
        .set("X-ClickHouse-Key", &config.password)
        .set("X-ClickHouse-Database", &config.database)
        .send_string(&body)?;

    Ok(())
}
```

### 3. Update the layer to use std::sync::mpsc instead of tokio::sync::mpsc

Since we're removing tokio, switch to standard library channels:

```rust
use std::sync::mpsc;

pub struct ClickHouseLayer {
    sender: mpsc::Sender<LogRow>,
}

impl ClickHouseLayer {
    pub fn new(config: ClickHouseConfig) -> Self {
        let (sender, receiver) = mpsc::channel::<LogRow>();

        std::thread::Builder::new()
            .name("clickhouse-logger".into())
            .spawn(move || {
                batch_worker(receiver, config);
            })
            .expect("Failed to spawn ClickHouse logger thread");

        Self { sender }
    }
}
```

### 4. Update the Layer impl to use sync send

```rust
impl<S> Layer<S> for ClickHouseLayer
where
    S: tracing::Subscriber,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: tracing_subscriber::layer::Context<'_, S>) {
        // ... build LogRow same as before ...

        // Use try_send equivalent - just ignore if channel is full
        let _ = self.sender.send(row);
    }
}
```

### 5. Verify ClickHouse HTTP API format

Test the HTTP API manually to ensure compatibility:

```bash
curl -X POST "http://localhost:8123/?query=INSERT%20INTO%20logs%20FORMAT%20JSONEachLine" \
  -H "X-ClickHouse-User: default" \
  -H "X-ClickHouse-Key: password" \
  -d '{"timestamp":1234567890,"level":"INFO","message":"test"}'
```

## Files to Modify

1. `src-tauri/Cargo.toml` - Remove `clickhouse` and `tokio`, add `ureq` if needed
2. `src-tauri/src/logging/clickhouse.rs` - Rewrite to use HTTP API
3. `src-tauri/src/logging/mod.rs` - No changes needed (just uses ClickHouseLayer)

## Expected Build Time Improvement

Removing 217 transitive dependencies from `clickhouse` crate should significantly reduce:
- Initial build time
- Incremental build time when touching logging code
- Memory usage during compilation

## Alternative: Use reqwest

If `reqwest` is already in the dependency tree (via Tauri or other deps), use it instead of adding `ureq`:

```rust
// Check if reqwest is available
use reqwest::blocking::Client;

let client = Client::new();
client.post(&url)
    .header("X-ClickHouse-User", &config.user)
    .header("X-ClickHouse-Key", &config.password)
    .body(body)
    .send()?;
```

## Rollback Plan

If issues arise, the changes are isolated to the logging module. Simply revert to the SDK-based approach by restoring the Cargo.toml dependencies and clickhouse.rs file.
