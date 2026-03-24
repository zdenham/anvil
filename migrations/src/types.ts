/**
 * Migration types for the standalone migration runner.
 */

export interface Migration {
  /** Migration version number (must be sequential: 1, 2, 3, ...) */
  version: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** Run the migration */
  up(context: MigrationContext): Promise<void>;
}

export interface MigrationContext {
  /** Path to ~/.anvil or ~/.anvil-dev data directory */
  dataDir: string;
  /** Path to the SDK template directory (bundled with app) */
  templateDir: string;
  /** Path to the SDK types file (bundled with app) */
  sdkTypesPath: string;
  /** Logger for migration output */
  log: MigrationLogger;
}

export interface MigrationLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface AppConfig {
  device_id?: string;
  spotlight_hotkey?: string;
  clipboard_hotkey?: string;
  onboarded?: boolean;
  /** Current migration version (0 = no migrations run yet) */
  migration_version?: number;
}
