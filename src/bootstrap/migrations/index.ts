/**
 * Migration Registry
 *
 * Central registry of all migrations. Migrations are run in order during bootstrap.
 * Each migration is idempotent - safe to run multiple times.
 */

import type { Migration } from '../types';
import { quickActionsProjectMigration } from './quick-actions-project-v1';

/**
 * All migrations, in order of execution.
 * Add new migrations to the end of this array.
 */
export const migrations: Migration[] = [
  quickActionsProjectMigration,
];

/**
 * Run all migrations.
 * Each migration is idempotent, so this is safe to call multiple times.
 */
export async function runMigrations(): Promise<void> {
  for (const migration of migrations) {
    await migration.up();
  }
}
