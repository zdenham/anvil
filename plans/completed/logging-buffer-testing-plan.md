# Logging Buffer Infrastructure: Findings & Testing Plan

## Findings

### 1. ClickHouse Server URL Configuration

**No "vit_" prefix is required.** The system uses straightforward environment variable names:

| Layer | Environment Variable | Description | Default |
|-------|---------------------|-------------|---------|
| Client (Rust) | `LOG_SERVER_URL` | Full URL to log endpoint | None (disabled) |
| Server | `CLICKHOUSE_URL` | ClickHouse HTTP endpoint | `http://localhost:8123` |
| Server | `CLICKHOUSE_USER` | ClickHouse username | `default` |
| Server | `CLICKHOUSE_PASSWORD` | ClickHouse password | (empty) |
| Server | `CLICKHOUSE_DATABASE` | ClickHouse database | `default` |
| Server | `CLICKHOUSE_TABLE` | ClickHouse table | `logs` |
| Server | `PORT` | Server listen port | `3000` |

**The URL is accessible** as long as:
- `LOG_SERVER_URL` starts with `http://` or `https://`
- The server at that URL is reachable and accepts POST requests to `/logs`

### 2. Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tauri App (Rust Client)                     │
├─────────────────────────────────────────────────────────────────┤
│  tracing::info!("message")                                      │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LogServerLayer (log_server.rs)              │   │
│  │  - Captures tracing events                               │   │
│  │  - Non-blocking mpsc::send()                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         ▼ (mpsc channel)                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Background Worker Thread                    │   │
│  │  - Buffer: Vec<LogRow>, capacity 5,000                   │   │
│  │  - Flush triggers:                                       │   │
│  │    • 100 logs accumulated (BATCH_SIZE)                   │   │
│  │    • 5 seconds elapsed (FLUSH_INTERVAL)                  │   │
│  │  - Retry: 3 attempts, exponential backoff 100ms→5s       │   │
│  │  - Overflow: FIFO drop (oldest logs removed)             │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         ▼ HTTP POST (ureq)                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Node.js Server (Fastify)                      │
├─────────────────────────────────────────────────────────────────┤
│  POST /logs                                                     │
│  - Validates with Zod (LogBatchSchema)                          │
│  - Inserts to ClickHouse via @clickhouse/client                 │
│  - Verifies written_rows == logs.length                         │
├─────────────────────────────────────────────────────────────────┤
│  GET /health                                                    │
│  - SELECT 1 as ok, count(*) from logs                           │
│  - Returns {status, clickhouse, table_rows}                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ClickHouse                               │
│  CREATE TABLE logs (                                            │
│    timestamp DateTime64(3),                                     │
│    level LowCardinality(String),                                │
│    message String                                               │
│  ) ENGINE = MergeTree() ORDER BY timestamp                      │
│    TTL timestamp + INTERVAL 30 DAY                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Buffer Configuration Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `BATCH_SIZE` | 100 | Flush when this many logs accumulate |
| `FLUSH_INTERVAL` | 5 seconds | Flush at least this often |
| `MAX_BUFFER_SIZE` | 5,000 | Prevents unbounded memory growth |
| `MAX_RETRIES` | 3 | Retry attempts before giving up |
| `INITIAL_RETRY_DELAY` | 100ms | First retry delay |
| `MAX_RETRY_DELAY` | 5 seconds | Maximum retry delay (exponential backoff) |

### 4. Data Schema (LogRow)

```rust
// Rust (client)
pub struct LogRow {
    pub timestamp: i64,    // milliseconds since epoch
    pub level: String,     // TRACE, DEBUG, INFO, WARN, ERROR
    pub message: String,
}
```

### 5. Existing Tests

**Rust (src-tauri/src/logging/)**:
- `config.rs`: Tests for environment variable loading
- `log_server.rs`: Tests for LogRow/LogBatch serialization

**No integration tests exist** for the full buffer → server pipeline.

---

## Testing Implementation Plan

### Phase 1: Rust Buffer Logic Unit Tests

Add comprehensive tests for the buffer behavior without requiring HTTP calls.

#### 1.1 Refactor for Testability

Extract buffer logic into testable functions:

**File: `src-tauri/src/logging/buffer.rs`** (new file)

