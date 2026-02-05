#!/usr/bin/env node
/**
 * Migration Runner
 *
 * Standalone Node.js script that runs migrations.
 * Invoked by Rust during app startup.
 *
 * Environment variables (passed by Rust):
 * - MORT_DATA_DIR: Path to ~/.mort or ~/.mort-dev
 * - MORT_TEMPLATE_DIR: Path to the bundled SDK template
 * - MORT_SDK_TYPES_PATH: Path to the bundled SDK types file
 */

import * as path from 'node:path';
import { migrations } from './migrations/index.js';
import { readJsonFile, writeJsonFile, ensureDir, joinPath } from './utils.js';
import type { AppConfig, MigrationContext, MigrationLogger } from './types.js';

const dataDir = process.env.MORT_DATA_DIR;
const templateDir = process.env.MORT_TEMPLATE_DIR;
const sdkTypesPath = process.env.MORT_SDK_TYPES_PATH;

if (!dataDir) {
  console.error('MORT_DATA_DIR environment variable is required');
  process.exit(1);
}

if (!templateDir) {
  console.error('MORT_TEMPLATE_DIR environment variable is required');
  process.exit(1);
}

if (!sdkTypesPath) {
  console.error('MORT_SDK_TYPES_PATH environment variable is required');
  process.exit(1);
}

const configPath = path.join(dataDir, 'settings', 'app-config.json');

// Ensure settings directory exists
ensureDir(path.dirname(configPath));

// Read current config
let config = readJsonFile<AppConfig>(configPath);
if (!config) {
  config = {};
}

const currentVersion = config.migration_version ?? 0;

// Create logger
const log: MigrationLogger = {
  info(message: string, data?: Record<string, unknown>): void {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[migration] INFO: ${message}${dataStr}`);
  },
  warn(message: string, data?: Record<string, unknown>): void {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.warn(`[migration] WARN: ${message}${dataStr}`);
  },
  error(message: string, data?: Record<string, unknown>): void {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.error(`[migration] ERROR: ${message}${dataStr}`);
  },
};

// Create migration context
const context: MigrationContext = {
  dataDir,
  templateDir,
  sdkTypesPath,
  log,
};

async function runMigrations(): Promise<void> {
  // Find pending migrations
  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    log.info('Migrations up to date', { currentVersion });
    return;
  }

  log.info('Running migrations', {
    from: currentVersion,
    to: pendingMigrations[pendingMigrations.length - 1].version,
    count: pendingMigrations.length,
  });

  // Run migrations in order
  for (const migration of pendingMigrations) {
    log.info(`Running migration ${migration.version}: ${migration.description}`);

    try {
      await migration.up(context);

      // Update version after each successful migration
      config!.migration_version = migration.version;
      writeJsonFile(configPath, config);

      log.info(`Migration ${migration.version} complete`);
    } catch (error) {
      log.error(`Migration ${migration.version} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  }

  log.info('All migrations complete', { version: config!.migration_version });
}

runMigrations().catch((error) => {
  log.error('Migration runner failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
