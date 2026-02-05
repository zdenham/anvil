# 08 - Bootstrap Initialization & Migrations

## Overview

Implement the first-launch initialization that creates the default quick actions project at `~/.mort/quick-actions/`. This follows the existing migrations pattern for idempotent setup.

## Files to Create

### `src/lib/quick-actions-init.ts`

```typescript
import * as fs from '@tauri-apps/plugin-fs';
import * as path from 'path';
import { getMortDir, getQuickActionsTemplatePath, getSdkTypesPath } from '@/lib/paths.js';
import { logger } from '@/lib/logger.js';
import { Command } from '@tauri-apps/plugin-shell';

const SDK_VERSION = '1.0.0';
const QUICK_ACTIONS_DIR = 'quick-actions';
const TYPES_FILE = 'types.d.ts';

interface InitResult {
  created: boolean;
  updated: boolean;
  error?: string;
}

interface NodeCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * Check if Node.js is installed and accessible.
 * Per Design Decision #5, Mort should detect if Node.js is missing
 * and provide a helpful error message.
 */
export async function checkNodeAvailable(): Promise<NodeCheckResult> {
  try {
    const command = Command.create('node', ['--version']);
    const output = await command.execute();

    if (output.code === 0) {
      const version = output.stdout.trim();
      logger.info('Node.js detected', { version });
      return { available: true, version };
    } else {
      const error = 'Node.js command failed. Please install Node.js from https://nodejs.org/';
      logger.warn('Node.js check failed', { stderr: output.stderr });
      return { available: false, error };
    }
  } catch (e) {
    const error = `Node.js is not installed or not in PATH. Quick actions require Node.js to run. Please install Node.js from https://nodejs.org/`;
    logger.warn('Node.js not found', { error: e instanceof Error ? e.message : String(e) });
    return { available: false, error };
  }
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
  const projectPath = path.join(mortDir, QUICK_ACTIONS_DIR);

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
    if (currentVersion && needsUpdate(currentVersion, SDK_VERSION)) {
      await updateSdkTypes(projectPath);
      logger.info('Updated quick actions SDK types', {
        from: currentVersion,
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
  try {
    const stat = await fs.stat(projectPath);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

async function copyTemplate(projectPath: string): Promise<void> {
  const templatePath = await getQuickActionsTemplatePath();
  const sdkTypesPath = await getSdkTypesPath();

  // Create project directory structure
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, 'node_modules', '@mort', 'sdk'), { recursive: true });

  // Copy template files (excluding node_modules - we only ship types.d.ts)
  await copyDirExcluding(templatePath, projectPath, ['node_modules']);

  // Copy only the types.d.ts file (DD #4 and #22)
  // User projects never import real SDK code, only type definitions
  const typesDestPath = path.join(projectPath, 'node_modules', '@mort', 'sdk', TYPES_FILE);
  await fs.copyFile(sdkTypesPath, typesDestPath);

  // Create a minimal package.json for the SDK types
  const sdkPackageJson = {
    name: '@mort/sdk',
    version: SDK_VERSION,
    types: TYPES_FILE,
    description: 'Type definitions for Mort Quick Actions SDK',
  };
  await fs.writeTextFile(
    path.join(projectPath, 'node_modules', '@mort', 'sdk', 'package.json'),
    JSON.stringify(sdkPackageJson, null, 2)
  );
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readDir(src);

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
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
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readDir(src);

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

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
    const pkgPath = path.join(projectPath, 'node_modules', '@mort', 'sdk', 'package.json');
    const content = await fs.readTextFile(pkgPath);
    const pkg = JSON.parse(content);
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function needsUpdate(current: string, target: string): boolean {
  // Simple semver comparison - could use a library for more complex cases
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
  const sdkDir = path.join(projectPath, 'node_modules', '@mort', 'sdk');

  // Ensure SDK directory exists
  await fs.mkdir(sdkDir, { recursive: true });

  // Update types.d.ts
  const typesDestPath = path.join(sdkDir, TYPES_FILE);
  await fs.copyFile(sdkTypesPath, typesDestPath);

  // Update package.json with new version
  const sdkPackageJson = {
    name: '@mort/sdk',
    version: SDK_VERSION,
    types: TYPES_FILE,
    description: 'Type definitions for Mort Quick Actions SDK',
  };
  await fs.writeTextFile(
    path.join(sdkDir, 'package.json'),
    JSON.stringify(sdkPackageJson, null, 2)
  );

  // Note: User's build.ts and other project files are preserved
}
```

### `src/bootstrap/migrations/quick-actions-project-v1.ts`

Migration that runs during bootstrap:

```typescript
import type { Migration } from '../types.js';
import { initializeQuickActionsProject } from '@/lib/quick-actions-init.js';

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
```

### `src/lib/paths.ts` additions

Add path helpers:

```typescript
export async function getQuickActionsTemplatePath(): Promise<string> {
  // During development, this is in the source tree
  // In production, it's bundled with the app
  const resourceDir = await resolveResource('quick-actions-template');
  return resourceDir;
}

export async function getQuickActionsProjectPath(): Promise<string> {
  const mortDir = await getMortDir();
  return path.join(mortDir, 'quick-actions');
}

export async function getRunnerPath(): Promise<string> {
  // Path to the SDK runner script (injected at runtime per DD #4)
  const resourceDir = await resolveResource('sdk-runner.js');
  return resourceDir;
}

export async function getSdkTypesPath(): Promise<string> {
  // Path to the SDK types.d.ts file (DD #4 and #22)
  // This is the only SDK file shipped to user projects
  const resourceDir = await resolveResource('sdk-types.d.ts');
  return resourceDir;
}
```

## Files to Modify

### `src/bootstrap/migrations/index.ts`

Add the new migration:

```typescript
import { quickActionsProjectMigration } from './quick-actions-project-v1.js';

export const migrations: Migration[] = [
  // ... existing migrations ...
  quickActionsProjectMigration,
];
```

### Tauri Configuration

The template files need to be bundled with the app. Add to `tauri.conf.json`:

```json
{
  "bundle": {
    "resources": [
      "quick-actions-template/**/*",
      "sdk-runner.js",
      "sdk-types.d.ts"
    ]
  }
}
```

## Build Integration

During Mort's build process:

1. Copy `core/sdk/template/` to build output as `quick-actions-template/` (excluding `node_modules/`)
2. Build the template's actions (run `npm run build` in template) during development/testing only
3. Copy `core/sdk/runner.ts` compiled output as `sdk-runner.js`
4. Copy `core/sdk/types.d.ts` to build output as `sdk-types.d.ts` (DD #4 and #22)

Per DD #4 and #22, the template does NOT include node_modules or SDK implementation code. Only the `types.d.ts` file is shipped separately and copied into user projects at initialization.

### Build script addition

```typescript
// In build script
async function buildQuickActionsAssets() {
  const templateSrc = 'core/sdk/template';
  const templateDest = 'dist/quick-actions-template';

  // Copy template files (excluding node_modules - we ship types separately)
  await copyDirExcluding(templateSrc, templateDest, ['node_modules', 'dist']);

  // Copy SDK types.d.ts (DD #4 and #22)
  // This is the only SDK file that goes into user projects
  await fs.copyFile('core/sdk/types.d.ts', 'dist/sdk-types.d.ts');

  // Build the runner (SDK implementation injected at runtime)
  await exec('esbuild core/sdk/runner.ts --bundle --platform=node --outfile=dist/sdk-runner.js');
}

/**
 * Copy directory excluding specified paths.
 * Used to copy template without node_modules (per DD #4 and #22).
 */
async function copyDirExcluding(
  src: string,
  dest: string,
  exclude: string[]
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirExcluding(srcPath, destPath, exclude);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
```

## Design Decisions Referenced

- **#1 Default Project, Batteries Included**: Created on first launch
- **#4 SDK Distribution**: Types shipped as static `.d.ts` file, implementation injected at runtime
- **#5 Runtime Dependency**: Node.js must be installed by user; Mort detects and provides helpful error
- **#13 SDK Versioning**: Version checked, SDK types updated through migrations
- **#22 SDK Types Distribution**: Only `types.d.ts` shipped to user projects, never real SDK code
- **#30 Bootstrap Initialization**: Idempotent, uses migrations pattern

## Acceptance Criteria

- [ ] Project created on first launch
- [ ] Project not overwritten if exists
- [ ] SDK types.d.ts updated when version is newer (DD #4, #22)
- [ ] User's actions preserved during SDK update
- [ ] Migration is idempotent
- [ ] Template bundled with app correctly (without node_modules)
- [ ] Runner script bundled correctly
- [ ] SDK types.d.ts bundled separately (DD #4, #22)
- [ ] Paths resolve correctly in dev and prod
- [ ] Node.js availability checked with helpful error message (DD #5)

## Compliance Notes

**Design Decision Compliance Review:**

- **#1, #30**: Correctly implements first-launch creation with idempotent migrations
- **#4, #22**: Only `types.d.ts` is shipped to user projects; SDK implementation is injected at runtime by the runner
- **#5**: Node.js detection implemented with `checkNodeAvailable()` providing helpful error messages
- **#13**: SDK versioning and update through migrations implemented correctly (types only)

## Verification & Testing

### 1. TypeScript Compilation Checks

```bash
# Verify quick-actions-init.ts compiles without errors
npx tsc --noEmit src/lib/quick-actions-init.ts

# Verify migration file compiles
npx tsc --noEmit src/bootstrap/migrations/quick-actions-project-v1.ts

# Verify paths.ts additions compile
npx tsc --noEmit src/lib/paths.ts

# Full project type check
npm run typecheck
```

### 2. Unit Tests for Core Functions

Create tests in `src/lib/__tests__/quick-actions-init.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from '@tauri-apps/plugin-fs';

// Test needsUpdate semver logic
describe('needsUpdate', () => {
  it('returns true when target major is higher', () => {
    expect(needsUpdate('1.0.0', '2.0.0')).toBe(true);
  });

  it('returns true when target minor is higher', () => {
    expect(needsUpdate('1.0.0', '1.1.0')).toBe(true);
  });

  it('returns true when target patch is higher', () => {
    expect(needsUpdate('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(needsUpdate('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when current is higher', () => {
    expect(needsUpdate('2.0.0', '1.0.0')).toBe(false);
  });
});

// Test Node.js detection (DD #5)
describe('checkNodeAvailable', () => {
  it('returns available: true when Node.js is installed', async () => {
    // Mock successful command execution
    const result = await checkNodeAvailable();
    expect(result.available).toBe(true);
    expect(result.version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('returns available: false with helpful error when Node.js not found', async () => {
    // Mock command not found
    vi.spyOn(Command, 'create').mockImplementation(() => {
      throw new Error('command not found');
    });

    const result = await checkNodeAvailable();
    expect(result.available).toBe(false);
    expect(result.error).toContain('Node.js');
    expect(result.error).toContain('https://nodejs.org');
  });
});

// Test idempotency
describe('initializeQuickActionsProject', () => {
  it('returns created: true on first run', async () => {
    // Mock fs to simulate empty directory
    const result = await initializeQuickActionsProject();
    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
  });

  it('returns created: false, updated: false when project exists with current SDK', async () => {
    // Mock fs to simulate existing project with current version
    const result = await initializeQuickActionsProject();
    expect(result.created).toBe(false);
    expect(result.updated).toBe(false);
  });

  it('returns updated: true when SDK version is older', async () => {
    // Mock fs to simulate existing project with older SDK version
    const result = await initializeQuickActionsProject();
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
  });

  it('only copies types.d.ts to node_modules/@mort/sdk (DD #4, #22)', async () => {
    // Verify that only types.d.ts and package.json are in the SDK directory
    const sdkDir = path.join(projectPath, 'node_modules', '@mort', 'sdk');
    const entries = await fs.readDir(sdkDir);
    const fileNames = entries.map(e => e.name);

    expect(fileNames).toContain('types.d.ts');
    expect(fileNames).toContain('package.json');
    expect(fileNames).toHaveLength(2); // Only these two files
  });
});
```

Run tests with:
```bash
npm run test -- src/lib/__tests__/quick-actions-init.test.ts
```

### 3. Integration Tests

```bash
# Test migration registration
npm run test -- src/bootstrap/__tests__/migrations.test.ts
```

Verify migration is registered:
```typescript
import { migrations } from '@/bootstrap/migrations';

describe('migrations', () => {
  it('includes quick-actions-project-v1 migration', () => {
    const migration = migrations.find(m => m.id === 'quick-actions-project-v1');
    expect(migration).toBeDefined();
    expect(migration?.description).toBe('Initialize default quick actions project');
  });
});
```

### 4. File System Verification (Manual/E2E)

After running the app with the migration:

```bash
# Verify project directory exists
ls -la ~/.mort/quick-actions/

# Verify expected structure - SDK should ONLY contain types.d.ts and package.json (DD #4, #22)
ls -la ~/.mort/quick-actions/node_modules/@mort/sdk/
# Expected output: only types.d.ts and package.json (no index.js, no other implementation files)

# Verify types.d.ts exists (per Design Decision #22)
cat ~/.mort/quick-actions/node_modules/@mort/sdk/types.d.ts

# Verify package.json has correct structure
cat ~/.mort/quick-actions/node_modules/@mort/sdk/package.json
# Expected: {"name":"@mort/sdk","version":"1.0.0","types":"types.d.ts",...}

# Verify NO other node_modules were copied (template ships without node_modules)
ls ~/.mort/quick-actions/node_modules/
# Expected: only @mort directory

# Verify manifest.json exists after user runs build
cat ~/.mort/quick-actions/dist/manifest.json
```

### 5. Tauri Bundle Verification

```bash
# Verify resources are included in tauri.conf.json
grep -A6 '"resources"' src-tauri/tauri.conf.json

# After build, verify resources are bundled
ls -la src-tauri/target/release/bundle/*/Contents/Resources/quick-actions-template/
ls -la src-tauri/target/release/bundle/*/Contents/Resources/sdk-runner.js
ls -la src-tauri/target/release/bundle/*/Contents/Resources/sdk-types.d.ts

# Verify template does NOT contain node_modules (DD #4, #22)
ls src-tauri/target/release/bundle/*/Contents/Resources/quick-actions-template/node_modules/
# Expected: directory should not exist or be empty
```

### 6. Path Resolution Tests

```typescript
import { getQuickActionsTemplatePath, getQuickActionsProjectPath, getRunnerPath } from '@/lib/paths';

describe('path helpers', () => {
  it('getQuickActionsProjectPath returns ~/.mort/quick-actions', async () => {
    const path = await getQuickActionsProjectPath();
    expect(path).toMatch(/\.mort\/quick-actions$/);
  });

  it('getQuickActionsTemplatePath resolves to valid directory', async () => {
    const path = await getQuickActionsTemplatePath();
    // Should exist and be a directory
    const stat = await fs.stat(path);
    expect(stat.isDirectory).toBe(true);
  });

  it('getRunnerPath resolves to valid file', async () => {
    const path = await getRunnerPath();
    expect(path).toMatch(/sdk-runner\.js$/);
  });
});
```

### 7. Expected Behaviors Checklist

| Scenario | Expected Result |
|----------|-----------------|
| Fresh install, first launch | Project created at `~/.mort/quick-actions/`, `created: true` |
| Second launch, no changes | No modifications, `created: false, updated: false` |
| Launch after SDK version bump | SDK types.d.ts updated, user actions preserved, `updated: true` |
| Template missing from bundle | Error logged, graceful failure with `error` in result |
| User deleted project manually | Project recreated on next launch |
| Concurrent migration runs | Idempotent - no corruption or duplicates |
| Node.js not installed | Warning logged with helpful message, project still created |
| Node.js installed | Version logged, project created normally |

### 8. Build Script Verification

```bash
# Run the build script and verify outputs
npm run build

# Verify template was copied (without node_modules per DD #4, #22)
ls -la dist/quick-actions-template/

# Verify template does NOT contain node_modules
ls dist/quick-actions-template/node_modules/ 2>/dev/null || echo "Correct: no node_modules in template"

# Verify sdk-types.d.ts was copied separately (DD #4, #22)
ls -la dist/sdk-types.d.ts

# Verify runner was compiled
ls -la dist/sdk-runner.js
```

### 9. Import Verification

```typescript
// Verify exports are accessible
import {
  initializeQuickActionsProject,
  checkNodeAvailable,
} from '@/lib/quick-actions-init';
import { quickActionsProjectMigration } from '@/bootstrap/migrations/quick-actions-project-v1';
import {
  getQuickActionsTemplatePath,
  getQuickActionsProjectPath,
  getRunnerPath,
  getSdkTypesPath,
} from '@/lib/paths';

// Type checks - these should compile without errors
const result: InitResult = await initializeQuickActionsProject();
const nodeCheck: NodeCheckResult = await checkNodeAvailable();
const migration: Migration = quickActionsProjectMigration;
const templatePath: string = await getQuickActionsTemplatePath();
const typesPath: string = await getSdkTypesPath();
```

### 10. Node.js Detection Tests (DD #5)

```bash
# Test with Node.js available
node --version  # Should return version

# Manually test detection by temporarily renaming node
# (in a test environment only)
which node
sudo mv /usr/local/bin/node /usr/local/bin/node.bak
# Run app - should show helpful error about installing Node.js
sudo mv /usr/local/bin/node.bak /usr/local/bin/node
```

```typescript
// Integration test for Node.js detection
describe('Node.js detection (DD #5)', () => {
  it('provides helpful error message when Node.js not found', async () => {
    const result = await checkNodeAvailable();

    if (!result.available) {
      expect(result.error).toContain('Node.js');
      expect(result.error).toContain('nodejs.org');
      expect(result.error).toMatch(/install|not installed|not found/i);
    }
  });

  it('logs version when Node.js is available', async () => {
    const result = await checkNodeAvailable();

    if (result.available) {
      expect(result.version).toMatch(/^v\d+/);
    }
  });
});
```