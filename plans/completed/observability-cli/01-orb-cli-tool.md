# Orb CLI Tool

## Overview

Create a TypeScript CLI tool (`orb`) for querying ClickHouse log data written by the Rust ClickHouse layer (`02-rust-clickhouse-layer.md`). Invokable via `tsx` with JSON output.

**Parallel execution:** This plan can be implemented independently of the Rust ClickHouse layer (they share the same schema and env vars).

**Integration point:** This CLI reads logs that the Rust layer writes. Both use identical env vars and schema.

## Directory Structure

```
anvil/
└── observability/
    └── orb/
        ├── index.ts          # Entry point, CLI argument parsing
        ├── commands.ts       # Command handlers (query, list, tail, sessions, etc.)
        ├── client.ts         # ClickHouse client wrapper with connection pooling
        ├── query.ts          # SQL execution and JSON result formatting
        ├── types.ts          # TypeScript interfaces (mirrors Rust LogRow)
        ├── env.ts            # Environment variable loading (shared with Rust)
        └── format.ts         # Output formatters (json, table, compact)
```

## Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "@clickhouse/client": "^1.0.0"
  }
}
```

Note: `tsx` is already in devDependencies.

## Shared Environment Variables

**CRITICAL:** These must match exactly with the Rust layer (`02-rust-clickhouse-layer.md`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLICKHOUSE_HOST` | Yes | - | ClickHouse server URL (e.g., `https://host:8443`) |
| `CLICKHOUSE_USER` | Yes | - | Username for authentication |
| `CLICKHOUSE_PASSWORD` | Yes | - | Password for authentication |
| `CLICKHOUSE_DATABASE` | No | `default` | Database name |
| `CLICKHOUSE_LOG_TABLE` | No | `logs` | Table name for logs |

Note: The orb CLI does NOT require `CLICKHOUSE_ENABLED` - that's Rust-only for enabling the upload layer.

## Implementation Steps

### Step 1: Create directory and types

1. Create `observability/orb/` directory
2. Implement `types.ts` - mirrors Rust `LogRow` struct exactly:

```typescript
/**
 * Log entry structure - MUST match Rust LogRow in logging/clickhouse.rs
 * Any schema changes must be synchronized between both implementations.
 */
export interface LogEntry {
  // Core fields (always present)
  timestamp: string;          // DateTime64(3) - ISO format with ms precision
  level: string;              // debug, info, warn, error
  message: string;            // Event message
  target: string;             // Rust module (e.g., "web", "worktree_commands")

  // Instance identification (always present)
  version: string;            // App version from Cargo.toml
  session_id: string;         // UUID generated on each app start

  // Source context (optional)
  source?: string;            // Window source (main, spotlight, task-panel)

  // Domain context (optional)
  task_id?: string;           // Task being operated on
  thread_id?: string;         // Agent thread ID
  repo_name?: string;         // Repository name
  worktree_path?: string;     // Git worktree path

  // Operation metrics (optional)
  duration_ms?: number;       // Operation duration in milliseconds

  // Extended data (optional)
  data?: string;              // JSON blob for extra fields
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  elapsed: number;            // Query execution time in ms
}

export interface ClickHouseConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  table: string;
}

export interface CommandContext {
  config: ClickHouseConfig;
  format: 'json' | 'table' | 'compact';
  verbose: boolean;
}
```

### Step 2: Environment loading

Implement `env.ts`:

```typescript
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { ClickHouseConfig } from './types';

/**
 * Find and load .env file, searching up from cwd.
 * Returns merged env vars (file values, then process.env overrides).
 */
function loadEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  let dir = process.cwd();

  while (dir !== dirname(dir)) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          env[key] = value;
        }
      }
      break; // Use first .env found
    }
    dir = dirname(dir);
  }

  return env;
}

/**
 * Load ClickHouse config from environment.
 * Throws descriptive errors for missing required variables.
 */
export function loadConfig(): ClickHouseConfig {
  const fileEnv = loadEnvFile();
  const get = (key: string): string | undefined =>
    process.env[key] ?? fileEnv[key];

  const host = get('CLICKHOUSE_HOST');
  const user = get('CLICKHOUSE_USER');
  const password = get('CLICKHOUSE_PASSWORD');

  // Collect all missing required vars for better error message
  const missing: string[] = [];
  if (!host) missing.push('CLICKHOUSE_HOST');
  if (!user) missing.push('CLICKHOUSE_USER');
  if (!password) missing.push('CLICKHOUSE_PASSWORD');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Set them in .env or export them in your shell.\n` +
      `Example:\n` +
      `  export CLICKHOUSE_HOST="https://your-host:8443"\n` +
      `  export CLICKHOUSE_USER="default"\n` +
      `  export CLICKHOUSE_PASSWORD="your-password"`
    );
  }

  return {
    host: host!,
    user: user!,
    password: password!,
    database: get('CLICKHOUSE_DATABASE') ?? 'default',
    table: get('CLICKHOUSE_LOG_TABLE') ?? 'logs',
  };
}
```

### Step 3: ClickHouse client wrapper

Implement `client.ts`:

```typescript
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { ClickHouseConfig } from './types';

