import { getClient } from './client';
import { ClickHouseConfig, QueryResult } from './types';

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
  _options: QueryOptions = {}
): Promise<QueryResult<T>> {
  const client = getClient(config);
  const startTime = Date.now();

  try {
    const result = await client.query({
      query: sql,
      format: 'JSONEachRow',
    });

    const rows = await result.json() as T[];
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
