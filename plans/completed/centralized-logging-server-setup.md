# Centralized Logging Server Setup

## Overview

This plan documents the log buffering architecture and provides a checklist for ensuring centralized logs are properly wired up to send to the server. It also includes proposed simplifications to the current implementation.

## Current Architecture

```
Rust Application (Tauri)
    ↓
[Tracing Framework]
    ├→ Console Output (colored, human-readable)
    ├→ JSON File (logs/structured.jsonl)
    ├→ In-Memory Buffer (frontend display, 1000 entries max)
    └→ LogServerLayer (optional, if LOG_SERVER_URL is set)
        ↓
Node.js Backend Server (Fastify)
    ↓
ClickHouse (centralized database)
```

## Buffering Configuration (Rust Side)

Location: `src-tauri/src/logging/log_server.rs`

| Setting | Value | Description |
|---------|-------|-------------|
| BATCH_SIZE | 100 | Logs per batch before flush |
| FLUSH_INTERVAL | 5 seconds | Max time between flushes |
| MAX_BUFFER_SIZE | 5,000 | Max logs retained during server outages |
| MAX_RETRIES | 3 | Retry attempts with exponential backoff |
| INITIAL_RETRY_DELAY | 100ms | Starting delay for retries |
| MAX_RETRY_DELAY | 5 seconds | Cap on backoff delay |

### How It Works (Simplified Design)

1. Logs are sent via a non-blocking `mpsc` channel to a dedicated background worker thread
2. Worker accumulates logs into a single buffer (up to 5,000 entries max)
3. Attempts flush when buffer reaches 100 entries OR every 5 seconds
4. On successful flush, buffer is cleared
5. On failed flush, buffer is retained and retry attempted with exponential backoff
6. If buffer reaches max size, oldest logs are dropped
7. On shutdown, remaining logs are flushed before exit

**Key simplification**: Single buffer instead of separate batch + retry buffer. The buffer only drains on successful flush, naturally handling retries without a secondary data structure.

## Environment Variables

### Client-Side (Tauri App)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_SERVER_URL` | No | None | Full URL to log endpoint (e.g., `http://localhost:3000/logs`). If set, enables log server transport. |

**Simplification**: Removed `LOG_SERVER_ENABLED` - the presence of `LOG_SERVER_URL` is sufficient to enable the feature.

Configuration loaded in: `src-tauri/src/logging/config.rs`

### Server-Side (Node.js Backend)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLICKHOUSE_URL` | No | `http://localhost:8123` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USER` | No | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | No | (empty) | ClickHouse password |
| `CLICKHOUSE_DATABASE` | No | `default` | Target database |
| `CLICKHOUSE_TABLE` | No | `logs` | Target table name |
| `PORT` | No | `3000` | Server listen port |

Configuration used in: `server/src/index.ts`

## Log Schema

TypeScript/Zod schema (must match ClickHouse table):

```typescript
const LogRowSchema = z.object({
  timestamp: z.number(),  // DateTime64(3) as milliseconds since epoch
  level: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]),
  message: z.string(),
});
```

## Setup Checklist

### 1. ClickHouse Database Setup

Create the logs table in ClickHouse:

```sql
CREATE TABLE IF NOT EXISTS logs (
    timestamp DateTime64(3),
    level Enum8('TRACE' = 0, 'DEBUG' = 1, 'INFO' = 2, 'WARN' = 3, 'ERROR' = 4),
    message String
) ENGINE = MergeTree()
ORDER BY timestamp;
```

### 2. Server Deployment

Ensure the Node.js server is running with proper environment variables:

```bash
# Example .env for server
CLICKHOUSE_URL=https://your-clickhouse-host:8443
CLICKHOUSE_USER=your_user
CLICKHOUSE_PASSWORD=your_password
CLICKHOUSE_DATABASE=your_database
CLICKHOUSE_TABLE=logs
PORT=3000
```

### 3. Client Configuration

Set environment variables for the Tauri app:

```bash
# Development
LOG_SERVER_URL=http://localhost:3000/logs

# Production
LOG_SERVER_URL=https://your-server.com/logs
```

### 4. Verification Steps

1. **Server Health Check**:
   ```bash
   curl http://localhost:3000/health
   # Should return: {"status":"ok","rows":<count>}
   ```

2. **Manual Log Send**:
   ```bash
   curl -X POST http://localhost:3000/logs \
     -H "Content-Type: application/json" \
     -d '{"logs":[{"timestamp":1705000000000,"level":"INFO","message":"Test log"}]}'
   # Should return: {"status":"ok","inserted":1}
   ```

