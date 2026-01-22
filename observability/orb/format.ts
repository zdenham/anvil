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

  // Cap column widths to prevent very wide tables
  const maxWidth = 50;
  const cappedWidths = widths.map(w => Math.min(w, maxWidth));

  const header = keys.map((k, i) => k.padEnd(cappedWidths[i])).join(' | ');
  const separator = cappedWidths.map(w => '-'.repeat(w)).join('-+-');
  const body = rows.map(row =>
    keys.map((k, i) => {
      const val = String(row[k] ?? '');
      return val.length > cappedWidths[i]
        ? val.slice(0, cappedWidths[i] - 3) + '...'
        : val.padEnd(cappedWidths[i]);
    }).join(' | ')
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
