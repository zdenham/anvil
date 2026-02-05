# 03 - SDK Distribution Package

## Overview

Create the SDK package files that get copied to `~/.mort/quick-actions/node_modules/@mort/sdk/`. This enables standard TypeScript resolution for user projects.

## Files to Create

### `core/sdk/dist/package.json`

```json
{
  "name": "@mort/sdk",
  "version": "1.0.0",
  "types": "index.d.ts",
  "main": "index.js",
  "type": "module"
}
```

### `core/sdk/dist/index.d.ts`

This file contains all the type definitions from `02-sdk-types.md`, exported for user consumption:

```typescript
// ═══════════════════════════════════════════════════════════════════
// Context passed to quick action scripts
// ═══════════════════════════════════════════════════════════════════

export interface QuickActionExecutionContext {
  contextType: 'thread' | 'plan' | 'empty';
  threadId?: string;
  planId?: string;
  repository: {
    id: string;
    name: string;
    path: string;
  } | null;
  worktree: {
    id: string;
    path: string;
    branch: string | null;
  } | null;
  threadState?: {
    status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
    messageCount: number;
    fileChanges: Array<{ path: string; operation: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SDK Services
// ═══════════════════════════════════════════════════════════════════

export interface MortSDK {
  git: GitService;
  threads: ThreadService;
  plans: PlanService;
  ui: UIService;
  log: LogService;
}

export interface GitService {
  getCurrentBranch(worktreePath: string): Promise<string | null>;
  getDefaultBranch(repoPath: string): Promise<string>;
  getHeadCommit(repoPath: string): Promise<string>;
  branchExists(repoPath: string, branch: string): Promise<boolean>;
  listBranches(repoPath: string): Promise<string[]>;
  getDiff(repoPath: string, baseCommit: string): Promise<string>;
}

export interface ThreadService {
  get(threadId: string): Promise<ThreadInfo | null>;
  list(): Promise<ThreadInfo[]>;
  getByRepo(repoId: string): Promise<ThreadInfo[]>;
  getUnread(): Promise<ThreadInfo[]>;
  archive(threadId: string): Promise<void>;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
}

export interface ThreadInfo {
  id: string;
  repoId: string;
  worktreeId: string;
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  isRead: boolean;
  turnCount: number;
}

export interface PlanService {
  get(planId: string): Promise<PlanInfo | null>;
  list(): Promise<PlanInfo[]>;
  getByRepo(repoId: string): Promise<PlanInfo[]>;
  readContent(planId: string): Promise<string>;
  archive(planId: string): Promise<void>;
}

export interface PlanInfo {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UIService {
  setInputContent(content: string): Promise<void>;
  appendInputContent(content: string): Promise<void>;
  clearInput(): Promise<void>;
  focusInput(): Promise<void>;
  navigateToThread(threadId: string): Promise<void>;
  navigateToPlan(planId: string): Promise<void>;
  navigateToNextUnread(): Promise<void>;
  showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void>;
  closePanel(): Promise<void>;
}

export interface LogService {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

// ═══════════════════════════════════════════════════════════════════
// Quick Action Definition
// ═══════════════════════════════════════════════════════════════════

export type QuickActionFn = (
  context: QuickActionExecutionContext,
  sdk: MortSDK
) => Promise<void> | void;

export interface QuickActionDefinition {
  id: string;
  title: string;
  description?: string;
  contexts: ('thread' | 'plan' | 'empty' | 'all')[];
  execute: QuickActionFn;
}

export function defineAction(def: QuickActionDefinition): QuickActionDefinition;
```

### `core/sdk/dist/index.js`

Minimal runtime that exports only `defineAction`:

```javascript
/**
 * Helper to define a quick action with type safety.
 * This is a pass-through function - the actual SDK is injected at runtime.
 * @param {import('./index').QuickActionDefinition} def
 * @returns {import('./index').QuickActionDefinition}
 */
export function defineAction(def) {
  return def;
}
```

## How It Works

1. **At development time**: Users get TypeScript autocomplete and type checking via `index.d.ts`
2. **At build time**: User's bundler (esbuild) marks `@mort/sdk` as external
3. **At runtime**: Mort's runner imports the user's action and passes the real SDK implementation

User code:
```typescript
import { defineAction } from '@mort/sdk';
import type { QuickActionExecutionContext, MortSDK } from '@mort/sdk';

export default defineAction({
  id: 'my-action',
  title: 'My Action',
  contexts: ['thread'],
  execute(context: QuickActionExecutionContext, sdk: MortSDK) {
    // sdk is injected at runtime by Mort's runner
  }
});
```

## Design Decisions Referenced

- **#4 SDK Distribution**: Types shipped as static .d.ts file, implementation injected at runtime
- **#22 SDK Types Distribution**: User projects never import real SDK code, only type definitions

## Acceptance Criteria

- [ ] Package.json is valid and points to correct files
- [ ] index.d.ts contains all exported types
- [ ] index.js exports only the `defineAction` helper
- [ ] TypeScript resolution works when copied to node_modules/@mort/sdk/
- [ ] User can import types and defineAction without errors

## Verification & Testing

### 1. TypeScript Compilation Check

Create a temporary test file to verify the types compile correctly:

