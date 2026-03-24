# 07 - Default Project Template

## Overview

Create the default project template that ships with Anvil and gets copied to `~/.anvil/quick-actions/` on first launch. This includes all configuration files, the build script, and example actions.

## Files to Create

All files in `core/sdk/template/` that will be copied to `~/.anvil/quick-actions/`:

### `core/sdk/template/package.json`

```json
{
  "name": "anvil-quick-actions",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsx build.ts",
    "watch": "tsx build.ts --watch"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

Note: `@anvil/sdk` is NOT listed as a dependency because it's pre-installed in `node_modules/`.

### `core/sdk/template/tsconfig.json`

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
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `core/sdk/template/build.ts`

```typescript
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actionsDir = path.join(__dirname, 'src', 'actions');
const outDir = path.join(__dirname, 'dist');

// Ensure output directories exist
fs.mkdirSync(path.join(outDir, 'actions'), { recursive: true });

// Get all action files
const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.ts'));

console.log(`Building ${actionFiles.length} actions...`);

// Build all action files
for (const file of actionFiles) {
  await esbuild.build({
    entryPoints: [path.join(actionsDir, file)],
    outdir: path.join(outDir, 'actions'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['@anvil/sdk'],  // SDK injected at runtime
    sourcemap: false,
  });
  console.log(`  ✓ ${file}`);
}

// Generate manifest by importing built files
interface ManifestAction {
  slug: string;
  title: string;
  description?: string;
  entryPoint: string;
  contexts: string[];
}

const manifest: {
  version: 1;
  sdkVersion: string;
  actions: ManifestAction[];
} = {
  version: 1,
  sdkVersion: '1.0.0',
  actions: [],
};

for (const file of actionFiles) {
  const jsFile = file.replace('.ts', '.js');
  const modulePath = path.join(outDir, 'actions', jsFile);

  // Clear module cache to ensure fresh import
  const moduleUrl = `file://${modulePath}?t=${Date.now()}`;
  const module = await import(moduleUrl);
  const action = module.default;

  if (!action || !action.id || !action.title || !action.contexts) {
    console.warn(`  ⚠ Skipping ${file}: missing required fields (id, title, contexts)`);
    continue;
  }

  manifest.actions.push({
    slug: action.id,
    title: action.title,
    description: action.description,
    entryPoint: `actions/${jsFile}`,
    contexts: action.contexts,
  });
}

// Write manifest
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`\n✓ Built ${manifest.actions.length} actions`);
console.log(`✓ Manifest written to dist/manifest.json`);
```

### `core/sdk/template/src/actions/example.ts`

Example action showing SDK usage patterns:

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'example',
  title: 'Example Action',
  description: 'Shows how to write a quick action',
  contexts: ['thread', 'plan', 'empty'],

  async execute(context, sdk) {
    sdk.log.info('Example action executed', {
      contextType: context.contextType,
      threadId: context.threadId,
      planId: context.planId,
    });

    await sdk.ui.showToast('Hello from example action!', 'info');
  },
});
```

### `core/sdk/template/src/actions/archive.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'archive',
  title: 'Archive',
  description: 'Complete and file away',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
      sdk.log.info('Archived thread', { threadId: context.threadId });
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
      sdk.log.info('Archived plan', { planId: context.planId });
    }
  },
});
```

### `core/sdk/template/src/actions/mark-unread.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'mark-unread',
  title: 'Mark Unread',
  description: 'Return to inbox for later',
  contexts: ['thread'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markUnread(context.threadId);
      sdk.log.info('Marked thread as unread', { threadId: context.threadId });
    }
  },
});
```

### `core/sdk/template/src/actions/next-unread.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'next-unread',
  title: 'Next Unread',
  description: 'Proceed to next unread item',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Navigated to next unread');
  },
});
```

### `core/sdk/template/src/actions/archive-and-next.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'archive-and-next',
  title: 'Archive & Next',
  description: 'Archive current item and go to next unread',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
    }

    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Archived and navigated to next unread');
  },
});
```

### `core/sdk/template/README.md`

```markdown
# Anvil Quick Actions

This directory contains your custom quick actions for Anvil.

## Quick Start

1. Create a new file in `src/actions/` (e.g., `my-action.ts`)
2. Run `npm run build` to compile
3. Click "Refresh Actions" in Anvil settings

