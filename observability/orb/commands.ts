import { CommandContext, LogEntry } from './types';
import { executeQuery, cleanResults } from './query';
import { testConnection } from './client';
import { formatOutput, formatMeta } from './format';

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
orb - ClickHouse log query tool for mortician

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
