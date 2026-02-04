/**
 * Quick Actions Project Migration (v1)
 *
 * Migration that initializes the default quick actions project during bootstrap.
 * This runs on first launch and is idempotent.
 */

import type { Migration } from '../types';
import { initializeQuickActionsProject } from '@/lib/quick-actions-init';

export const quickActionsProjectMigration: Migration = {
  id: 'quick-actions-project-v1',
  description: 'Initialize default quick actions project',

  async up(): Promise<void> {
    await initializeQuickActionsProject();
  },

  async down(): Promise<void> {
    // No rollback - we don't want to delete user's actions
  },
};
