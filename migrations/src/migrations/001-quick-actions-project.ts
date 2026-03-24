/**
 * Migration 001: Quick Actions Project
 *
 * Initializes the default quick actions project at ~/.anvil/quick-actions/
 * This is idempotent - safe to call multiple times.
 */

import type { Migration, MigrationContext } from '../types.js';
import {
  exists,
  ensureDir,
  copyDirExcluding,
  copyFile,
  readJsonFile,
  writeJsonFile,
  joinPath,
} from '../utils.js';

const SDK_VERSION = '1.0.0';
const QUICK_ACTIONS_DIR = 'quick-actions';
const TYPES_FILE = 'sdk.d.ts';
const ANVIL_TYPES_DIR = 'anvil-types'; // Types directory name (safe from pnpm install)

interface SdkVersionFile {
  version: string;
  updatedAt: string;
}

/**
 * Simple semver comparison - returns true if target is newer than current.
 */
function needsUpdate(current: string, target: string): boolean {
  const [curMajor, curMinor, curPatch] = current.split('.').map(Number);
  const [tarMajor, tarMinor, tarPatch] = target.split('.').map(Number);

  if (tarMajor > curMajor) return true;
  if (tarMajor < curMajor) return false;
  if (tarMinor > curMinor) return true;
  if (tarMinor < curMinor) return false;
  return tarPatch > curPatch;
}

export const migration: Migration = {
  version: 2,
  description: 'Initialize default quick actions project',

  async up(ctx: MigrationContext): Promise<void> {
    const projectPath = joinPath(ctx.dataDir, QUICK_ACTIONS_DIR);

    if (!exists(projectPath)) {
      // Create new project from template
      await copyTemplate(ctx, projectPath);
      ctx.log.info('Created default quick actions project', { path: projectPath });
      return;
    }

    // Project exists - check if SDK types need updating
    const currentVersion = readSdkVersion(projectPath);

    if (!currentVersion || needsUpdate(currentVersion, SDK_VERSION)) {
      await updateSdkTypes(ctx, projectPath);
      ctx.log.info('Updated quick actions SDK types', {
        from: currentVersion ?? 'missing',
        to: SDK_VERSION,
      });
    }
  },
};

async function copyTemplate(ctx: MigrationContext, projectPath: string): Promise<void> {
  // Create project directory structure
  ensureDir(projectPath);

  // Create anvil-types directory for SDK types (safe from pnpm install)
  const anvilTypesDir = joinPath(projectPath, ANVIL_TYPES_DIR);
  ensureDir(anvilTypesDir);

  // Copy template files (excluding node_modules - user will run pnpm install)
  copyDirExcluding(ctx.templateDir, projectPath, ['node_modules', 'dist']);

  // Copy SDK types to anvil-types directory
  const typesDestPath = joinPath(anvilTypesDir, TYPES_FILE);
  copyFile(ctx.sdkTypesPath, typesDestPath);

  // Create SDK version file for tracking
  const versionFile: SdkVersionFile = {
    version: SDK_VERSION,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(joinPath(anvilTypesDir, 'version.json'), versionFile);
}

function readSdkVersion(projectPath: string): string | null {
  const versionPath = joinPath(projectPath, ANVIL_TYPES_DIR, 'version.json');
  const data = readJsonFile<SdkVersionFile>(versionPath);
  return data?.version ?? null;
}

async function updateSdkTypes(ctx: MigrationContext, projectPath: string): Promise<void> {
  const anvilTypesDir = joinPath(projectPath, ANVIL_TYPES_DIR);

  // Ensure anvil-types directory exists
  ensureDir(anvilTypesDir);

  // Update sdk.d.ts
  const typesDestPath = joinPath(anvilTypesDir, TYPES_FILE);
  copyFile(ctx.sdkTypesPath, typesDestPath);

  // Update version file
  const versionFile: SdkVersionFile = {
    version: SDK_VERSION,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(joinPath(anvilTypesDir, 'version.json'), versionFile);
}
