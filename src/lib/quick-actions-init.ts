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
import { getMortDir, getQuickActionsTemplatePath, getSdkTypesPath } from './paths';
import { logger } from './logger-client';
import { checkNodeAvailable as checkNode, type NodeAvailability } from './node-detection';

const fs = new FilesystemClient();

const SDK_VERSION = '1.1.0'; // Bump version to trigger migration
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

    // Fix: Also update if version is missing (types were deleted or never existed)
    if (!currentVersion || needsUpdate(currentVersion, SDK_VERSION)) {
      await updateSdkTypes(projectPath);
      await updateTsConfig(projectPath); // Ensure tsconfig has paths
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
  const sdkDir = fs.joinPath(projectPath, 'node_modules', '@mort', 'sdk');
  await fs.mkdir(sdkDir);

  // Copy template files (excluding node_modules - we only ship types.d.ts)
  await copyDirExcluding(templatePath, projectPath, ['node_modules', 'dist']);

  // Copy only the types.d.ts file (DD #4 and #22)
  // User projects never import real SDK code, only type definitions
  const typesDestPath = fs.joinPath(sdkDir, TYPES_FILE);
  await fs.copyFile(sdkTypesPath, typesDestPath);

  // Create a minimal package.json for the SDK types
  const sdkPackageJson = {
    name: '@mort/sdk',
    version: SDK_VERSION,
    types: TYPES_FILE,
    description: 'Type definitions for Mort Quick Actions SDK',
  };
  await fs.writeJsonFile(
    fs.joinPath(sdkDir, 'package.json'),
    sdkPackageJson
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
    // Read version from the minimal package.json we create for SDK types
    const pkgPath = fs.joinPath(projectPath, 'node_modules', '@mort', 'sdk', 'package.json');
    const pkg = await fs.readJsonFile<{ version?: string }>(pkgPath);
    return pkg.version ?? null;
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
 * Update only the SDK types.d.ts file (DD #4 and #22).
 * User's actions and other project files are preserved.
 * The actual SDK implementation is injected at runtime by Mort's runner.
 */
async function updateSdkTypes(projectPath: string): Promise<void> {
  const sdkTypesPath = await getSdkTypesPath();
  const sdkDir = fs.joinPath(projectPath, 'node_modules', '@mort', 'sdk');

  // Ensure SDK directory exists
  await fs.mkdir(sdkDir);

  // Update types.d.ts
  const typesDestPath = fs.joinPath(sdkDir, TYPES_FILE);
  await fs.copyFile(sdkTypesPath, typesDestPath);

  // Update package.json with new version
  const sdkPackageJson = {
    name: '@mort/sdk',
    version: SDK_VERSION,
    types: TYPES_FILE,
    description: 'Type definitions for Mort Quick Actions SDK',
  };
  await fs.writeJsonFile(
    fs.joinPath(sdkDir, 'package.json'),
    sdkPackageJson
  );

  // Note: User's build.ts and other project files are preserved
}
