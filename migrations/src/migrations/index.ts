/**
 * Migration registry.
 * Import all migrations here and export them in order.
 */

import type { Migration } from '../types.js';
import { migration as noop } from './000-noop.js';
import { migration as quickActionsProject } from './001-quick-actions-project.js';
/**
 * All migrations in order.
 * Each migration has a version number that must be sequential (1, 2, 3, ...).
 */
export const migrations: Migration[] = [
  noop,
  quickActionsProject,
];
