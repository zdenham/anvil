# 02 - SDK Type Definitions

## Overview

Create the SDK type definitions that users import when writing quick actions. These types define the context passed to actions and the services available via the SDK.

## Files to Create

### `core/sdk/types.ts`

```typescript
// ═══════════════════════════════════════════════════════════════════
// Context passed to quick action scripts
// ═══════════════════════════════════════════════════════════════════

// Note: Named "ExecutionContext" to avoid collision with QuickActionContext enum
export interface QuickActionExecutionContext {
  /** The context type where this action was invoked */
  contextType: 'thread' | 'plan' | 'empty';

  /** Current thread ID (if in thread context) */
  threadId?: string;

  /** Current plan ID (if in plan context) */
  planId?: string;

  /** Active repository info */
  repository: {
    id: string;
    name: string;
    path: string;
  } | null;

  /** Active worktree info */
  worktree: {
    id: string;
    path: string;
    branch: string | null;
  } | null;

  /** Current thread state (if thread context) */
  threadState?: {
    status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
    messageCount: number;
    fileChanges: Array<{ path: string; operation: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SDK Services available to quick actions
// ═══════════════════════════════════════════════════════════════════

export interface AnvilSDK {
  /** Git operations */
  git: GitService;

  /** Thread operations */
  threads: ThreadService;

  /** Plan operations */
  plans: PlanService;

  /** UI control */
  ui: UIService;

  /** Logging */
  log: LogService;
}

export interface GitService {
  /** Get current branch */
  getCurrentBranch(worktreePath: string): Promise<string | null>;

  /** Get default branch (main/master) */
  getDefaultBranch(repoPath: string): Promise<string>;

  /** Get HEAD commit */
  getHeadCommit(repoPath: string): Promise<string>;

  /** Check if branch exists */
  branchExists(repoPath: string, branch: string): Promise<boolean>;

  /** List all branches */
  listBranches(repoPath: string): Promise<string[]>;

  /** Get diff from base commit */
  getDiff(repoPath: string, baseCommit: string): Promise<string>;
}

export interface ThreadService {
  /** Get thread metadata */
  get(threadId: string): Promise<ThreadInfo | null>;

  /** List all threads */
  list(): Promise<ThreadInfo[]>;

  /** Get threads for repository */
  getByRepo(repoId: string): Promise<ThreadInfo[]>;

  /** Get unread threads */
  getUnread(): Promise<ThreadInfo[]>;

  /** Archive a thread */
  archive(threadId: string): Promise<void>;

  /** Mark thread as read/unread */
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
  /** Get plan metadata */
  get(planId: string): Promise<PlanInfo | null>;

  /** List all plans */
  list(): Promise<PlanInfo[]>;

  /** Get plans for repository */
  getByRepo(repoId: string): Promise<PlanInfo[]>;

  /** Read plan content (markdown) */
  readContent(planId: string): Promise<string>;

  /** Archive a plan */
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
  /** Set the content of the input field */
  setInputContent(content: string): Promise<void>;

  /** Append content to the input field */
  appendInputContent(content: string): Promise<void>;

  /** Clear the input field */
  clearInput(): Promise<void>;

  /** Focus the input field */
  focusInput(): Promise<void>;

  /** Navigate to a thread */
  navigateToThread(threadId: string): Promise<void>;

  /** Navigate to a plan */
  navigateToPlan(planId: string): Promise<void>;

  /**
   * Navigate to next unread item.
   * If no unread items exist, navigates to empty state (closes current view).
   */
  navigateToNextUnread(): Promise<void>;

  /** Show a toast notification */
  showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void>;

  /** Close current panel (navigate to empty state) */
  closePanel(): Promise<void>;
}

export interface LogService {
  /** Log info message */
  info(message: string, data?: Record<string, unknown>): void;

  /** Log warning */
  warn(message: string, data?: Record<string, unknown>): void;

  /** Log error */
  error(message: string, data?: Record<string, unknown>): void;

  /** Log debug (only in dev) */
  debug(message: string, data?: Record<string, unknown>): void;
}

// ═══════════════════════════════════════════════════════════════════
// Quick Action Definition
// ═══════════════════════════════════════════════════════════════════

export type QuickActionFn = (
  context: QuickActionExecutionContext,
  sdk: AnvilSDK
) => Promise<void> | void;

export interface QuickActionDefinition {
  /** Unique ID within the project (slug) */
  id: string;

  /** Display title */
  title: string;

  /** Optional description */
  description?: string;

  /** Contexts where this action is available */
  contexts: ('thread' | 'plan' | 'empty' | 'all')[];

  /** The action implementation */
  execute: QuickActionFn;
}

/** Helper to define a quick action with type safety */
export function defineAction(def: QuickActionDefinition): QuickActionDefinition {
  return def;
}
```

## Design Decisions Referenced

