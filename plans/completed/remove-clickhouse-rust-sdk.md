# Remove ClickHouse Rust SDK - Route Logs Through Backend Server

## Problem

The `clickhouse` Rust crate with `native-tls` feature adds **217 transitive dependencies** to the build, significantly increasing compile times. The heavy dependencies include:

- Full TLS/crypto stack (native-tls, OpenSSL bindings)
- HTTP client stack (hyper, http, http-body)
- Async runtime extras (tokio features)

This makes the Rust build very resource-intensive.

Additionally, having the client talk directly to ClickHouse:
- Exposes ClickHouse credentials in the client
- Makes it harder to add server-side validation, rate limiting, or transformations
- Couples the client to the database implementation

## Current State

- **Rust side** (`src-tauri/src/logging/clickhouse.rs`): Uses `clickhouse` crate to **send logs** directly to ClickHouse via native protocol
- **Node.js side** (`observability/orb/`): Uses `@clickhouse/client` to **query logs** for the orb CLI

## Solution

1. **Create a Fastify (Node.js) backend server** that receives logs via HTTP POST and forwards them to ClickHouse
2. **Replace the `clickhouse` Rust crate** with simple HTTP POST requests to our backend server using `ureq` (lightweight sync HTTP client)

This approach:
- Removes 217 transitive dependencies from the Rust build
- Keeps ClickHouse credentials server-side only
- Allows future server-side processing (filtering, enrichment, rate limiting)
- Decouples the client from the database implementation

## Implementation Steps

### 1. Create Fastify Backend Server

Create a general-purpose backend server in `server/` at the project root. This will serve as the backend for the application, starting with log ingestion but extensible for other endpoints.

**`server/src/index.ts`**:

```typescript
import Fastify from 'fastify';
import { createClient } from '@clickhouse/client';

const fastify = Fastify({ logger: true });

// ClickHouse connection (credentials stay server-side)
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
});

const TABLE = process.env.CLICKHOUSE_TABLE ?? 'logs';

interface LogRow {
  timestamp: number; // milliseconds since epoch
  level: string;
  message: string;
  target: string;
  version: string;
  session_id: string;
  app_suffix: string;
  source?: string;
  task_id?: string;
  thread_id?: string;
  repo_name?: string;
  worktree_path?: string;
  duration_ms?: number;
  data?: string; // JSON blob
}

interface LogBatch {
  logs: LogRow[];
}

fastify.post<{ Body: LogBatch }>('/logs', async (request, reply) => {
  const { logs } = request.body;

  if (!logs || logs.length === 0) {
    return { status: 'ok', inserted: 0 };
  }

  try {
    await clickhouse.insert({
      table: TABLE,
      values: logs,
      format: 'JSONEachRow',
    });

    return { status: 'ok', inserted: logs.length };
  } catch (error) {
    request.log.error(error);
    reply.status(500);
    return { status: 'error', message: String(error) };
  }
});

fastify.get('/health', async () => {
  return { status: 'healthy' };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
```

**`server/package.json`**:

```json
{
  "name": "mort-server",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@clickhouse/client": "^1.0.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 2. Remove heavy dependencies from Cargo.toml

```toml
# REMOVE these lines:
clickhouse = { version = "0.14", features = ["native-tls"] }
tokio = { version = "1", features = ["sync", "time", "rt"] }

# ADD (if not already present via Tauri):
ureq = { version = "2", features = ["json", "tls"] }
```

### 3. Update config to point to backend server

Update `ClickHouseConfig` to become `LogServerConfig`:

```rust
// In src-tauri/src/logging/config.rs
pub struct LogServerConfig {
    pub url: String,  // e.g., "http://localhost:3000/logs"
}
```

### 4. Rewrite `src-tauri/src/logging/clickhouse.rs` → `log_server.rs`

Replace the SDK-based implementation with HTTP POST to your backend:

```rust
use serde::Serialize;
use std::sync::mpsc;
use std::time::Duration;

// LogRow struct stays the same (remove #[derive(Row)])
#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp: i64,
    pub level: String,
    pub message: String,
    pub target: String,
    pub version: String,
    pub session_id: String,
    pub app_suffix: String,
    pub source: Option<String>,
    pub task_id: Option<String>,
    pub thread_id: Option<String>,
    pub repo_name: Option<String>,
    pub worktree_path: Option<String>,
    pub duration_ms: Option<i64>,
    pub data: Option<String>,
}

