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
    const data = await result.json<{ 'version()': string }>();
    return { connected: true, version: data.data[0]?.['version()'] };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
