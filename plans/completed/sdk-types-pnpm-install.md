# SDK Types and pnpm Install Behavior

## Problem Summary

When a user runs `pnpm install` in the `~/.mort/quick-actions/` directory, the `@mort/sdk` types are **deleted** because:

1. The quick-actions project's `package.json` does NOT list `@mort/sdk` as a dependency
2. pnpm (like npm/yarn) cleans the `node_modules` directory to match `package.json`
3. The `@mort/sdk` folder exists only because Mort manually copies it during project initialization
4. After `pnpm install`, the entire `node_modules/@mort/sdk/` directory is removed

## How SDK Types Work

### Architecture (Design Decisions #4 and #22)

The @mort/sdk is intentionally NOT a real npm package. Instead:

1. **Types Only**: Only `types.d.ts` is shipped to user projects for IDE support
2. **Runtime Injection**: The actual SDK implementation is injected at runtime by Mort's runner
3. **No npm Dependency**: User projects never have @mort/sdk in their package.json

### File Locations

| Location | Purpose |
|----------|---------|
| `core/sdk/types.ts` | Source TypeScript definitions |
| `core/sdk/dist/index.d.ts` | Compiled type definitions (dev mode source) |
| `sdk-types.d.ts` | Bundled with production app |
| `~/.mort/quick-actions/node_modules/@mort/sdk/types.d.ts` | User's local copy |

### Initialization Flow

When Mort initializes the quick-actions project (`src/lib/quick-actions-init.ts`):

1. Creates `~/.mort/quick-actions/` directory
2. Copies template files (excluding node_modules)
3. Creates `node_modules/@mort/sdk/` manually
4. Copies `types.d.ts` into that directory
5. Creates a minimal `package.json` for the SDK

## The Problem in Detail

```
~/.mort/quick-actions/
├── package.json              # Does NOT include @mort/sdk
├── build.ts
├── actions/
│   └── example.ts
└── node_modules/
    ├── esbuild/              # Installed by pnpm
    ├── tsx/                  # Installed by pnpm
    ├── typescript/           # Installed by pnpm
    └── @mort/                # Manually placed by Mort
        └── sdk/
            ├── package.json
            └── types.d.ts    # <-- DELETED by pnpm install!
```

When user runs `pnpm install`:
1. pnpm reads `package.json` (only has esbuild, tsx, typescript)
2. pnpm cleans `node_modules` to remove "orphaned" packages
3. `@mort/sdk` is considered orphaned and deleted
4. User loses type hints and IDE support

## Current Recovery Mechanisms

### Automatic Recovery (Existing)

Mort already has a recovery mechanism in `initializeQuickActionsProject()`:

1. Checks if project exists
2. Reads SDK version from `node_modules/@mort/sdk/package.json`
3. If version check fails (file missing), `readSdkVersion()` returns `null`
4. However, `needsUpdate(null, '1.0.0')` would need to handle this case

**Current Issue**: The `needsUpdate()` function receives `null` when types are missing, but the current logic:
```typescript
const currentVersion = await readSdkVersion(projectPath);
if (currentVersion && needsUpdate(currentVersion, SDK_VERSION)) {
  await updateSdkTypes(projectPath);
}
```

This means if `currentVersion` is `null`, the update is **skipped** because `null && anything` is falsy.

### Manual Recovery

Users can manually trigger recovery by:
1. Deleting `~/.mort/quick-actions/` entirely (forces full reinit)
2. Waiting for Mort to call `initializeQuickActionsProject()` on startup

## Proposed Solutions

### Option A: Fix the Null Check (Minimal Change)

Update `quick-actions-init.ts` to treat missing SDK as needing update:

```typescript
// Current (broken for missing types):
if (currentVersion && needsUpdate(currentVersion, SDK_VERSION)) {
  await updateSdkTypes(projectPath);
}

// Fixed:
if (!currentVersion || needsUpdate(currentVersion, SDK_VERSION)) {
  await updateSdkTypes(projectPath);
}
```

**Pros**: Simple fix, maintains existing pattern
**Cons**: Only recovers on app startup when init is called

### Option B: Add SDK as Local Dependency (Recommended)

Add @mort/sdk to the quick-actions package.json as a local file reference:

```json
{
  "devDependencies": {
    "@mort/sdk": "file:./node_modules/@mort/sdk"
  }
}
```

**Issue**: This creates a circular reference and won't actually work because the directory is being managed by pnpm.

### Option C: Use pnpm's `public-hoist-pattern` or `.npmrc`

Create an `.npmrc` file in the quick-actions directory:

```ini
# Prevent pnpm from cleaning manually-placed packages
shamefully-hoist=true
```

**Pros**: Prevents cleanup
**Cons**: Doesn't actually protect manually-placed packages

### Option D: Move Types Outside node_modules (Recommended)

Instead of placing types in `node_modules/@mort/sdk/`, use TypeScript path mapping:

1. Place types at `~/.mort/quick-actions/.mort-types/sdk.d.ts`
2. Update the template's `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@mort/sdk": ["./.mort-types/sdk.d.ts"]
    }
  }
}
```

**Pros**:
- Types survive `pnpm install`
- Clean separation of concerns
- No hacky workarounds

**Cons**:
- Requires template update
- Migration for existing projects

### Option E: Health Check on Action Discovery

Add a health check when discovering quick actions that repairs missing types:

```typescript
async function ensureSdkTypes(): Promise<void> {
  const projectPath = await getQuickActionsProjectPath();
  const sdkDir = path.join(projectPath, 'node_modules', '@mort', 'sdk');
  const typesPath = path.join(sdkDir, 'types.d.ts');

  if (!await fs.exists(typesPath)) {
    await updateSdkTypes(projectPath);
    logger.info('Recovered missing SDK types');
  }
}
```

**Pros**: Self-healing, proactive
**Cons**: Adds overhead to action discovery

## Recommended Approach

Implement both **Option A** (fix null check) and **Option D** (move types outside node_modules) in phases:

### Phase 1: Quick Fix (Option A)
- Fix the null check in `initializeQuickActionsProject()`
- Types will be restored on next app startup

### Phase 2: Permanent Solution (Option D)
- Update template to use `.mort-types/` directory
- Update TypeScript config with path mapping
- Add migration to move existing types
- Increment SDK_VERSION to trigger migration

## Implementation Tasks

- [ ] Fix null check in `quick-actions-init.ts`
- [ ] Add health check function for SDK types
- [ ] Update template structure to use `.mort-types/`
- [ ] Update template `tsconfig.json` with path mapping
- [ ] Add migration for existing quick-actions projects
- [ ] Test `pnpm install` behavior after changes
- [ ] Update documentation

## Testing Scenarios

1. Fresh install: Types should be created correctly
2. `pnpm install` in quick-actions: Types should survive (after Option D)
3. Types manually deleted: Should be restored on next action discovery
4. SDK version upgrade: Types should be updated
5. Existing project migration: Types should be moved to new location