## Writing an Action

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'my-action',           // Unique identifier (slug)
  title: 'My Action',        // Display name
  description: 'Optional description',
  contexts: ['thread'],      // Where to show: 'thread', 'plan', 'empty', or 'all'

  async execute(context, sdk) {
    // Your code here
    // context: information about current view
    // sdk: Anvil services (git, threads, plans, ui, log)

    await sdk.ui.showToast('Hello!', 'success');
  },
});
```

## Available SDK Services

### `sdk.threads`
- `get(threadId)` - Get thread info
- `list()` - List all threads
- `archive(threadId)` - Archive a thread
- `markRead(threadId)` / `markUnread(threadId)`

### `sdk.plans`
- `get(planId)` - Get plan info
- `list()` - List all plans
- `archive(planId)` - Archive a plan

### `sdk.ui`
- `showToast(message, type)` - Show notification
- `navigateToThread(threadId)` - Navigate to thread
- `navigateToPlan(planId)` - Navigate to plan
- `navigateToNextUnread()` - Go to next unread item
- `setInputContent(content)` - Set input field content
- `focusInput()` - Focus the input field

### `sdk.git`
- `getCurrentBranch(path)` - Get current branch
- `getDefaultBranch(path)` - Get main/master branch
- `listBranches(path)` - List all branches

### `sdk.log`
- `info(message, data)` / `warn()` / `error()` / `debug()`

## Context Object

The `context` parameter tells you where the action was invoked:

```typescript
interface QuickActionExecutionContext {
  contextType: 'thread' | 'plan' | 'empty';
  threadId?: string;      // Set when contextType is 'thread'
  planId?: string;        // Set when contextType is 'plan'
  repository: { id, name, path } | null;
  worktree: { id, path, branch } | null;
}
```

## Tips

- Actions have a 30-second timeout
- Use `sdk.log` for debugging (appears in Anvil's logs)
- Test with the example action first
- Run `npm run watch` for auto-rebuild during development
```

### Pre-built dist/ Files

The template should also include pre-built dist/ files so actions work immediately:

- `core/sdk/template/dist/manifest.json` - Pre-generated manifest
- `core/sdk/template/dist/actions/*.js` - Pre-built action files

These are generated by running `npm run build` in the template directory during Anvil's build process.

### SDK Package (pre-installed)

The template includes a minimal `node_modules/@anvil/sdk/` directory:

- `core/sdk/template/node_modules/@anvil/sdk/package.json`
- `core/sdk/template/node_modules/@anvil/sdk/index.d.ts`
- `core/sdk/template/node_modules/@anvil/sdk/index.js`

These are copies of the files from `03-sdk-distribution.md`.

## Design Decisions Referenced

- **#1 Default Project, Batteries Included**: Pre-configured, ready to use
- **#2 Project-Based Architecture**: Full project with build toolchain
- **#21 Default Actions via SDK**: Built-in actions implemented using SDK

## Acceptance Criteria

- [ ] package.json has correct dependencies and scripts
- [ ] tsconfig.json enables proper TypeScript compilation
- [ ] build.ts generates manifest correctly
- [ ] All default actions compile and work
- [ ] README documents SDK usage
- [ ] Pre-built dist/ files included
- [ ] @anvil/sdk package pre-installed in node_modules

## Compliance Notes

This plan references design decisions #1, #2, and #21. Additional relevant decisions:

- **#3 Build-Time Validation**: The build.ts script validates actions have required fields (id, title, contexts) before including in manifest
- **#4 SDK Distribution**: Types are in `node_modules/@anvil/sdk/index.d.ts`, actual SDK injected at runtime
- **#5 Runtime Dependency**: devDependencies use tsx for building; output is vanilla JS requiring only Node.js
- **#10 & #33 SDK Communication**: Example actions use SDK methods like `sdk.threads.archive()` which emit events - Anvil handles actual writes
- **#14 Action IDs**: Manifest `slug` field is human-readable; Anvil assigns UUIDs when registering
- **#16 Context Scope**: Actions specify contexts array; 'all' is equivalent to ['thread', 'plan', 'empty']
- **#22 SDK Types Distribution**: Only .d.ts shipped; runtime implementation injected by Anvil's runner
- **#25 Action Timeout**: README documents 30-second timeout for user awareness

## Verification & Testing

### 1. File Structure Verification

Run from `core/sdk/template/`:

```bash
# Verify all required files exist
ls -la package.json tsconfig.json build.ts README.md
ls -la src/actions/example.ts src/actions/archive.ts src/actions/mark-unread.ts src/actions/next-unread.ts src/actions/archive-and-next.ts
ls -la node_modules/@anvil/sdk/package.json node_modules/@anvil/sdk/index.d.ts node_modules/@anvil/sdk/index.js
```

**Expected**: All files exist with non-zero size.

### 2. TypeScript Compilation Check

```bash
cd core/sdk/template
npm install
npx tsc --noEmit
```

**Expected**: No TypeScript errors. This verifies:
- tsconfig.json is valid
- All action files have correct types
- @anvil/sdk types are properly referenced

### 3. Build Script Execution

```bash
cd core/sdk/template
npm run build
```

**Expected output**:
```
Building 5 actions...
  ✓ example.ts
  ✓ archive.ts
  ✓ mark-unread.ts
  ✓ next-unread.ts
  ✓ archive-and-next.ts

✓ Built 5 actions
✓ Manifest written to dist/manifest.json
```

### 4. Manifest Validation

```bash
cd core/sdk/template
cat dist/manifest.json | node -e "
const manifest = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
console.log('Version:', manifest.version);
console.log('SDK Version:', manifest.sdkVersion);
console.log('Actions count:', manifest.actions.length);
manifest.actions.forEach(a => {
  console.log('  -', a.slug, ':', a.title, '| contexts:', a.contexts.join(', '));
  if (!a.slug || !a.title || !a.entryPoint || !a.contexts || a.contexts.length === 0) {
    console.error('    ERROR: Missing required field');
    process.exit(1);
  }
});
console.log('Manifest validation passed');
"
```