- **#10 SDK Communication**: Bidirectional IPC via stdin/stdout JSON messaging
- **#12 SDK Data Access**: SDK reads directly from disk using shared transformers
- **#15 Logging**: SDK log calls route to Anvil's main logger
- **#16 Context Scope**: The 'all' context means thread, plan, and empty views
- **#29 navigateToNextUnread() Empty Case**: Navigates to empty state if no unread items

## Acceptance Criteria

- [ ] All interfaces are properly typed
- [ ] `defineAction` helper provides full type safety
- [ ] Types match the runtime SDK implementation
- [ ] JSDoc comments explain each method's behavior

## Design Decision Compliance Notes

**Verified Compliance:**
- #10 SDK Communication: Types define IPC-based services correctly
- #12 SDK Data Access: Types support read operations from disk
- #15 Logging: LogService interface routes to Anvil's logger
- #16 Context Scope: 'all' in contexts array expands to thread/plan/empty
- #22 SDK Types Distribution: This file ships as `types.d.ts`
- #24/#33 SDK Write Operations: Write methods (`archive`, `markRead`, `markUnread`) return `Promise<void>` - the implementation must emit events to Anvil rather than writing directly to disk

**Implementation Reminders:**
- Per #24 and #33: Write operations (archive, markRead, markUnread) must emit stdout events, not write to disk directly
- Per #13: Consider adding SDK version export for version checking

**Asymmetry Note:**
- `QuickActionExecutionContext.contextType` is `'thread' | 'plan' | 'empty'` (runtime value)
- `QuickActionDefinition.contexts` includes `'all'` (registration shorthand)
- This is intentional: 'all' is expanded at registration time, never appears at runtime

## Verification & Testing

The implementation agent should run these checks to verify the types are correctly implemented.

### 1. TypeScript Compilation Check

Create a test file to verify types compile without errors:

```bash
# From the project root, create a temporary type check file
cat > /tmp/sdk-type-check.ts << 'EOF'
import type {
  QuickActionExecutionContext,
  AnvilSDK,
  GitService,
  ThreadService,
  ThreadInfo,
  PlanService,
  PlanInfo,
  UIService,
  LogService,
  QuickActionFn,
  QuickActionDefinition,
  defineAction
} from './core/sdk/types';

// Verify QuickActionExecutionContext structure
const ctx: QuickActionExecutionContext = {
  contextType: 'thread',
  threadId: '123',
  repository: { id: 'r1', name: 'test', path: '/path' },
  worktree: { id: 'w1', path: '/path', branch: 'main' },
  threadState: {
    status: 'idle',
    messageCount: 0,
    fileChanges: [{ path: '/a.ts', operation: 'modify' }]
  }
};

// Verify optional fields work
const emptyCtx: QuickActionExecutionContext = {
  contextType: 'empty',
  repository: null,
  worktree: null
};

// Verify QuickActionFn signature
const actionFn: QuickActionFn = async (context, sdk) => {
  // SDK services should be typed
  const branch = await sdk.git.getCurrentBranch('/path');
  const thread = await sdk.threads.get('123');
  const plan = await sdk.plans.get('456');
  await sdk.ui.setInputContent('test');
  sdk.log.info('message', { key: 'value' });
};

// Verify defineAction helper works
const action = defineAction({
  id: 'test-action',
  title: 'Test Action',
  description: 'Optional description',
  contexts: ['thread', 'plan', 'empty'],
  execute: async (context, sdk) => {
    await sdk.ui.showToast('Hello', 'success');
  }
});

// Verify 'all' context is valid
const allContextAction = defineAction({
  id: 'global-action',
  title: 'Global',
  contexts: ['all'],
  execute: () => {}
});

// Verify ThreadInfo and PlanInfo structures
const threadInfo: ThreadInfo = {
  id: '1',
  repoId: 'r1',
  worktreeId: 'w1',
  status: 'completed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isRead: true,
  turnCount: 5
};

const planInfo: PlanInfo = {
  id: '1',
  repoId: 'r1',
  worktreeId: 'w1',
  relativePath: 'plans/test.md',
  isRead: false,
  createdAt: Date.now(),
  updatedAt: Date.now()
};

console.log('Type check passed');
EOF

# Run TypeScript compiler in check mode
npx tsc --noEmit --strict /tmp/sdk-type-check.ts --moduleResolution node --esModuleInterop
```

**Expected Output:** No errors, exit code 0.

### 2. Verify All Exports Exist

```bash
# Check that the types file exports all required interfaces
cat > /tmp/export-check.ts << 'EOF'
// This file tests that all documented exports are available
import {
  // Core context
  QuickActionExecutionContext,

  // SDK main interface
  AnvilSDK,

  // Services
  GitService,
  ThreadService,
  PlanService,
  UIService,
  LogService,

  // Data types
  ThreadInfo,
  PlanInfo,

  // Action definition
  QuickActionFn,
  QuickActionDefinition,
  defineAction
} from './core/sdk/types';

// Ensure defineAction is a function, not just a type
const fn: typeof defineAction = defineAction;
EOF

npx tsc --noEmit --strict /tmp/export-check.ts --moduleResolution node --esModuleInterop
```