let client: ClickHouseClient | null = null;

/**
 * Get or create a ClickHouse client instance.
 * Reuses connection for multiple queries in same session.
 */
export function getClient(config: ClickHouseConfig): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: config.host,
      username: config.user,
      password: config.password,
      database: config.database,
      request_timeout: 30_000,
      compression: {
        request: true,
        response: true,
      },
      // TLS is inferred from https:// URL
    });
  }
  return client;
}

/**
 * Close the client connection gracefully.
 */
export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/**
 * Test connection and return server info.
 */
export async function testConnection(config: ClickHouseConfig): Promise<{
  connected: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const c = getClient(config);
    const result = await c.query({ query: 'SELECT version()' });
    const data = await result.json<{ version: string }[]>();
    return { connected: true, version: data[0]?.version };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
```

### Step 4: Query engine

Implement `query.ts`:

```typescript
import { getClient } from './client';
import { ClickHouseConfig, QueryResult, LogEntry } from './types';

export interface QueryOptions {
  timeout?: number;           // Query timeout in ms (default: 30000)
  format?: 'json' | 'raw';    // Output format
}

/**
 * Execute a SQL query and return results.
 * Handles errors gracefully with descriptive messages.
 */
export async function executeQuery<T = Record<string, unknown>>(
  config: ClickHouseConfig,
  sql: string,
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  const client = getClient(config);
  const startTime = Date.now();

  try {
    const result = await client.query({
      query: sql,
      format: 'JSONEachRow',
    });

    const rows = await result.json<T[]>();
    const elapsed = Date.now() - startTime;

    return {
      rows,
      rowCount: rows.length,
      elapsed,
    };
  } catch (err) {
    // Enhance error messages for common issues
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('UNKNOWN_TABLE')) {
      throw new Error(
        `Table not found. Run 'pnpm orb check' to verify setup.\n` +
        `Original error: ${message}`
      );
    }
    if (message.includes('AUTHENTICATION')) {
      throw new Error(
        `Authentication failed. Check CLICKHOUSE_USER and CLICKHOUSE_PASSWORD.\n` +
        `Original error: ${message}`
      );
    }
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      throw new Error(
        `Cannot connect to ClickHouse at ${config.host}.\n` +
        `Check CLICKHOUSE_HOST and ensure the server is running.\n` +
        `Original error: ${message}`
      );
    }

    throw err;
  }
}

/**
 * Clean query results by removing null/undefined/empty values.
 * Makes JSON output more readable.
 */
export function cleanResults<T extends Record<string, unknown>>(
  rows: T[]
): T[] {
  return rows.map(row => {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = value;
      }
    }
    return cleaned as T;
  });
}
```

### Step 5: Output formatters

Implement `format.ts`:

```typescript
import { LogEntry, QueryResult } from './types';

export type OutputFormat = 'json' | 'table' | 'compact';

/**
 * Format query results for output.
 */
export function formatOutput<T>(
  result: QueryResult<T>,
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result.rows, null, 2);

    case 'table':
      return formatTable(result.rows as Record<string, unknown>[]);

    case 'compact':
      return formatCompact(result.rows as LogEntry[]);

    default:
      return JSON.stringify(result.rows, null, 2);
  }
}

/**
 * Format as ASCII table (for terminal display).
 */
function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '(no results)';

  const keys = Object.keys(rows[0]);
  const widths = keys.map(k =>
    Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length))
  );

  const header = keys.map((k, i) => k.padEnd(widths[i])).join(' | ');
  const separator = widths.map(w => '-'.repeat(w)).join('-+-');
  const body = rows.map(row =>
    keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join(' | ')
  ).join('\n');

  return `${header}\n${separator}\n${body}`;
}

/**
 * Format logs in compact single-line format (like tail -f).
 */
function formatCompact(logs: LogEntry[]): string {
  return logs.map(log => {
    const ts = new Date(log.timestamp).toISOString().slice(11, 23);
    const level = log.level.toUpperCase().padEnd(5);
    const target = log.target.slice(0, 20).padEnd(20);
    return `${ts} ${level} ${target} ${log.message}`;
  }).join('\n');
}