#[derive(Serialize)]
struct LogBatch {
    logs: Vec<LogRow>,
}

const BATCH_SIZE: usize = 100;
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Background worker using ureq (sync HTTP client)
fn batch_worker(receiver: mpsc::Receiver<LogRow>, config: LogServerConfig) {
    let mut batch: Vec<LogRow> = Vec::with_capacity(BATCH_SIZE);

    loop {
        let deadline = std::time::Instant::now() + FLUSH_INTERVAL;

        while batch.len() < BATCH_SIZE {
            match receiver.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
                Ok(row) => batch.push(row),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !batch.is_empty() {
                        let _ = flush_batch(&config.url, &mut batch);
                    }
                    return;
                }
            }
        }

        if !batch.is_empty() {
            let _ = flush_batch(&config.url, &mut batch);
        }
    }
}

fn flush_batch(url: &str, batch: &mut Vec<LogRow>) -> Result<(), Box<dyn std::error::Error>> {
    if batch.is_empty() {
        return Ok(());
    }

    let payload = LogBatch {
        logs: batch.drain(..).collect(),
    };

    ureq::post(url)
        .set("Content-Type", "application/json")
        .send_json(&payload)?;

    Ok(())
}
```

### 5. Update the layer to use std::sync::mpsc

Since we're removing tokio, switch to standard library channels:

```rust
use std::sync::mpsc;

pub struct LogServerLayer {
    sender: mpsc::Sender<LogRow>,
}

impl LogServerLayer {
    pub fn new(config: LogServerConfig) -> Self {
        let (sender, receiver) = mpsc::channel::<LogRow>();

        std::thread::Builder::new()
            .name("log-server-client".into())
            .spawn(move || {
                batch_worker(receiver, config);
            })
            .expect("Failed to spawn log server client thread");

        Self { sender }
    }
}
```

### 6. Update the Layer impl to use sync send

```rust
impl<S> Layer<S> for LogServerLayer
where
    S: tracing::Subscriber,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: tracing_subscriber::layer::Context<'_, S>) {
        // ... build LogRow same as before ...

        // Non-blocking send - drop if channel full
        let _ = self.sender.send(row);
    }
}
```

## Files to Modify/Create

### New Files (Backend Server)
1. `server/src/index.ts` - Fastify server (general-purpose backend)
2. `server/package.json` - Node.js dependencies
3. `server/tsconfig.json` - TypeScript config
4. `server/src/routes/logs.ts` (optional) - Move log routes here as server grows

### Modified Files (Rust Client)
1. `src-tauri/Cargo.toml` - Remove `clickhouse` and `tokio`, add `ureq` if needed
2. `src-tauri/src/logging/clickhouse.rs` → rename to `log_server.rs` - Rewrite to POST to backend
3. `src-tauri/src/logging/config.rs` - Update config struct
4. `src-tauri/src/logging/mod.rs` - Update imports/exports

## Expected Build Time Improvement

Removing 217 transitive dependencies from `clickhouse` crate should significantly reduce:
- Initial build time
- Incremental build time when touching logging code
- Memory usage during compilation

## Deployment Considerations

The Fastify server needs to be deployed and accessible to clients:

1. **Development**: Run locally with `cd server && pnpm dev`
2. **Production**: Deploy behind a reverse proxy (nginx, Caddy) with:
   - Rate limiting per session_id
   - Request size limits
   - HTTPS termination

Environment variables for the server:
```bash
CLICKHOUSE_URL=http://your-clickhouse-host:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your-password
CLICKHOUSE_DATABASE=default
CLICKHOUSE_TABLE=logs
PORT=3000
```

## Alternative: Use reqwest

If `reqwest` is already in the dependency tree (via Tauri or other deps), use it instead of adding `ureq`:

```rust
use reqwest::blocking::Client;

let client = Client::new();
client.post(&config.url)
    .json(&payload)
    .send()?;
```

## Rollback Plan

If issues arise:
1. **Backend**: The Fastify server is independent - can be reverted without client changes
2. **Client**: Revert to the SDK-based approach by restoring Cargo.toml dependencies and clickhouse.rs file

## Future Enhancements

With a backend server in place, we can easily add:
- Rate limiting per session/client
- Log filtering (drop noisy logs server-side)
- Log enrichment (add server timestamp, geo info)
- Multiple storage backends (S3, local files for debug)
- Authentication/authorization for log submission