**Expected Output:** No errors, exit code 0.

### 3. Verify Interface Method Signatures

```bash
# Test specific method signatures match design
cat > /tmp/method-check.ts << 'EOF'
import type { GitService, ThreadService, PlanService, UIService } from './core/sdk/types';

// GitService methods
type GitGetCurrentBranch = GitService['getCurrentBranch'];
const _g1: (worktreePath: string) => Promise<string | null> = null as unknown as GitGetCurrentBranch;

type GitGetDiff = GitService['getDiff'];
const _g2: (repoPath: string, baseCommit: string) => Promise<string> = null as unknown as GitGetDiff;

// ThreadService write operations (should return Promise<void>)
type ThreadArchive = ThreadService['archive'];
const _t1: (threadId: string) => Promise<void> = null as unknown as ThreadArchive;

type ThreadMarkRead = ThreadService['markRead'];
const _t2: (threadId: string) => Promise<void> = null as unknown as ThreadMarkRead;

// PlanService
type PlanReadContent = PlanService['readContent'];
const _p1: (planId: string) => Promise<string> = null as unknown as PlanReadContent;

// UIService - verify navigateToNextUnread exists
type UINavigateNext = UIService['navigateToNextUnread'];
const _u1: () => Promise<void> = null as unknown as UINavigateNext;

// UIService - showToast signature
type UIShowToast = UIService['showToast'];
const _u2: (message: string, type?: 'info' | 'success' | 'error') => Promise<void> = null as unknown as UIShowToast;

console.log('Method signatures verified');
EOF

npx tsc --noEmit --strict /tmp/method-check.ts --moduleResolution node --esModuleInterop
```

**Expected Output:** No errors, exit code 0.

### 4. Negative Tests (Should Fail to Compile)

These tests verify that invalid usage is caught at compile time:

```bash
# Test that invalid context type is rejected
cat > /tmp/invalid-context.ts << 'EOF'
import type { QuickActionExecutionContext } from './core/sdk/types';

const ctx: QuickActionExecutionContext = {
  contextType: 'settings', // Invalid! Should be 'thread' | 'plan' | 'empty'
  repository: null,
  worktree: null
};
EOF

npx tsc --noEmit --strict /tmp/invalid-context.ts --moduleResolution node --esModuleInterop 2>&1 || echo "Expected failure - invalid context type rejected"
```

**Expected Output:** TypeScript error about invalid contextType literal.

```bash
# Test that invalid thread status is rejected
cat > /tmp/invalid-status.ts << 'EOF'
import type { ThreadInfo } from './core/sdk/types';

const thread: ThreadInfo = {
  id: '1',
  repoId: 'r1',
  worktreeId: 'w1',
  status: 'pending', // Invalid! Not in union type
  createdAt: 0,
  updatedAt: 0,
  isRead: true,
  turnCount: 0
};
EOF

npx tsc --noEmit --strict /tmp/invalid-status.ts --moduleResolution node --esModuleInterop 2>&1 || echo "Expected failure - invalid status rejected"
```

**Expected Output:** TypeScript error about invalid status literal.

### 5. Runtime Verification (After Implementation)

Once the types file exists at `core/sdk/types.ts`:

```bash
# Verify file exists
test -f core/sdk/types.ts && echo "types.ts exists" || echo "ERROR: types.ts not found"

# Verify it can be imported as a module
node -e "require('./core/sdk/types')" 2>/dev/null || echo "Note: File is types-only, no runtime exports expected"

# Check JSDoc comments exist for key interfaces
grep -c "@" core/sdk/types.ts | xargs -I {} test {} -gt 10 && echo "JSDoc comments present" || echo "WARNING: Few JSDoc comments found"
```

### 6. Integration Check

After implementation, verify types integrate with the default quick actions project:

```bash
# Navigate to default project and build
cd ~/.anvil/quick-actions
npm run build

# Verify the build succeeds and manifest is valid
test -f dist/manifest.json && echo "Manifest generated" || echo "ERROR: No manifest"
node -e "JSON.parse(require('fs').readFileSync('dist/manifest.json'))" && echo "Manifest is valid JSON" || echo "ERROR: Invalid manifest"
```

**Expected Output:** Build succeeds, manifest.json exists and is valid JSON.

### Checklist for Implementation Agent

- [ ] Run `npx tsc --noEmit` on the types file with `--strict` flag
- [ ] Verify all 12 exports are present and correctly typed
- [ ] Verify `defineAction` is exported as a value (function), not just a type
- [ ] Verify JSDoc comments on all public interfaces and methods
- [ ] Test that a sample quick action using all SDK services compiles
- [ ] Verify negative tests fail as expected (invalid types are rejected)