/**
 * Format metadata line (row count, elapsed time).
 */
export function formatMeta(result: QueryResult<unknown>): string {
  return `-- ${result.rowCount} rows (${result.elapsed}ms)`;
}
```

### Step 6: Commands

Implement `commands.ts`:

```typescript
import { CommandContext, LogEntry } from './types';
import { executeQuery, cleanResults } from './query';
import { testConnection, closeClient } from './client';
import { formatOutput, formatMeta, OutputFormat } from './format';

/**
 * Execute raw SQL query.
 */
export async function queryCommand(
  ctx: CommandContext,
  sql: string
): Promise<void> {
  const result = await executeQuery(ctx.config, sql);
  const cleaned = cleanResults(result.rows);

  console.log(formatOutput({ ...result, rows: cleaned }, ctx.format));
  if (ctx.verbose) {
    console.error(formatMeta(result));
  }
}

/**
 * List all tables in the database.
 */
export async function listCommand(ctx: CommandContext): Promise<void> {
  const sql = `SHOW TABLES FROM ${ctx.config.database}`;
  const result = await executeQuery<{ name: string }>(ctx.config, sql);

  console.log(formatOutput(result, ctx.format));
}

/**
 * Show recent logs (like tail).
 */
export async function tailCommand(
  ctx: CommandContext,
  options: { limit?: number; level?: string; session?: string }
): Promise<void> {
  const { limit = 50, level, session } = options;
  const table = ctx.config.table;

  const conditions: string[] = [];
  if (level) {
    conditions.push(`level = '${level}'`);
  }
  if (session) {
    conditions.push(`session_id = '${session}'`);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const sql = `
    SELECT * FROM ${table}
    ${where}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  const result = await executeQuery<LogEntry>(ctx.config, sql);
  // Reverse to show oldest first (chronological)
  result.rows.reverse();

  const cleaned = cleanResults(result.rows);
  console.log(formatOutput({ ...result, rows: cleaned }, ctx.format));
}

/**
 * List unique sessions with metadata.
 */
export async function sessionsCommand(
  ctx: CommandContext,
  options: { limit?: number }
): Promise<void> {
  const { limit = 20 } = options;
  const table = ctx.config.table;

  const sql = `
    SELECT
      session_id,
      min(timestamp) as started,
      max(timestamp) as last_seen,
      any(version) as version,
      count() as log_count
    FROM ${table}
    GROUP BY session_id
    ORDER BY started DESC
    LIMIT ${limit}
  `;

  const result = await executeQuery(ctx.config, sql);
  console.log(formatOutput(result, ctx.format));
}

/**
 * Show log level distribution for a session or overall.
 */
export async function statsCommand(
  ctx: CommandContext,
  options: { session?: string }
): Promise<void> {
  const { session } = options;
  const table = ctx.config.table;

  const where = session ? `WHERE session_id = '${session}'` : '';

  const sql = `
    SELECT
      level,
      count() as count,
      round(count() * 100.0 / sum(count()) OVER (), 2) as percent
    FROM ${table}
    ${where}
    GROUP BY level
    ORDER BY count DESC
  `;

  const result = await executeQuery(ctx.config, sql);
  console.log(formatOutput(result, ctx.format));
}

/**
 * Search logs by message content.
 */
export async function searchCommand(
  ctx: CommandContext,
  pattern: string,
  options: { limit?: number; level?: string }
): Promise<void> {
  const { limit = 100, level } = options;
  const table = ctx.config.table;

  const conditions: string[] = [`message ILIKE '%${pattern}%'`];
  if (level) {
    conditions.push(`level = '${level}'`);
  }

  const sql = `
    SELECT * FROM ${table}
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  const result = await executeQuery<LogEntry>(ctx.config, sql);
  const cleaned = cleanResults(result.rows);
  console.log(formatOutput({ ...result, rows: cleaned }, ctx.format));
}

/**
 * Check connection and table existence.
 */
export async function checkCommand(ctx: CommandContext): Promise<void> {
  console.log('Checking ClickHouse connection...\n');

  // Test connection
  const connResult = await testConnection(ctx.config);
  if (!connResult.connected) {
    console.error(`Connection FAILED: ${connResult.error}`);
    process.exit(1);
  }
  console.log(`Connection: OK (ClickHouse ${connResult.version})`);
  console.log(`Host: ${ctx.config.host}`);
  console.log(`Database: ${ctx.config.database}`);

  // Check table exists
  try {
    const sql = `SELECT count() as count FROM ${ctx.config.table} LIMIT 1`;
    const result = await executeQuery<{ count: number }>(ctx.config, sql);
    console.log(`Table '${ctx.config.table}': OK (${result.rows[0]?.count ?? 0} total rows)`);
  } catch (err) {
    console.error(`Table '${ctx.config.table}': NOT FOUND`);
    console.error(`\nCreate the table with:\n`);
    console.error(`  pnpm orb init\n`);
    process.exit(1);
  }

  console.log('\nAll checks passed!');
}

/**
 * Initialize the logs table (create if not exists).
 */
export async function initCommand(ctx: CommandContext): Promise<void> {
  const table = ctx.config.table;

  // DDL must match Rust layer exactly
  const ddl = `
    CREATE TABLE IF NOT EXISTS ${table} (
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
    TTL timestamp + INTERVAL 30 DAY
  `;

  await executeQuery(ctx.config, ddl);
  console.log(`Table '${table}' created successfully.`);
}

/**
 * Show schema of the logs table.
 */
export async function schemaCommand(ctx: CommandContext): Promise<void> {
  const sql = `DESCRIBE TABLE ${ctx.config.table}`;
  const result = await executeQuery(ctx.config, sql);
  console.log(formatOutput(result, ctx.format));
}

/**
 * Show help text.
 */
export function helpCommand(): void {
  console.log(`
orb - ClickHouse log query tool for anvil

USAGE:
  pnpm orb <command> [options]
  pnpm orb "<SQL query>"

COMMANDS:
  query <SQL>       Execute SQL query (or just pass SQL directly)
  tail              Show recent logs (default: 50)
  sessions          List unique sessions with metadata
  search <pattern>  Search logs by message content
  stats             Show log level distribution
  list              List all tables
  schema            Show logs table schema
  check             Verify connection and table setup
  init              Create the logs table
  help              Show this help

OPTIONS:
  --format, -f      Output format: json (default), table, compact
  --limit, -n       Number of results (default varies by command)
  --level, -l       Filter by log level (debug, info, warn, error)
  --session, -s     Filter by session_id
  --verbose, -v     Show query metadata (row count, timing)

EXAMPLES:
  pnpm orb tail                          # Recent 50 logs
  pnpm orb tail -n 100 -l error          # Recent 100 errors
  pnpm orb sessions                      # List sessions
  pnpm orb search "worktree" -l warn     # Search warnings
  pnpm orb stats -s abc123               # Stats for session
  pnpm orb "SELECT count() FROM logs"    # Direct SQL
  pnpm orb check                         # Verify setup

ENVIRONMENT:
  CLICKHOUSE_HOST       ClickHouse server URL (required)
  CLICKHOUSE_USER       Username (required)
  CLICKHOUSE_PASSWORD   Password (required)
  CLICKHOUSE_DATABASE   Database name (default: default)
  CLICKHOUSE_LOG_TABLE  Table name (default: logs)

See plans/observability-cli/ for full documentation.
`);
}
```

### Step 7: CLI entry point

Implement `index.ts`:

```typescript
#!/usr/bin/env node
import { loadConfig } from './env';
import { closeClient } from './client';
import {
  queryCommand,
  listCommand,
  tailCommand,
  sessionsCommand,
  statsCommand,
  searchCommand,
  checkCommand,
  initCommand,
  schemaCommand,
  helpCommand,
} from './commands';
import { CommandContext } from './types';
import { OutputFormat } from './format';

async function main() {
  const args = process.argv.slice(2);

  // Handle --help and --version before loading config
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    helpCommand();
    return;
  }

  if (args.includes('--version')) {
    console.log('orb 0.1.0');
    return;
  }

  // Parse global options
  let format: OutputFormat = 'json';
  let verbose = false;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' || arg === '-f') {
      format = (args[++i] as OutputFormat) ?? 'json';
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  // Load config (may throw with helpful error)
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const ctx: CommandContext = { config, format, verbose };

  try {
    await runCommand(ctx, filteredArgs);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await closeClient();
  }
}

