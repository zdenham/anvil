# Observability CLI Plans

This folder contains sub-plans for the observability CLI implementation, optimized for parallel execution.

## Plans

| Plan | Description | Language | Dependencies |
|------|-------------|----------|--------------|
| [01-orb-cli-tool.md](./01-orb-cli-tool.md) | TypeScript CLI for querying ClickHouse | TypeScript | `@clickhouse/client` |
| [02-rust-clickhouse-layer.md](./02-rust-clickhouse-layer.md) | Rust tracing layer for log upload | Rust | `clickhouse` crate |

## Parallel Execution

These plans have **no blocking dependencies** between them and can be executed in parallel:

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│   01-orb-cli-tool.md        │     │ 02-rust-clickhouse-layer.md │
│   (TypeScript)              │     │ (Rust)                      │
│                             │     │                             │
│   Queries ClickHouse ───────┼─────┼──► Writes to ClickHouse     │
└─────────────────────────────┘     └─────────────────────────────┘
              │                                   │
              └───────────────┬───────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   ClickHouse    │
                    │   (external)    │
                    └─────────────────┘
```

Both plans require a ClickHouse instance but do not depend on each other.

## Shared Configuration

Both components use the same environment variables:
- `CLICKHOUSE_HOST`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_LOG_TABLE`

## Execution Order

1. Create the ClickHouse table using the DDL in either plan
2. Execute both plans in parallel
3. Test integration: Rust app logs → ClickHouse → orb queries