```bash
# From the core/sdk/dist directory, create a test file
cat > /tmp/sdk-type-test.ts << 'EOF'
import { defineAction } from '@mort/sdk';
import type {
  QuickActionExecutionContext,
  MortSDK,
  QuickActionDefinition,
  GitService,
  ThreadService,
  PlanService,
  UIService,
  LogService,
  ThreadInfo,
  PlanInfo,
  QuickActionFn
} from '@mort/sdk';

// Verify QuickActionExecutionContext shape
const ctx: QuickActionExecutionContext = {
  contextType: 'thread',
  threadId: 'test-123',
  repository: { id: 'repo-1', name: 'test-repo', path: '/path/to/repo' },
  worktree: { id: 'wt-1', path: '/path/to/worktree', branch: 'main' },
  threadState: {
    status: 'idle',
    messageCount: 5,
    fileChanges: [{ path: '/file.ts', operation: 'modified' }]
  }
};

// Verify MortSDK service interfaces exist
type GitCheck = GitService['getCurrentBranch'];
type ThreadCheck = ThreadService['archive'];
type PlanCheck = PlanService['readContent'];
type UICheck = UIService['showToast'];
type LogCheck = LogService['info'];

// Verify defineAction returns QuickActionDefinition
const action: QuickActionDefinition = defineAction({
  id: 'test-action',
  title: 'Test Action',
  contexts: ['thread', 'plan', 'empty'],
  execute: async (context, sdk) => {
    // Verify context and sdk types are inferred correctly
    const type: 'thread' | 'plan' | 'empty' = context.contextType;
    await sdk.ui.showToast('Hello', 'success');
    sdk.log.info('test message', { key: 'value' });
  }
});

// Verify 'all' context is valid
const allContextAction = defineAction({
  id: 'all-context',
  title: 'All Contexts',
  contexts: ['all'],
  execute: () => {}
});

console.log('Type check passed');
EOF

# Run TypeScript compiler (must have @mort/sdk in node_modules)
npx tsc --noEmit --strict --moduleResolution node /tmp/sdk-type-test.ts
```

**Expected result**: No TypeScript errors. Exit code 0.

### 2. Package.json Validation

```bash
# Verify package.json is valid JSON and has required fields
node -e "
const pkg = require('./core/sdk/dist/package.json');
const required = ['name', 'version', 'types', 'main', 'type'];
const missing = required.filter(f => !pkg[f]);
if (missing.length) {
  console.error('Missing fields:', missing);
  process.exit(1);
}
if (pkg.name !== '@mort/sdk') {
  console.error('Package name must be @mort/sdk');
  process.exit(1);
}
if (pkg.types !== 'index.d.ts') {
  console.error('types must point to index.d.ts');
  process.exit(1);
}
if (pkg.main !== 'index.js') {
  console.error('main must point to index.js');
  process.exit(1);
}
if (pkg.type !== 'module') {
  console.error('type must be module for ESM');
  process.exit(1);
}
console.log('package.json valid');
"
```

**Expected result**: "package.json valid" printed. Exit code 0.

### 3. Runtime JavaScript Validation

```bash
# Verify index.js is valid ESM and exports defineAction
node --input-type=module -e "
import { defineAction } from './core/sdk/dist/index.js';

// Verify defineAction is a function
if (typeof defineAction !== 'function') {
  console.error('defineAction must be a function');
  process.exit(1);
}

// Verify it returns the same object passed in (pass-through)
const input = { id: 'test', title: 'Test', contexts: ['thread'], execute: () => {} };
const output = defineAction(input);
if (output !== input) {
  console.error('defineAction must return the input unchanged');
  process.exit(1);
}

console.log('index.js valid');
"
```

**Expected result**: "index.js valid" printed. Exit code 0.

### 4. Type Definition Completeness Check

```bash
# Verify all required exports exist in index.d.ts
grep -E "^export (interface|type|function)" core/sdk/dist/index.d.ts | sort
```

**Expected exports** (verify these are all present):
- `export function defineAction`
- `export interface GitService`
- `export interface LogService`
- `export interface MortSDK`
- `export interface PlanInfo`
- `export interface PlanService`
- `export interface QuickActionDefinition`
- `export interface QuickActionExecutionContext`
- `export interface ThreadInfo`
- `export interface ThreadService`
- `export interface UIService`
- `export type QuickActionFn`

### 5. Node Modules Resolution Test

```bash
# Simulate the user's environment by copying to node_modules
mkdir -p /tmp/sdk-test/node_modules/@mort/sdk
cp core/sdk/dist/* /tmp/sdk-test/node_modules/@mort/sdk/

# Create a minimal tsconfig
cat > /tmp/sdk-test/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true
  }
}
EOF

# Create test file that imports like a user would
cat > /tmp/sdk-test/test.ts << 'EOF'
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'user-action',
  title: 'User Action',
  contexts: ['thread'],
  execute: async (ctx, sdk) => {
    if (ctx.contextType === 'thread' && ctx.threadId) {
      await sdk.threads.markRead(ctx.threadId);
      await sdk.ui.showToast('Marked as read');
    }
  }
});
EOF

# Run tsc from the test directory
cd /tmp/sdk-test && npx tsc --noEmit
```

**Expected result**: No errors. Exit code 0.

### 6. Design Decision Compliance Checks

Manual verification checklist:

- [ ] **#4 SDK Distribution**: Confirm `index.d.ts` contains types only (no implementation logic)
- [ ] **#22 SDK Types Distribution**: Confirm `index.js` only exports `defineAction` helper, no SDK implementation
- [ ] **#13 SDK Versioning**: Verify `package.json` has a `version` field that can be read by Mort
- [ ] **#5 Runtime Dependency**: Verify `index.js` is vanilla JavaScript (no TypeScript, no tsx required)

### 7. ESM Import Syntax Check

```bash
# Verify the JS file uses ESM syntax (export, not module.exports)
if grep -q "module.exports" core/sdk/dist/index.js; then
  echo "ERROR: index.js must use ESM exports, not CommonJS"
  exit 1
fi

if grep -q "^export " core/sdk/dist/index.js; then
  echo "ESM exports found - correct"
else
  echo "ERROR: No ESM exports found in index.js"
  exit 1
fi
```

**Expected result**: "ESM exports found - correct" printed.