async function runCommand(ctx: CommandContext, args: string[]) {
  const [command, ...rest] = args;

  // Parse command-specific options
  const options: Record<string, string | number | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--limit' || arg === '-n') {
      options.limit = parseInt(rest[++i], 10);
    } else if (arg === '--level' || arg === '-l') {
      options.level = rest[++i];
    } else if (arg === '--session' || arg === '-s') {
      options.session = rest[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // Route to command handlers
  switch (command) {
    case 'query':
      await queryCommand(ctx, positional.join(' '));
      break;

    case 'list':
      await listCommand(ctx);
      break;

    case 'tail':
      await tailCommand(ctx, options as { limit?: number; level?: string; session?: string });
      break;

    case 'sessions':
      await sessionsCommand(ctx, options as { limit?: number });
      break;

    case 'stats':
      await statsCommand(ctx, options as { session?: string });
      break;

    case 'search':
      await searchCommand(ctx, positional[0] ?? '', options as { limit?: number; level?: string });
      break;

    case 'check':
      await checkCommand(ctx);
      break;

    case 'init':
      await initCommand(ctx);
      break;

    case 'schema':
      await schemaCommand(ctx);
      break;

    case 'help':
      helpCommand();
      break;

    default:
      // If command looks like SQL, execute it directly
      if (command && (
        command.toUpperCase().startsWith('SELECT') ||
        command.toUpperCase().startsWith('SHOW') ||
        command.toUpperCase().startsWith('DESCRIBE')
      )) {
        await queryCommand(ctx, [command, ...rest].join(' '));
      } else if (command) {
        console.error(`Unknown command: ${command}`);
        console.error('Run "pnpm orb help" for usage.');
        process.exit(1);
      }
  }
}

main();
```

### Step 8: Integration

1. Add npm script to `package.json`:
```json
{
  "scripts": {
    "orb": "tsx observability/orb/index.ts"
  }
}
```

2. Update `.env.example` (create if doesn't exist) with ClickHouse variables:
```bash
# ClickHouse Configuration (shared by Rust layer and orb CLI)
# CLICKHOUSE_ENABLED=true           # Rust-only: enable log upload
CLICKHOUSE_HOST="https://your-host:8443"
CLICKHOUSE_USER="default"
CLICKHOUSE_PASSWORD="your-password"
CLICKHOUSE_DATABASE="default"
CLICKHOUSE_LOG_TABLE="logs"
```

## Usage Examples

```bash
# Setup and verification
pnpm orb check                           # Verify connection and table
pnpm orb init                            # Create logs table

# Viewing logs
pnpm orb tail                            # Recent 50 logs
pnpm orb tail -n 100                     # Recent 100 logs
pnpm orb tail -l error                   # Recent errors only
pnpm orb tail -f compact                 # Compact format (like tail -f)

# Sessions
pnpm orb sessions                        # List recent sessions
pnpm orb tail -s <session_id>            # Logs from specific session

# Search and analysis
pnpm orb search "worktree"               # Search by message
pnpm orb search "error" -l error         # Search errors
pnpm orb stats                           # Overall stats
pnpm orb stats -s <session_id>           # Session stats

# Raw queries
pnpm orb "SELECT * FROM logs LIMIT 10"
pnpm orb query "SHOW TABLES"
pnpm orb schema                          # Show table schema

# Output formats
pnpm orb tail -f table                   # ASCII table
pnpm orb tail -f compact                 # One line per log
pnpm orb tail -f json -v                 # JSON with metadata
```

## Log Schema Reference

**IMPORTANT:** This schema MUST match the Rust layer (`02-rust-clickhouse-layer.md`) and the DDL in `initCommand`.

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

## Error Handling Strategy

The CLI provides helpful error messages for common issues:

1. **Missing env vars:** Lists all missing variables with example values
2. **Connection refused:** Suggests checking CLICKHOUSE_HOST
3. **Authentication failed:** Points to CLICKHOUSE_USER/PASSWORD
4. **Table not found:** Suggests running `pnpm orb init`
5. **Unknown command:** Shows help

## Testing Checklist

Before marking complete:

- [ ] `pnpm orb check` connects and reports success
- [ ] `pnpm orb init` creates table (idempotent)
- [ ] `pnpm orb tail` shows logs after Rust app runs with CLICKHOUSE_ENABLED=true
- [ ] `pnpm orb sessions` lists unique session IDs
- [ ] `pnpm orb search "test"` returns matching logs
- [ ] All output formats work (json, table, compact)
- [ ] Missing env vars show helpful error
- [ ] Connection errors are descriptive

## Integration Verification

To verify end-to-end integration:

1. Set `CLICKHOUSE_ENABLED=true` in `.env`
2. Set all CLICKHOUSE_* variables
3. Run `pnpm orb init` to create table
4. Start the Rust app (`pnpm dev`)
5. Generate some activity
6. Run `pnpm orb tail` - should show logs
7. Run `pnpm orb sessions` - should show your session

## Future Enhancements (Out of Scope)

- Live tail with polling (`--follow` flag)
- Export to file
- Time range filters (`--since`, `--until`)
- Admin commands (drop table, alter TTL)
- Integration with MCP tools
