# Orb CLI Tool

## Overview

Create a TypeScript CLI tool (`orb`) for querying ClickHouse log data. Invokable via `tsx` with JSON output.

**Parallel execution:** This plan can be implemented independently of the Rust ClickHouse layer.

## Directory Structure

```
mortician/
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
  "@clickhouse/client": "^1.0.0"
}
```

## Implementation Steps

### Step 1: Create directory and types

1. Create `observability/orb/` directory
2. Implement `types.ts`:

```typescript
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  target: string;
  version: string;
  session_id: string;
  source?: string;
  task_id?: string;
  thread_id?: string;
  repo_name?: string;
  worktree_path?: string;
  duration_ms?: number;
  data?: string;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsed: number;
}
```

### Step 2: Environment loading

Implement `env.ts`:
- Load from `.env` files (current dir, then parents)
- Support `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_HOST`, `CLICKHOUSE_LOG_TABLE`
- Merge with actual environment variables

### Step 3: Query engine

Implement `query.ts`:
- Connect to ClickHouse with TLS
- Execute SQL queries
- Format results as JSON (omit empty/zero values)
- Handle errors gracefully
- Support query timeout

### Step 4: Commands

Implement `commands.ts`:
- `query "<SQL>"` - Execute SQL and return JSON
- `list` - List all tables
- `help` - Show usage

### Step 5: CLI entry point

Implement `index.ts`:
- Parse CLI arguments
- Route to appropriate command handler
- Handle `--help`, `--version`
- Default table from `CLICKHOUSE_LOG_TABLE` env var

### Step 6: Integration

1. Add npm script to `package.json`:
```json
{
  "scripts": {
    "orb": "tsx observability/orb/index.ts"
  }
}
```

2. Create `.env.example` with required environment variables

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

## Log Schema Reference

| Field | Type | Description |
|-------|------|-------------|
| timestamp | DateTime64(3) | Event time (ms precision) |
| level | LowCardinality(String) | debug, info, warn, error |
| message | String | Event message |
| target | LowCardinality(String) | Rust module |
| version | String | App version |
| session_id | String | UUID per app start |
| source | Nullable(LowCardinality(String)) | Window source |
| task_id | Nullable(String) | Task ID |
| thread_id | Nullable(String) | Agent thread ID |
| repo_name | Nullable(String) | Repository name |
| worktree_path | Nullable(String) | Git worktree path |
| duration_ms | Nullable(Int64) | Operation duration |
| data | Nullable(String) | JSON blob for extras |