```rust
use super::log_server::LogRow;

/// Buffer behavior that can be tested in isolation
pub struct LogBuffer {
    buffer: Vec<LogRow>,
    max_size: usize,
    batch_size: usize,
}

impl LogBuffer {
    pub fn new(max_size: usize, batch_size: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(max_size),
            max_size,
            batch_size,
        }
    }

    /// Add a log, dropping oldest if at capacity.
    /// Returns the dropped log if one was removed.
    pub fn push(&mut self, row: LogRow) -> Option<LogRow> {
        let dropped = if self.buffer.len() >= self.max_size {
            Some(self.buffer.remove(0))
        } else {
            None
        };
        self.buffer.push(row);
        dropped
    }

    /// Check if ready to flush (reached batch size)
    pub fn should_flush(&self) -> bool {
        self.buffer.len() >= self.batch_size
    }

    /// Drain buffer contents, returning owned Vec
    pub fn drain(&mut self) -> Vec<LogRow> {
        std::mem::take(&mut self.buffer)
    }

    /// Clone buffer contents without draining
    pub fn clone_contents(&self) -> Vec<LogRow> {
        self.buffer.clone()
    }

    /// Clear buffer (call after successful flush)
    pub fn clear(&mut self) {
        self.buffer.clear();
    }

    /// Get current size
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_log(index: i64) -> LogRow {
        LogRow {
            timestamp: 1000 + index,
            level: "INFO".to_string(),
            message: format!("Test message {}", index),
        }
    }

    #[test]
    fn test_buffer_accumulates_logs() {
        let mut buffer = LogBuffer::new(100, 10);
        for i in 0..5 {
            buffer.push(make_test_log(i));
        }
        assert_eq!(buffer.len(), 5);
        assert!(!buffer.should_flush());
    }

    #[test]
    fn test_buffer_triggers_flush_at_batch_size() {
        let mut buffer = LogBuffer::new(100, 10);
        for i in 0..10 {
            buffer.push(make_test_log(i));
        }
        assert!(buffer.should_flush());
    }

    #[test]
    fn test_buffer_drops_oldest_at_capacity() {
        let mut buffer = LogBuffer::new(5, 10);
        for i in 0..7 {
            let dropped = buffer.push(make_test_log(i));
            if i >= 5 {
                assert!(dropped.is_some());
            } else {
                assert!(dropped.is_none());
            }
        }
        assert_eq!(buffer.len(), 5);
        // Verify oldest were dropped (0, 1 should be gone)
        let logs = buffer.drain();
        assert_eq!(logs[0].timestamp, 1002); // index 2
        assert_eq!(logs[4].timestamp, 1006); // index 6
    }

    #[test]
    fn test_drain_clears_buffer() {
        let mut buffer = LogBuffer::new(100, 10);
        buffer.push(make_test_log(0));
        buffer.push(make_test_log(1));
        let drained = buffer.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(buffer.len(), 0);
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_clone_contents_preserves_buffer() {
        let mut buffer = LogBuffer::new(100, 10);
        buffer.push(make_test_log(0));
        buffer.push(make_test_log(1));
        let cloned = buffer.clone_contents();
        assert_eq!(cloned.len(), 2);
        assert_eq!(buffer.len(), 2); // Still has contents
    }

    #[test]
    fn test_clear_empties_buffer() {
        let mut buffer = LogBuffer::new(100, 10);
        buffer.push(make_test_log(0));
        buffer.clear();
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_flush_threshold_boundary() {
        let mut buffer = LogBuffer::new(100, 10);
        for i in 0..9 {
            buffer.push(make_test_log(i));
        }
        assert!(!buffer.should_flush()); // 9 < 10
        buffer.push(make_test_log(9));
        assert!(buffer.should_flush()); // 10 >= 10
    }

    #[test]
    fn test_overflow_fifo_order() {
        let mut buffer = LogBuffer::new(3, 10);
        // Add 5 logs to a buffer of size 3
        for i in 0..5 {
            buffer.push(make_test_log(i));
        }
        // Should have logs 2, 3, 4 (oldest 0, 1 dropped)
        let logs = buffer.clone_contents();
        assert_eq!(logs.len(), 3);
        assert_eq!(logs[0].message, "Test message 2");
        assert_eq!(logs[1].message, "Test message 3");
        assert_eq!(logs[2].message, "Test message 4");
    }
}
```

### Phase 2: Integration Tests with Mock HTTP Server

Test the full Rust client behavior with a mock HTTP endpoint.

#### 2.1 Add Test Dependency

Add `tiny_http` as a dev dependency in `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tiny_http = "0.12"
```

#### 2.2 Mock HTTP Server for Rust Tests

**File: `src-tauri/src/logging/tests/integration.rs`**

