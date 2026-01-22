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

  // Index signature for Record<string, unknown> compatibility
  [key: string]: string | number | undefined;
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
