/**
 * Bootstrap Module
 *
 * Provides migration-based initialization for Mort.
 * Run migrations during app startup to ensure all resources are initialized.
 */

export { migrations, runMigrations } from './migrations/index';
export type { Migration } from './types';