```rust
#[cfg(test)]
mod integration_tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;
    use tiny_http::{Response, Server};

    use crate::logging::config::LogServerConfig;
    use crate::logging::log_server::{LogRow, LogServerLayer};

    /// Mock HTTP server that tracks received log batches
    struct MockLogServer {
        server: Arc<Server>,
        received_count: Arc<AtomicUsize>,
        should_fail: Arc<AtomicBool>,
        shutdown: Arc<AtomicBool>,
    }

    impl MockLogServer {
        fn new() -> Self {
            let server = Arc::new(Server::http("127.0.0.1:0").unwrap());
            let received_count = Arc::new(AtomicUsize::new(0));
            let should_fail = Arc::new(AtomicBool::new(false));
            let shutdown = Arc::new(AtomicBool::new(false));

            // Spawn handler thread
            let server_clone = Arc::clone(&server);
            let count_clone = Arc::clone(&received_count);
            let fail_clone = Arc::clone(&should_fail);
            let shutdown_clone = Arc::clone(&shutdown);

            thread::spawn(move || {
                while !shutdown_clone.load(Ordering::Relaxed) {
                    if let Ok(Some(request)) = server_clone.recv_timeout(Duration::from_millis(100))
                    {
                        if fail_clone.load(Ordering::Relaxed) {
                            let _ = request.respond(Response::from_string("error").with_status_code(500));
                        } else {
                            // Parse body to count logs
                            let mut body = String::new();
                            if let Ok(mut reader) = request.as_reader() {
                                let _ = std::io::Read::read_to_string(&mut reader, &mut body);
                            }

                            // Count logs in batch
                            if let Ok(batch) = serde_json::from_str::<serde_json::Value>(&body) {
                                if let Some(logs) = batch.get("logs").and_then(|l| l.as_array()) {
                                    count_clone.fetch_add(logs.len(), Ordering::Relaxed);
                                }
                            }

                            let response = r#"{"status":"ok","inserted":1}"#;
                            let _ = request.respond(Response::from_string(response));
                        }
                    }
                }
            });

            Self {
                server,
                received_count,
                should_fail,
                shutdown,
            }
        }

        fn url(&self) -> String {
            format!("http://{}/logs", self.server.server_addr())
        }

        fn received_log_count(&self) -> usize {
            self.received_count.load(Ordering::Relaxed)
        }

        fn set_should_fail(&self, fail: bool) {
            self.should_fail.store(fail, Ordering::Relaxed);
        }

        fn reset_count(&self) {
            self.received_count.store(0, Ordering::Relaxed);
        }
    }

    impl Drop for MockLogServer {
        fn drop(&mut self) {
            self.shutdown.store(true, Ordering::Relaxed);
        }
    }

    #[test]
    fn test_logs_are_batched_and_sent() {
        let mock = MockLogServer::new();
        let config = LogServerConfig { url: mock.url() };
        let layer = LogServerLayer::new(config);

        // Send logs through the layer's sender (need to expose for testing)
        // This test verifies the HTTP transport works

        // Wait for potential flush
        thread::sleep(Duration::from_secs(6));

        // Verify mock received logs
        // Note: Actual implementation depends on how we expose the sender
    }

    #[test]
    fn test_retry_on_server_failure() {
        let mock = MockLogServer::new();
        mock.set_should_fail(true);

        let config = LogServerConfig { url: mock.url() };

        // Test that retries happen with exponential backoff
        // After MAX_RETRIES failures, logs should be retained in buffer
    }

    #[test]
    fn test_server_recovery_after_failure() {
        let mock = MockLogServer::new();
        mock.set_should_fail(true);

        let config = LogServerConfig { url: mock.url() };

        // Send some logs while server is "down"
        // Then recover the server
        mock.set_should_fail(false);

        // Wait for retry cycle
        thread::sleep(Duration::from_secs(10));

        // Verify buffered logs eventually get sent
    }
}
```

#### 2.3 Test Module Registration

**File: `src-tauri/src/logging/mod.rs`** (add test module)

```rust
pub mod buffer;
pub mod config;
pub mod log_server;

#[cfg(test)]
mod tests;
```

**File: `src-tauri/src/logging/tests/mod.rs`**

```rust
mod integration;
```

### Test Implementation Checklist

| Test Category | File Location | Tests |
|---------------|---------------|-------|
| **Rust Buffer** | `src-tauri/src/logging/buffer.rs` | Buffer accumulation, overflow, drain, FIFO order |
| **Rust Serialization** | `src-tauri/src/logging/log_server.rs` | Already exists ✓ |
| **Rust Config** | `src-tauri/src/logging/config.rs` | Already exists ✓ |
| **Rust HTTP Client** | `src-tauri/src/logging/tests/integration.rs` | Mock server integration, retry behavior |

---

## Test Data Factory

```rust
fn make_test_log(index: i64) -> LogRow {
    LogRow {
        timestamp: chrono::Utc::now().timestamp_millis() + index,
        level: "INFO".to_string(),
        message: format!("Test message {}", index),
    }
}
```

---

## Summary

**Findings:**
- No `vit_` prefix required - standard environment variable names work
- URL is accessible via `LOG_SERVER_URL` environment variable
- Current test coverage is limited to serialization and config loading

**Testing Strategy:**
- Extract buffer logic into `LogBuffer` struct for isolated unit tests
- Use `tiny_http` mock server for Rust integration tests
- Test retry behavior, FIFO overflow, and batch flushing
