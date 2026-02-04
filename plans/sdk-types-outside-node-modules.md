# Plan: Move SDK Types Outside node_modules

## Goal

Make `@mort/sdk` types immune to `pnpm install` by placing them outside `node_modules` and using TypeScript path mapping.

## Current State

```
~/.mort/quick-actions/
├── package.json
├── tsconfig.json
├── build.ts
├── src/
│   └── actions/
│       └── *.ts          # import { defineAction } from '@mort/sdk'
└── node_modules/
    ├── esbuild/
    ├── tsx/
    ├── typescript/
    └── @mort/
        └── sdk/
            ├── package.json
            └── types.d.ts   # <-- DELETED by pnpm install
```

## Target State

```
~/.mort/quick-actions/
├── package.json
├── tsconfig.json          # Updated with paths mapping
├── build.ts
├── .mort/                  # New directory for Mort-managed files
│   └── sdk.d.ts           # Types live here, safe from pnpm
├── src/
│   └── actions/
│       └── *.ts           # import { defineAction } from '@mort/sdk' (unchanged)
└── node_modules/
    ├── esbuild/
    ├── tsx/
    └── typescript/
    # No @mort/sdk here anymore
```

## Implementation Steps

### Step 1: Update Template tsconfig.json

**File:** `core/sdk/template/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "baseUrl": ".",
    "paths": {
      "@mort/sdk": ["./.mort/sdk.d.ts"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key changes:**
- Added `"baseUrl": "."` (required for paths to work)
- Added `"paths"` mapping `@mort/sdk` to `.mort/sdk.d.ts`

### Step 2: Update quick-actions-init.ts

**File:** `src/lib/quick-actions-init.ts`

#### 2a: Update Constants

```typescript
const SDK_VERSION = '1.1.0';  // Bump version to trigger migration
const QUICK_ACTIONS_DIR = 'quick-actions';
const TYPES_FILE = 'sdk.d.ts';
const MORT_TYPES_DIR = '.mort';  // New: types directory name
```

#### 2b: Update copyTemplate()

Replace the current SDK types copying logic:

```typescript
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
```

#### 2c: Update readSdkVersion()

```typescript
async function readSdkVersion(projectPath: string): Promise<string | null> {
  try {
    // Try new location first (.mort/version.json)
    const newPath = fs.joinPath(projectPath, MORT_TYPES_DIR, 'version.json');
    if (await fs.exists(newPath)) {
      const data = await fs.readJsonFile<{ version?: string }>(newPath);
      return data.version ?? null;
    }

    // Fall back to old location (node_modules/@mort/sdk/package.json)
    // This enables migration from old structure
    const oldPath = fs.joinPath(projectPath, 'node_modules', '@mort', 'sdk', 'package.json');
    if (await fs.exists(oldPath)) {
      const pkg = await fs.readJsonFile<{ version?: string }>(oldPath);
      return pkg.version ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
```

#### 2d: Update updateSdkTypes()

```typescript
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

  // Clean up old location if it exists (migration)
  const oldSdkDir = fs.joinPath(projectPath, 'node_modules', '@mort');
  if (await fs.exists(oldSdkDir)) {
    await fs.removeDir(oldSdkDir);
    logger.info('Removed old SDK location from node_modules');
  }
}
```

#### 2e: Fix the Null Check Bug

```typescript
// In initializeQuickActionsProject():

// Project exists - check if SDK types need updating
const currentVersion = await readSdkVersion(projectPath);

// Fix: Also update if version is missing (types were deleted or never existed)
if (!currentVersion || needsUpdate(currentVersion, SDK_VERSION)) {
  await updateSdkTypes(projectPath);
  await updateTsConfig(projectPath);  // New: ensure tsconfig has paths
  logger.info('Updated quick actions SDK types', {
    from: currentVersion ?? 'missing',
    to: SDK_VERSION,
  });
  return { created: false, updated: true };
}
```

### Step 3: Add tsconfig Migration Helper

```typescript
/**
 * Ensure tsconfig.json has the correct paths mapping for @mort/sdk.
 * This migrates existing projects from node_modules to .mort directory.
 */
async function updateTsConfig(projectPath: string): Promise<void> {
  const tsconfigPath = fs.joinPath(projectPath, 'tsconfig.json');

  if (!await fs.exists(tsconfigPath)) {
    return;  // No tsconfig to update
  }

  const tsconfig = await fs.readJsonFile<Record<string, unknown>>(tsconfigPath);
  const compilerOptions = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>;

  // Check if paths already configured correctly
  const paths = compilerOptions.paths as Record<string, string[]> | undefined;
  if (paths?.['@mort/sdk']?.[0] === './.mort/sdk.d.ts') {
    return;  // Already correct
  }

  // Update tsconfig
  compilerOptions.baseUrl = compilerOptions.baseUrl ?? '.';
  compilerOptions.paths = {
    ...(paths ?? {}),
    '@mort/sdk': ['./.mort/sdk.d.ts'],
  };
  tsconfig.compilerOptions = compilerOptions;

  await fs.writeJsonFile(tsconfigPath, tsconfig);
  logger.info('Updated tsconfig.json with @mort/sdk path mapping');
}
```

### Step 4: Update Template File Structure

**Remove from template:**
- `core/sdk/template/node_modules/@mort/` (entire directory)

**Add to template:**
- `core/sdk/template/.mort/sdk.d.ts` (copy of types)
- `core/sdk/template/.mort/version.json`:
  ```json
  {
    "version": "1.1.0",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
  ```

### Step 5: Update Tauri Bundle Configuration

**File:** `src-tauri/tauri.conf.json`

The bundled resources should still work as-is since we're copying `sdk-types.d.ts` at runtime. No changes needed here.

### Step 6: Add Health Check (Optional Enhancement)

Add a function that can be called before action discovery to ensure types are present:

```typescript
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
    await updateTsConfig(projectPath);
    return true;  // Recovered
  }

  return false;  // Already present
}
```

## Migration Behavior

When a user with an existing quick-actions project launches the updated Mort:

1. `initializeQuickActionsProject()` is called
2. `projectExists()` returns `true` (project exists)
3. `readSdkVersion()` checks `.mort/version.json` first (not found)
4. Falls back to `node_modules/@mort/sdk/package.json`:
   - If found: Returns old version (e.g., "1.0.0")
   - If deleted by pnpm: Returns `null`
5. Either way, `!currentVersion || needsUpdate()` triggers update
6. `updateSdkTypes()`:
   - Creates `.mort/` directory
   - Copies `sdk.d.ts` to new location
   - Removes old `node_modules/@mort/` directory
7. `updateTsConfig()`:
   - Adds `baseUrl` and `paths` mapping
8. User's existing actions continue to work with `import { defineAction } from '@mort/sdk'`

## Testing Checklist

- [ ] Fresh project creation places types in `.mort/sdk.d.ts`
- [ ] tsconfig.json has correct `paths` mapping
- [ ] `import { defineAction } from '@mort/sdk'` resolves correctly in IDE
- [ ] `pnpm install` in quick-actions directory does NOT delete types
- [ ] Existing project is migrated on app startup
- [ ] Old `node_modules/@mort/` is cleaned up after migration
- [ ] Version tracking works in new location
- [ ] SDK version upgrade triggers type update
- [ ] Types missing triggers recovery (null version case)
- [ ] Actions build and execute correctly after migration

## Rollback Plan

If issues are discovered:

1. Revert template changes
2. Keep `readSdkVersion()` fallback to old location
3. Remove migration cleanup (keep both locations working)
4. SDK_VERSION stays at 1.0.0

## Files to Modify

| File | Changes |
|------|---------|
| `core/sdk/template/tsconfig.json` | Add baseUrl and paths |
| `core/sdk/template/.mort/sdk.d.ts` | New file (copy of types) |
| `core/sdk/template/.mort/version.json` | New file (version tracking) |
| `core/sdk/template/node_modules/@mort/` | Remove directory |
| `src/lib/quick-actions-init.ts` | Update all SDK paths logic |
| `src/lib/paths.ts` | No changes needed |

## Timeline

1. **Template changes**: Update tsconfig and add .mort directory
2. **Init logic changes**: Update quick-actions-init.ts
3. **Testing**: Verify fresh install and migration
4. **Cleanup**: Remove any dead code