3. **Check ClickHouse**:
   ```sql
   SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10;
   ```

## Files Reference

| File | Purpose |
|------|---------|
| `src-tauri/src/logging/mod.rs` | Main logging initialization |
| `src-tauri/src/logging/config.rs` | Environment variable parsing |
| `src-tauri/src/logging/log_server.rs` | Buffering and server transport |
| `server/src/index.ts` | Backend server with `/logs` endpoint |
| `core/types/logs.ts` | Shared log schema definitions |
| `observability/orb/env.ts` | Server environment config |

## Implementation Changes Required

### 1. Simplify `config.rs` - Remove `LOG_SERVER_ENABLED`

```rust
// Before
pub fn from_env() -> Option<Self> {
    let enabled = std::env::var("LOG_SERVER_ENABLED")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if !enabled {
        return None;
    }

    let url = std::env::var("LOG_SERVER_URL").ok()?;
    // ...
}

// After
pub fn from_env() -> Option<Self> {
    let url = std::env::var("LOG_SERVER_URL").ok()?;

    // Validate URL format
    if !url.starts_with("http://") && !url.starts_with("https://") {
        eprintln!(
            "Warning: LOG_SERVER_URL should include protocol (http:// or https://). Got: {}",
            url
        );
    }

    Some(Self { url })
}
```

### 2. Simplify `log_server.rs` - Single Buffer Design

Replace the dual-buffer approach with a single accumulating buffer:

```rust
fn batch_worker(receiver: mpsc::Receiver<LogRow>, config: LogServerConfig) {
    let mut buffer: Vec<LogRow> = Vec::with_capacity(MAX_BUFFER_SIZE);
    let mut last_flush_attempt = Instant::now();

    loop {
        let timeout = FLUSH_INTERVAL.saturating_sub(last_flush_attempt.elapsed());

        match receiver.recv_timeout(timeout) {
            Ok(row) => {
                // Drop oldest if at capacity
                if buffer.len() >= MAX_BUFFER_SIZE {
                    buffer.remove(0);
                }
                buffer.push(row);

                // Flush if batch size reached
                if buffer.len() >= BATCH_SIZE {
                    try_flush(&config.url, &mut buffer);
                    last_flush_attempt = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !buffer.is_empty() {
                    try_flush(&config.url, &mut buffer);
                    last_flush_attempt = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Final flush on shutdown
                let _ = flush_batch(&config.url, &mut buffer);
                break;
            }
        }
    }
}

fn try_flush(url: &str, buffer: &mut Vec<LogRow>) {
    let mut delay = INITIAL_RETRY_DELAY;

    for attempt in 0..MAX_RETRIES {
        // Clone the buffer contents for the attempt
        let batch: Vec<LogRow> = buffer.clone();

        match send_batch(url, &batch) {
            Ok(()) => {
                buffer.clear(); // Only clear on success
                return;
            }
            Err(e) => {
                if attempt < MAX_RETRIES - 1 {
                    eprintln!(
                        "Log server flush attempt {} failed: {}. Retrying in {:?}...",
                        attempt + 1, e, delay
                    );
                    std::thread::sleep(delay);
                    delay = (delay * 2).min(MAX_RETRY_DELAY);
                }
            }
        }
    }

    // All retries failed - buffer is retained for next attempt
    eprintln!("Log server temporarily unavailable. {} logs buffered.", buffer.len());
}
```

### 3. Update Tests

Update tests in `config.rs` to remove `LOG_SERVER_ENABLED` references.

## Troubleshooting

### Logs not appearing in ClickHouse

1. Verify `LOG_SERVER_URL` is set and correct
2. Check server logs for connection errors
3. Verify ClickHouse credentials are correct on the server

### High memory usage

- If the server is down, the buffer can grow to 5,000 entries
- Once buffer is full, oldest logs are dropped
- Check server availability and network connectivity

### Logs being dropped

- The channel is non-blocking; if full, logs are dropped
- Increase channel capacity if needed (currently uses default `mpsc::channel()`)
- Check if server is responding slowly

## Production Considerations

1. **TLS/HTTPS**: Ensure `LOG_SERVER_URL` uses HTTPS in production
2. **Authentication**: Consider adding API key authentication to `/logs` endpoint
3. **Rate Limiting**: Add rate limiting to prevent DoS
4. **Log Retention**: Configure ClickHouse TTL for automatic log expiration:
   ```sql
   ALTER TABLE logs MODIFY TTL timestamp + INTERVAL 30 DAY;
   ```
5. **Monitoring**: Set up alerts for server health endpoint
