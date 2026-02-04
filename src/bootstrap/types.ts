/**
 * Bootstrap Types
 *
 * Type definitions for the migration and bootstrap system.
 */

/**
 * A migration that runs during bootstrap.
 * Migrations are idempotent - safe to run multiple times.
 */
export interface Migration {
  /** Unique identifier for this migration */
  id: string;

  /** Human-readable description */
  description: string;

  /**
   * Execute the migration.
   * Should be idempotent - safe to call multiple times.
   */
  up(): Promise<void>;

  /**
   * Rollback the migration (optional).
   * Not all migrations can be rolled back safely.
   */
  down?(): Promise<void>;
}
