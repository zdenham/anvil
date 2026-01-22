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
