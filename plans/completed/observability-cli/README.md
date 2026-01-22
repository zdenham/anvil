# Observability CLI Plans

This folder contains sub-plans for the observability CLI implementation, optimized for parallel execution.

## Plans

| Plan | Description | Language | Dependencies |
|------|-------------|----------|--------------|
| [01-orb-cli-tool.md](./01-orb-cli-tool.md) | TypeScript CLI for querying ClickHouse | TypeScript | `@clickhouse/client` |
| [02-rust-clickhouse-layer.md](./02-rust-clickhouse-layer.md) | Rust tracing layer for log upload | Rust | `clickhouse` crate |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Observability Pipeline                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────┐                       ┌─────────────────────┐     │
│   │   Rust Application  │                       │      orb CLI        │     │
│   │   (02-rust-layer)   │                       │   (01-orb-cli)      │     │
│   │                     │                       │                     │     │
│   │  tracing::info!()   │                       │  pnpm orb tail      │     │
│   │  tracing::warn!()   │                       │  pnpm orb search    │     │
│   │  tracing::error!()  │                       │  pnpm orb sessions  │     │
│   │         │           │                       │         ▲           │     │
│   │         ▼           │                       │         │           │     │
│   │  ClickHouseLayer    │                       │  @clickhouse/client │     │
│   └─────────┬───────────┘                       └─────────┬───────────┘     │
│             │                                             │                  │
│             │  WRITES (batched, async)                    │  READS (queries) │
│             │                                             │                  │
│             └──────────────────┬──────────────────────────┘                  │
│                                │                                             │
│                                ▼                                             │
│                    ┌───────────────────────┐                                 │
│                    │      ClickHouse       │                                 │
│                    │                       │                                 │
│                    │  logs table (shared)  │                                 │
│                    │  - timestamp          │                                 │
│                    │  - level              │                                 │
│                    │  - message            │                                 │
│                    │  - session_id         │                                 │
│                    │  - task_id            │                                 │
│                    │  - ...                │                                 │
│                    └───────────────────────┘                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Parallel Execution

These plans have **no blocking dependencies** between them and can be executed in parallel:

- **01-orb-cli-tool.md** (TypeScript) - Reads from ClickHouse
- **02-rust-clickhouse-layer.md** (Rust) - Writes to ClickHouse

Both plans require a ClickHouse instance but do not depend on each other for implementation.

## Shared Contract

Both components are bound by a shared contract to ensure seamless integration:

### 1. Environment Variables

| Variable | Required | Default | Used By |
|----------|----------|---------|---------|
| `CLICKHOUSE_ENABLED` | Rust only | `false` | Rust layer (enables upload) |
| `CLICKHOUSE_HOST` | Yes | - | Both |
| `CLICKHOUSE_USER` | Yes | - | Both |
| `CLICKHOUSE_PASSWORD` | Yes | - | Both |
| `CLICKHOUSE_DATABASE` | No | `default` | Both |
| `CLICKHOUSE_LOG_TABLE` | No | `logs` | Both |

### 2. Schema Definition

The table schema is defined identically in both plans. Any changes must be synchronized:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | DateTime64(3) | Event time (ms precision) |
| `level` | LowCardinality(String) | debug, info, warn, error |
| `message` | String | Event message |
| `target` | LowCardinality(String) | Rust module path |
| `version` | String | App version |
| `session_id` | String | UUID per app start |
| `app_suffix` | LowCardinality(String) | Build suffix (dev, prod) |
| `source` | Nullable(LowCardinality(String)) | Window source |
| `task_id` | Nullable(String) | Task ID |
| `thread_id` | Nullable(String) | Agent thread ID |
| `repo_name` | Nullable(String) | Repository name |
| `worktree_path` | Nullable(String) | Git worktree path |
| `duration_ms` | Nullable(Int64) | Operation duration |
| `data` | Nullable(String) | JSON blob for extras |

### 3. Type Mapping

| Rust (`LogRow`) | TypeScript (`LogEntry`) | ClickHouse |
|-----------------|-------------------------|------------|
| `i64` (timestamp) | `string` (ISO format) | `DateTime64(3)` |
| `String` | `string` | `String` |
| `Option<String>` | `string \| undefined` | `Nullable(String)` |
| `Option<i64>` | `number \| undefined` | `Nullable(Int64)` |

## Setup Instructions

### 1. Create the ClickHouse Table

Use either the DDL from the orb CLI (`pnpm orb init`) or run manually:

```sql
CREATE TABLE IF NOT EXISTS logs (
    timestamp DateTime64(3),
    level LowCardinality(String),
    message String,
    target LowCardinality(String),
    version String,
    session_id String,
    app_suffix LowCardinality(String),
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

### 2. Configure Environment

Add to `.env`:

```bash
# ClickHouse Configuration (shared between Rust layer and orb CLI)
CLICKHOUSE_ENABLED=true
CLICKHOUSE_HOST=https://your-host:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your-password
CLICKHOUSE_DATABASE=default
CLICKHOUSE_LOG_TABLE=logs
```

### 3. Implement Both Plans

Execute in parallel:
- Implement `01-orb-cli-tool.md` (TypeScript)
- Implement `02-rust-clickhouse-layer.md` (Rust)

## Integration Verification

After both components are implemented, verify end-to-end flow:

```bash
# 1. Verify orb can connect
pnpm orb check

# 2. Start the Rust app (generates logs)
pnpm dev

# 3. View logs via orb
pnpm orb tail

# 4. List sessions
pnpm orb sessions

# 5. Search for specific events
pnpm orb search "worktree"
```

## Resilience Features

### Rust Layer (Writer)
- **Batching:** 100 logs per batch, 5s flush interval
- **Buffering:** 10,000 log capacity in channel
- **Retry:** Exponential backoff (100ms → 5s)
- **Degradation:** Buffers 5,000 logs during outages, then drops oldest
- **Non-blocking:** Never impacts app performance

### orb CLI (Reader)
- **Connection reuse:** Single client instance per session
- **Error recovery:** Descriptive errors with actionable suggestions
- **Graceful cleanup:** Proper connection close on exit

## Future Enhancements (Out of Scope)

- Live tail with `--follow` flag (polling or WebSocket)
- Time range filters (`--since`, `--until`)
- Export to file formats (CSV, JSON lines)
- Metrics aggregation dashboards
- MCP tool integration for AI agents
