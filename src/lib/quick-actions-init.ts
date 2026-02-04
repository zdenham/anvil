/**
 * Quick Actions Project Initialization
 *
 * Handles first-launch initialization that creates the default quick actions
 * project at ~/.mort/quick-actions/. This follows the existing migrations
 * pattern for idempotent setup.
 *
 * Design Decisions Referenced:
 * - #1 Default Project, Batteries Included: Created on first launch
 * - #4 SDK Distribution: Types shipped as static .d.ts file, implementation injected at runtime
 * - #5 Runtime Dependency: Node.js must be installed by user; Mort detects and provides helpful error
 * - #13 SDK Versioning: Version checked, SDK types updated through migrations
 * - #22 SDK Types Distribution: Only types.d.ts shipped to user projects, never real SDK code
 * - #30 Bootstrap Initialization: Idempotent, uses migrations pattern
 */

import { FilesystemClient, type DirEntry } from './filesystem-client';
import { getMortDir, getQuickActionsTemplatePath, getSdkTypesPath, getQuickActionsProjectPath } from './paths';
import { logger } from './logger-client';
import { checkNodeAvailable as checkNode, type NodeAvailability } from './node-detection';

const fs = new FilesystemClient();

const SDK_VERSION = '1.0.0';
const QUICK_ACTIONS_DIR = 'quick-actions';
const TYPES_FILE = 'sdk.d.ts';
const MORT_TYPES_DIR = '.mort'; // Types directory name (safe from pnpm install)

export interface InitResult {
  created: boolean;
  updated: boolean;
  error?: string;
}

// Re-export NodeAvailability for convenience
export type { NodeAvailability };

/**
 * Check if Node.js is installed and accessible.
 * Per Design Decision #5, Mort should detect if Node.js is missing
 * and provide a helpful error message.
 *
 * This is a wrapper around the existing node-detection module with
 * enhanced logging.
 */
export async function checkNodeAvailable(): Promise<NodeAvailability> {
  const result = await checkNode();

  if (result.available) {
    logger.info('Node.js detected', { version: result.version });
  } else {
    logger.warn('Node.js check failed', { error: result.error });
  }

  return result;
}

/**
 * Initialize the default quick actions project.
 * This is idempotent - safe to call multiple times.
 *
 * Per Design Decision #5, this also checks for Node.js availability
 * and logs a helpful error if not found. The project is still created
 * even without Node.js, but actions won't be runnable.
 */
export async function initializeQuickActionsProject(): Promise<InitResult> {
  const mortDir = await getMortDir();
  const projectPath = fs.joinPath(mortDir, QUICK_ACTIONS_DIR);

  // Check Node.js availability (DD #5)
  // We log a warning but still proceed with project creation
  const nodeCheck = await checkNodeAvailable();
  if (!nodeCheck.available) {
    logger.warn('Quick actions will not be runnable without Node.js', {
      error: nodeCheck.error,
    });
  }

  try {
    // Check if project exists
    const exists = await projectExists(projectPath);

    if (!exists) {
      // Create new project from template
      await copyTemplate(projectPath);
      logger.info('Created default quick actions project', { path: projectPath });
      return { created: true, updated: false };
    }

    // Project exists - check if SDK types need updating
    const currentVersion = await readSdkVersion(projectPath);

    if (!currentVersion || needsUpdate(currentVersion, SDK_VERSION)) {
      await updateSdkTypes(projectPath);
      logger.info('Updated quick actions SDK types', {
        from: currentVersion ?? 'missing',
        to: SDK_VERSION,
      });
      return { created: false, updated: true };
    }

    return { created: false, updated: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('Failed to initialize quick actions project', { error });
    return { created: false, updated: false, error };
  }
}

async function projectExists(projectPath: string): Promise<boolean> {
  return fs.exists(projectPath);
}

async function copyTemplate(projectPath: string): Promise<void> {
  const templatePath = await getQuickActionsTemplatePath();
  const sdkTypesPath = await getSdkTypesPath();

  // Create project directory structure
  await fs.mkdir(projectPath);

  // Create .mort directory for SDK types (safe from pnpm install)
  const mortTypesDir = fs.joinPath(projectPath, MORT_TYPES_DIR);
  await fs.mkdir(mortTypesDir);

  // Copy template files (excluding node_modules - user will run pnpm install)
  await copyDirExcluding(templatePath, projectPath, ['node_modules', 'dist']);

  // Copy SDK types to .mort directory (DD #4 and #22)
  const typesDestPath = fs.joinPath(mortTypesDir, TYPES_FILE);
  await fs.copyFile(sdkTypesPath, typesDestPath);

  // Create SDK version file for tracking
  const versionFile = {
    version: SDK_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeJsonFile(
    fs.joinPath(mortTypesDir, 'version.json'),
    versionFile
  );
}

/**
 * Copy directory contents, excluding specified directories.
 * Used to copy template without node_modules (we only ship types.d.ts per DD #4 and #22).
 */
async function copyDirExcluding(
  src: string,
  dest: string,
  exclude: string[]
): Promise<void> {
  await fs.mkdir(dest);

  const entries: DirEntry[] = await fs.listDir(src);

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const srcPath = fs.joinPath(src, entry.name);
    const destPath = fs.joinPath(dest, entry.name);

    if (entry.isDirectory) {
      await copyDirExcluding(srcPath, destPath, exclude);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function readSdkVersion(projectPath: string): Promise<string | null> {
  try {
    const versionPath = fs.joinPath(projectPath, MORT_TYPES_DIR, 'version.json');
    if (await fs.exists(versionPath)) {
      const data = await fs.readJsonFile<{ version?: string }>(versionPath);
      return data.version ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Simple semver comparison - returns true if target is newer than current.
 * Exported for testing.
 */
export function needsUpdate(current: string, target: string): boolean {
  const [curMajor, curMinor, curPatch] = current.split('.').map(Number);
  const [tarMajor, tarMinor, tarPatch] = target.split('.').map(Number);

  if (tarMajor > curMajor) return true;
  if (tarMajor < curMajor) return false;
  if (tarMinor > curMinor) return true;
  if (tarMinor < curMinor) return false;
  return tarPatch > curPatch;
}

/**
 * Update only the SDK types file (DD #4 and #22).
 * User's actions and other project files are preserved.
 * The actual SDK implementation is injected at runtime by Mort's runner.
 */
async function updateSdkTypes(projectPath: string): Promise<void> {
  const sdkTypesPath = await getSdkTypesPath();
  const mortTypesDir = fs.joinPath(projectPath, MORT_TYPES_DIR);

  // Ensure .mort directory exists
  await fs.mkdir(mortTypesDir);

  // Update sdk.d.ts
  const typesDestPath = fs.joinPath(mortTypesDir, TYPES_FILE);
  await fs.copyFile(sdkTypesPath, typesDestPath);

  // Update version file
  const versionFile = {
    version: SDK_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeJsonFile(
    fs.joinPath(mortTypesDir, 'version.json'),
    versionFile
  );
}

/**
 * Verify SDK types are present and recover if missing.
 * Call this before discovering quick actions.
 */
export async function ensureSdkTypesPresent(): Promise<boolean> {
  const projectPath = await getQuickActionsProjectPath();
  const typesPath = fs.joinPath(projectPath, MORT_TYPES_DIR, TYPES_FILE);

  if (!await fs.exists(typesPath)) {
    logger.warn('SDK types missing, attempting recovery');
    await updateSdkTypes(projectPath);
    return true; // Recovered
  }

  return false; // Already present
}