**Expected**:
- version: 1
- sdkVersion: "1.0.0"
- 5 actions with valid slugs, titles, entryPoints, and contexts arrays

### 5. Built Action File Verification

```bash
cd core/sdk/template
# Verify each action exports a default with required fields
for file in dist/actions/*.js; do
  node --input-type=module -e "
    import action from './$file';
    if (!action.id) throw new Error('Missing id in $file');
    if (!action.title) throw new Error('Missing title in $file');
    if (!action.contexts || !Array.isArray(action.contexts)) throw new Error('Missing/invalid contexts in $file');
    if (typeof action.execute !== 'function') throw new Error('Missing execute function in $file');
    console.log('✓ $file exports valid action:', action.id);
  "
done
```

**Expected**: All 5 action files pass validation.

### 6. SDK Types Interface Check

Create a temporary test file to verify SDK types are properly exposed:

```bash
cd core/sdk/template
cat > /tmp/sdk-type-check.ts << 'EOF'
import { defineAction, QuickActionDefinition, QuickActionExecutionContext, AnvilSDK } from '@anvil/sdk';

// Verify defineAction accepts correct structure
const testAction: QuickActionDefinition = {
  id: 'test',
  title: 'Test',
  contexts: ['thread'],
  execute: async (context: QuickActionExecutionContext, sdk: AnvilSDK) => {
    // Verify context has expected properties
    const _contextType: 'thread' | 'plan' | 'empty' = context.contextType;
    const _threadId: string | undefined = context.threadId;
    const _planId: string | undefined = context.planId;

    // Verify SDK has expected services
    sdk.log.info('test');
    sdk.log.warn('test');
    sdk.log.error('test');
    sdk.log.debug('test');

    await sdk.ui.showToast('test', 'info');
    await sdk.ui.navigateToNextUnread();

    await sdk.threads.archive('id');
    await sdk.threads.markUnread('id');

    await sdk.plans.archive('id');
  }
};

// Verify defineAction returns the definition
const result = defineAction(testAction);
console.log('SDK types verification passed');
EOF

npx tsc --noEmit /tmp/sdk-type-check.ts --esModuleInterop --moduleResolution NodeNext --module NodeNext
rm /tmp/sdk-type-check.ts
```

**Expected**: No TypeScript errors, confirming all SDK interfaces are properly exported.

### 7. Context Array Validation

```bash
cd core/sdk/template
# Verify actions only use valid context values
node -e "
const manifest = require('./dist/manifest.json');
const validContexts = ['thread', 'plan', 'empty', 'all'];
manifest.actions.forEach(a => {
  a.contexts.forEach(ctx => {
    if (!validContexts.includes(ctx)) {
      console.error('Invalid context \"' + ctx + '\" in action ' + a.slug);
      process.exit(1);
    }
  });
});
console.log('All actions use valid context values');
"
```

**Expected**: All contexts are valid per design decision #16.

### 8. Pre-built dist/ Files Verification

After initial build, verify pre-built files can be committed:

```bash
cd core/sdk/template
# Check dist files exist and are valid
test -f dist/manifest.json && echo "✓ manifest.json exists"
test -d dist/actions && echo "✓ actions/ directory exists"
ls dist/actions/*.js | wc -l | xargs -I {} test {} -eq 5 && echo "✓ 5 action files in dist/"
```

**Expected**: Pre-built dist/ contains manifest.json and 5 compiled action files.

### 9. Package.json Script Validation

```bash
cd core/sdk/template
node -e "
const pkg = require('./package.json');
if (pkg.scripts.build !== 'tsx build.ts') throw new Error('build script incorrect');
if (pkg.scripts.watch !== 'tsx build.ts --watch') throw new Error('watch script incorrect');
if (pkg.type !== 'module') throw new Error('type must be module');
if (!pkg.devDependencies.esbuild) throw new Error('missing esbuild');
if (!pkg.devDependencies.tsx) throw new Error('missing tsx');
if (!pkg.devDependencies.typescript) throw new Error('missing typescript');
if (pkg.dependencies && pkg.dependencies['@anvil/sdk']) throw new Error('@anvil/sdk should not be in dependencies');
console.log('package.json validation passed');
"
```

**Expected**: package.json has correct structure per design decision #2 and #4.

### 10. End-to-End Template Copy Test

Simulate the bootstrap process:

```bash
# Create temp directory simulating ~/.anvil/quick-actions/
TEMP_QA=$(mktemp -d)
cp -r core/sdk/template/* "$TEMP_QA/"

cd "$TEMP_QA"
npm install
npm run build

# Verify build succeeds in copied location
test -f dist/manifest.json && echo "✓ Build works in copied location"
rm -rf "$TEMP_QA"
```

**Expected**: Template works correctly when copied to user's quick-actions directory.
