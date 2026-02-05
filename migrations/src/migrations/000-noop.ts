/**
 * Migration 001: No-op
 *
 * Placeholder migration for version bump.
 */

import type { Migration, MigrationContext } from '../types.js';

export const migration: Migration = {
  version: 1,
  description: 'No-op (version bump)',

  async up(_ctx: MigrationContext): Promise<void> {
    // No-op
  },
};
