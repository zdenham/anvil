# 04 - SDK Runtime Implementation

## Overview

Implement the SDK runtime that runs in the Node.js process when a quick action executes. This includes the SDK factory, service implementations, and the runner entry point.

**DRY Principle:** This implementation reuses existing adapters and interfaces where possible:
- Git operations delegate to `NodeGitAdapter` from `core/adapters/node/git-adapter.ts`
- Logger interface matches `Logger` from `core/adapters/types.ts`
- New methods (`listBranches`, `getDiff`) are added to the `GitAdapter` interface

## Prerequisites

Before implementing the SDK runtime, the following changes must be made:

### 1. Extend `GitAdapter` interface (`core/adapters/types.ts`)

Add these methods to the `GitAdapter` interface:

```typescript
/**
 * List all local branches in the repository.
 * @param repoPath - Path to the repository
 * @returns Array of branch names
 */
listBranches(repoPath: string): string[];

/**
 * Get the diff between a base commit and HEAD.
 * @param repoPath - Path to the repository
 * @param baseCommit - The base commit to diff from
 * @returns The diff as a string
 */
getDiff(repoPath: string, baseCommit: string): string;

/**
 * Get the HEAD commit hash.
 * @param repoPath - Path to the repository
 * @returns The full commit SHA of HEAD
 */
getHeadCommit(repoPath: string): string;
```

### 2. Implement new methods in `NodeGitAdapter` (`core/adapters/node/git-adapter.ts`)

```typescript
listBranches(repoPath: string): string[] {
  const output = this.exec(['branch', '--format=%(refname:short)'], repoPath);
  return output.split('\n').filter(Boolean);
}

getDiff(repoPath: string, baseCommit: string): string {
  return this.exec(['diff', `${baseCommit}..HEAD`], repoPath);
}

getHeadCommit(repoPath: string): string {
  return this.exec(['rev-parse', 'HEAD'], repoPath);
}
```

## Files to Create

### `core/sdk/runtime/index.ts`

SDK factory that creates the runtime instance:

```typescript
import type { AnvilSDK } from '../types.js';
import { createGitService } from './services/git.js';
import { createThreadService } from './services/threads.js';
import { createPlanService } from './services/plans.js';
import { createUIService } from './services/ui.js';
import { createLogService } from './services/log.js';

export type EmitEvent = (event: string, payload: unknown) => void;

export interface SDKConfig {
  anvilDir: string;
  emitEvent: EmitEvent;
}

export function createSDK(config: SDKConfig): AnvilSDK {
  const { anvilDir, emitEvent } = config;

  return {
    git: createGitService(),
    threads: createThreadService(anvilDir, emitEvent),
    plans: createPlanService(anvilDir, emitEvent),
    ui: createUIService(emitEvent),
    log: createLogService(emitEvent),
  };
}
```

### `core/sdk/runtime/services/git.ts`

Git service implementation that **delegates to `NodeGitAdapter`** for security and DRY:

```typescript
import type { GitService } from '../../types.js';
import { NodeGitAdapter } from '../../../adapters/node/git-adapter.js';

/**
 * Creates a GitService that wraps NodeGitAdapter with async interface.
 *
 * Design notes:
 * - Delegates to NodeGitAdapter for all git operations (DRY)
 * - NodeGitAdapter uses spawnSync with array args (prevents command injection)
 * - Wraps synchronous adapter methods in Promises for SDK's async API
 */
export function createGitService(): GitService {
  const adapter = new NodeGitAdapter();

  return {
    async getCurrentBranch(worktreePath: string): Promise<string | null> {
      return adapter.getCurrentBranch(worktreePath);
    },

    async getDefaultBranch(repoPath: string): Promise<string> {
      return adapter.getDefaultBranch(repoPath);
    },

    async getHeadCommit(repoPath: string): Promise<string> {
      return adapter.getHeadCommit(repoPath);
    },

    async branchExists(repoPath: string, branch: string): Promise<boolean> {
      return adapter.branchExists(repoPath, branch);
    },

    async listBranches(repoPath: string): Promise<string[]> {
      return adapter.listBranches(repoPath);
    },

    async getDiff(repoPath: string, baseCommit: string): Promise<string> {
      return adapter.getDiff(repoPath, baseCommit);
    },
  };
}
```

### `core/sdk/runtime/services/threads.ts`

Thread service that reads from .anvil and emits events for writes:

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ThreadService, ThreadInfo } from '../../types.js';
import type { EmitEvent } from '../index.js';

export function createThreadService(anvilDir: string, emitEvent: EmitEvent): ThreadService {
  const threadsDir = path.join(anvilDir, 'threads');

  async function readThreadMeta(threadId: string): Promise<ThreadInfo | null> {
    try {
      const metaPath = path.join(threadsDir, threadId, 'meta.json');
      const content = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(content);
      return {
        id: threadId,
        repoId: meta.repoId,
        worktreeId: meta.worktreeId,
        status: meta.status,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        isRead: meta.isRead ?? true,
        turnCount: meta.turnCount ?? 0,
      };
    } catch {
      return null;
    }
  }

  return {
    async get(threadId: string): Promise<ThreadInfo | null> {
      return readThreadMeta(threadId);
    },

    async list(): Promise<ThreadInfo[]> {
      try {
        const entries = await fs.readdir(threadsDir, { withFileTypes: true });
        const threads: ThreadInfo[] = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const thread = await readThreadMeta(entry.name);
            if (thread) threads.push(thread);
          }
        }
        return threads;
      } catch {
        return [];
      }
    },

    async getByRepo(repoId: string): Promise<ThreadInfo[]> {
      const all = await this.list();
      return all.filter(t => t.repoId === repoId);
    },

    async getUnread(): Promise<ThreadInfo[]> {
      const all = await this.list();
      return all.filter(t => !t.isRead);
    },

    async archive(threadId: string): Promise<void> {
      emitEvent('thread:archive', { threadId });
    },

    async markRead(threadId: string): Promise<void> {
      emitEvent('thread:markRead', { threadId });
    },

    async markUnread(threadId: string): Promise<void> {
      emitEvent('thread:markUnread', { threadId });
    },
  };
}
```

### `core/sdk/runtime/services/plans.ts`

Plan service that reads from plans-index.json and emits events:

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import type { PlanService, PlanInfo } from '../../types.js';
import type { EmitEvent } from '../index.js';

interface PlansIndexEntry {
  id: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;  // Needed to resolve plan content path
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

export function createPlanService(anvilDir: string, emitEvent: EmitEvent): PlanService {
  const plansIndexPath = path.join(anvilDir, 'plans-index.json');

  async function readPlansIndex(): Promise<Record<string, PlansIndexEntry>> {
    try {
      const content = await fs.readFile(plansIndexPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  function toPlanInfo(entry: PlansIndexEntry): PlanInfo {
    return {
      id: entry.id,
      repoId: entry.repoId,
      worktreeId: entry.worktreeId,
      relativePath: entry.relativePath,
      isRead: entry.isRead,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  return {
    async get(planId: string): Promise<PlanInfo | null> {
      const index = await readPlansIndex();
      const entry = index[planId];
      return entry ? toPlanInfo(entry) : null;
    },

    async list(): Promise<PlanInfo[]> {
      const index = await readPlansIndex();
      return Object.values(index).map(toPlanInfo);
    },

    async getByRepo(repoId: string): Promise<PlanInfo[]> {
      const all = await this.list();
      return all.filter(p => p.repoId === repoId);
    },

    async readContent(planId: string): Promise<string> {
      const index = await readPlansIndex();
      const entry = index[planId];
      if (!entry) {
        throw new Error(`Plan not found: ${planId}`);
      }

      // Plan content is stored in the worktree at relativePath
      const planPath = path.join(entry.worktreePath, entry.relativePath);
      return fs.readFile(planPath, 'utf-8');
    },

    async archive(planId: string): Promise<void> {
      emitEvent('plan:archive', { planId });
    },
  };
}
```

**Note:** The `plans-index.json` schema must include `worktreePath` for each plan entry. If the current schema doesn't include this, it should be added during the index population phase (plan 03 or file watcher implementation).

### `core/sdk/runtime/services/ui.ts`

UI service that emits events for Anvil to handle:

```typescript
import type { UIService } from '../../types.js';
import type { EmitEvent } from '../index.js';

export function createUIService(emitEvent: EmitEvent): UIService {
  return {
    async setInputContent(content: string): Promise<void> {
      emitEvent('ui:setInput', content);
    },

    async appendInputContent(content: string): Promise<void> {
      emitEvent('ui:appendInput', content);
    },

    async clearInput(): Promise<void> {
      emitEvent('ui:clearInput', undefined);
    },

    async focusInput(): Promise<void> {
      emitEvent('ui:focusInput', undefined);
    },

    async navigateToThread(threadId: string): Promise<void> {
      emitEvent('ui:navigate', { type: 'thread', id: threadId });
    },

    async navigateToPlan(planId: string): Promise<void> {
      emitEvent('ui:navigate', { type: 'plan', id: planId });
    },

    async navigateToNextUnread(): Promise<void> {
      emitEvent('ui:navigate', { type: 'nextUnread' });
    },

    async showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void> {
      emitEvent('ui:toast', { message, type: type ?? 'info' });
    },

    async closePanel(): Promise<void> {
      emitEvent('ui:closePanel', undefined);
    },
  };
}
```

### `core/sdk/runtime/services/log.ts`

Log service that routes to Anvil's logger. Interface matches `Logger` from `core/adapters/types.ts`:

```typescript
import type { LogService } from '../../types.js';
import type { EmitEvent } from '../index.js';

/**
 * Creates a LogService that emits log events to Anvil.
 *
 * Design notes:
 * - Interface matches Logger from core/adapters/types.ts (DRY)
 * - Log events are routed to Anvil's main logging infrastructure
 */
export function createLogService(emitEvent: EmitEvent): LogService {
  return {
    info(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'info', message, data });
    },

    warn(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'warn', message, data });
    },

    error(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'error', message, data });
    },

    debug(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'debug', message, data });
    },
  };
}
```

### `core/sdk/runner.ts`

Node entry point for executing actions:

```typescript
#!/usr/bin/env node
import { parseArgs } from 'util';
import { z } from 'zod';
import { createSDK } from './runtime/index.js';

// 30-second timeout as per DD #25
const ACTION_TIMEOUT_MS = 30_000;

// Zod schema for CLI context validation (trust boundary)
const QuickActionExecutionContextSchema = z.object({
  contextType: z.enum(['thread', 'plan', 'empty']),
  threadId: z.string().optional(),
  planId: z.string().optional(),
  repository: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  }).nullable(),
  worktree: z.object({
    id: z.string(),
    path: z.string(),
    branch: z.string().nullable(),
  }).nullable(),
  threadState: z.object({
    status: z.enum(['idle', 'running', 'completed', 'error', 'cancelled']),
    messageCount: z.number(),
    fileChanges: z.array(z.object({
      path: z.string(),
      operation: z.string(),
    })),
  }).optional(),
});

/**
 * Creates a timeout promise that rejects after the specified duration.
 * Used with Promise.race() to enforce action timeout (DD #25).
 */
function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Action timed out after ${ms / 1000} seconds`));
    }, ms);
  });
}

/**
 * Wraps action execution with a timeout using Promise.race().
 * If the action doesn't complete within ACTION_TIMEOUT_MS, the promise rejects.
 * Note: This doesn't kill the action's async operations, but the process will exit
 * with an error, and Anvil (the parent process) should kill this Node process.
 */
async function executeWithTimeout<T>(
  actionPromise: Promise<T>,
  timeoutMs: number = ACTION_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    actionPromise,
    createTimeoutPromise(timeoutMs),
  ]);
}

const { values } = parseArgs({
  options: {
    action: { type: 'string' },    // Path to built JS file
    context: { type: 'string' },   // JSON context
    'anvil-dir': { type: 'string' }, // Path to .anvil directory
  },
});

async function main() {
  const actionPath = values.action;
  const anvilDir = values['anvil-dir'];
  const contextJson = values.context;

  if (!actionPath || !anvilDir || !contextJson) {
    throw new Error('Missing required arguments: --action, --anvil-dir, --context');
  }

  // Validate context from CLI args (trust boundary - requires Zod validation)
  const context = QuickActionExecutionContextSchema.parse(JSON.parse(contextJson));

  // Create SDK with event emitter that writes to stdout
  const sdk = createSDK({
    anvilDir,
    emitEvent: (event, payload) => {
      console.log(JSON.stringify({ event, payload }));
    },
  });

  // Import the pre-built action module
  const module = await import(actionPath);
  const actionDef = module.default;

  if (!actionDef || typeof actionDef.execute !== 'function') {
    throw new Error(`Action must export a default with an 'execute' function`);
  }

  // Execute action with 30-second timeout (DD #25)
  // If the action doesn't complete in time, Promise.race() rejects with timeout error
  await executeWithTimeout(actionDef.execute(context, sdk));
}

main().catch((err) => {
  // Emit error event with specific handling for timeout errors
  const isTimeout = err.message?.includes('timed out');
  console.error(JSON.stringify({
    event: 'error',
    payload: {
      message: err.message,
      isTimeout,
    }
  }));
  process.exit(1);
});
```

## Design Decisions Referenced

- **#10 SDK Communication**: Events emitted via stdout JSON
- **#12 SDK Data Access**: Reads directly from .anvil directory
- **#15 Logging**: Log calls route to Anvil's main logger via events
- **#24 State Sync via Events**: Write operations emit events, Anvil handles disk writes
- **#25 Action Timeout**: 30-second timeout using Promise.race(); Anvil kills process on timeout
- **#33 SDK Write Operations**: SDK emits events only, does NOT write directly to disk

## DRY Implementation Summary

| Service | Reuses | New Code |
|---------|--------|----------|
| Git | `NodeGitAdapter` (all methods) | Async wrapper only |
| Threads | — | Read logic (intentionally separate from frontend store) |
| Plans | — | Read logic (intentionally separate from frontend store) |
| UI | Event names align with `src/entities/events.ts` | Event emission |
| Log | Interface matches `Logger` in `core/adapters/types.ts` | Event emission |

**Why Threads/Plans don't reuse frontend services:**
- Frontend services (`src/entities/threads/service.ts`, `src/entities/plans/service.ts`) are tightly coupled to Zustand stores, optimistic updates, and Tauri
- SDK runs in a separate Node process without access to frontend state
- SDK needs simplified read-only access + event emission for writes
- The file reading logic is simple enough that sharing it would add complexity without benefit

## Acceptance Criteria

- [ ] `GitAdapter` interface extended with `listBranches`, `getDiff`, `getHeadCommit`
- [ ] `NodeGitAdapter` implements the new methods using array-based `exec()`
- [ ] SDK factory creates all services
- [ ] Git service delegates to `NodeGitAdapter` (no duplicate git command implementations)
- [ ] Thread/Plan services read from correct paths
- [ ] Write operations emit events instead of writing directly
- [ ] UI service emits correct event types
- [ ] Runner validates context with Zod
- [ ] Runner imports and executes action correctly
- [ ] Error handling outputs JSON error event
- [ ] Runner enforces 30-second timeout using Promise.race() (DD #25)
- [ ] Timeout errors emit JSON error event with `isTimeout: true` flag
- [ ] Actions completing within 30 seconds execute normally

## Compliance Notes

### Design Decisions Not Yet Addressed

1. **#5 Node.js Detection**: Decision #5 states Anvil should detect if Node.js is missing and provide a helpful error message. This is handled at the Anvil layer (not SDK), but the implementation should be coordinated.

### Schema Requirements

The `plans-index.json` must include `worktreePath` for each plan entry to support `readContent()`. Verify this is included in the index population logic (plan 03 or file watcher).

## Verification & Testing

### TypeScript Compilation Checks

```bash
# Verify all SDK runtime files compile without errors
npx tsc --noEmit

# Or verify specific files
npx tsc --noEmit core/sdk/runtime/index.ts
npx tsc --noEmit core/sdk/runtime/services/git.ts
npx tsc --noEmit core/sdk/runtime/services/threads.ts
npx tsc --noEmit core/sdk/runtime/services/plans.ts
npx tsc --noEmit core/sdk/runtime/services/ui.ts
npx tsc --noEmit core/sdk/runtime/services/log.ts
npx tsc --noEmit core/sdk/runner.ts
```

### Type Interface Verification

Create a test file to verify SDK types are correctly exported and match expected interfaces:

```typescript
// core/sdk/__tests__/sdk-types.test.ts
import type { AnvilSDK, GitService, ThreadService, PlanService, UIService, LogService } from '../types.js';
import { createSDK } from '../runtime/index.js';

// Verify createSDK returns AnvilSDK type
const sdk: AnvilSDK = createSDK({ anvilDir: '/test/.anvil', emitEvent: () => {} });

// Verify all services are present
const git: GitService = sdk.git;
const threads: ThreadService = sdk.threads;
const plans: PlanService = sdk.plans;
const ui: UIService = sdk.ui;
const log: LogService = sdk.log;

// Verify method signatures compile
async function testGitService(git: GitService) {
  const branch: string | null = await git.getCurrentBranch('/path');
  const defaultBranch: string = await git.getDefaultBranch('/path');
  const commit: string = await git.getHeadCommit('/path');
  const exists: boolean = await git.branchExists('/path', 'main');
  const branches: string[] = await git.listBranches('/path');
  const diff: string = await git.getDiff('/path', 'abc123');
}

async function testThreadService(threads: ThreadService) {
  const thread = await threads.get('thread-id');
  const all = await threads.list();
  const byRepo = await threads.getByRepo('repo-id');
  const unread = await threads.getUnread();
  await threads.archive('thread-id');
  await threads.markRead('thread-id');
  await threads.markUnread('thread-id');
}

async function testUIService(ui: UIService) {
  await ui.setInputContent('text');
  await ui.appendInputContent('more');
  await ui.clearInput();
  await ui.focusInput();
  await ui.navigateToThread('thread-id');
  await ui.navigateToPlan('plan-id');
  await ui.navigateToNextUnread();
  await ui.showToast('message', 'success');
  await ui.closePanel();
}

function testLogService(log: LogService) {
  log.info('message');
  log.warn('message', { key: 'value' });
  log.error('message');
  log.debug('message', { count: 1 });
}
```

Run with: `npx tsc --noEmit core/sdk/__tests__/sdk-types.test.ts`

### Unit Tests for Services

```typescript
// core/sdk/__tests__/sdk-runtime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSDK } from '../runtime/index.js';

describe('SDK Runtime', () => {
  describe('createSDK', () => {
    it('creates SDK with all services', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      expect(sdk.git).toBeDefined();
      expect(sdk.threads).toBeDefined();
      expect(sdk.plans).toBeDefined();
      expect(sdk.ui).toBeDefined();
      expect(sdk.log).toBeDefined();
    });
  });

  describe('UI Service Events', () => {
    it('emits ui:setInput event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.ui.setInputContent('test content');

      expect(emitEvent).toHaveBeenCalledWith('ui:setInput', 'test content');
    });

    it('emits ui:navigate event for thread', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.ui.navigateToThread('thread-123');

      expect(emitEvent).toHaveBeenCalledWith('ui:navigate', { type: 'thread', id: 'thread-123' });
    });

    it('emits ui:toast event with default type', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.ui.showToast('Success!');

      expect(emitEvent).toHaveBeenCalledWith('ui:toast', { message: 'Success!', type: 'info' });
    });

    it('emits ui:toast event with explicit type', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.ui.showToast('Error!', 'error');

      expect(emitEvent).toHaveBeenCalledWith('ui:toast', { message: 'Error!', type: 'error' });
    });
  });

  describe('Thread Service Events', () => {
    it('emits thread:archive event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.threads.archive('thread-456');

      expect(emitEvent).toHaveBeenCalledWith('thread:archive', { threadId: 'thread-456' });
    });

    it('emits thread:markRead event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.threads.markRead('thread-789');

      expect(emitEvent).toHaveBeenCalledWith('thread:markRead', { threadId: 'thread-789' });
    });

    it('emits thread:markUnread event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.threads.markUnread('thread-abc');

      expect(emitEvent).toHaveBeenCalledWith('thread:markUnread', { threadId: 'thread-abc' });
    });
  });

  describe('Plan Service Events', () => {
    it('emits plan:archive event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      await sdk.plans.archive('plan-xyz');

      expect(emitEvent).toHaveBeenCalledWith('plan:archive', { planId: 'plan-xyz' });
    });
  });

  describe('Log Service Events', () => {
    it('emits log event with info level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      sdk.log.info('Test message', { key: 'value' });

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'info',
        message: 'Test message',
        data: { key: 'value' }
      });
    });

    it('emits log event with warn level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      sdk.log.warn('Warning message');

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'warn',
        message: 'Warning message',
        data: undefined
      });
    });

    it('emits log event with error level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      sdk.log.error('Error message', { code: 500 });

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'error',
        message: 'Error message',
        data: { code: 500 }
      });
    });

    it('emits log event with debug level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK({ anvilDir: '/test/.anvil', emitEvent });

      sdk.log.debug('Debug message');

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'debug',
        message: 'Debug message',
        data: undefined
      });
    });
  });
});
```

Run with: `npx vitest run core/sdk/__tests__/sdk-runtime.test.ts`

### Git Service Tests (with mocked adapter)

```typescript
// core/sdk/__tests__/git-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGitService } from '../runtime/services/git.js';

// Mock NodeGitAdapter
vi.mock('../../adapters/node/git-adapter.js', () => ({
  NodeGitAdapter: vi.fn().mockImplementation(() => ({
    getCurrentBranch: vi.fn().mockReturnValue('main'),
    getDefaultBranch: vi.fn().mockReturnValue('main'),
    getHeadCommit: vi.fn().mockReturnValue('abc123'),
    branchExists: vi.fn().mockReturnValue(true),
    listBranches: vi.fn().mockReturnValue(['main', 'feature-1', 'feature-2']),
    getDiff: vi.fn().mockReturnValue('diff --git a/file.ts b/file.ts\n...'),
  })),
}));

describe('Git Service', () => {
  it('delegates getCurrentBranch to NodeGitAdapter', async () => {
    const git = createGitService();
    const branch = await git.getCurrentBranch('/path/to/worktree');
    expect(branch).toBe('main');
  });

  it('delegates getDefaultBranch to NodeGitAdapter', async () => {
    const git = createGitService();
    const branch = await git.getDefaultBranch('/path/to/repo');
    expect(branch).toBe('main');
  });

  it('delegates getHeadCommit to NodeGitAdapter', async () => {
    const git = createGitService();
    const commit = await git.getHeadCommit('/path/to/repo');
    expect(commit).toBe('abc123');
  });

  it('delegates branchExists to NodeGitAdapter', async () => {
    const git = createGitService();
    const exists = await git.branchExists('/path/to/repo', 'feature-1');
    expect(exists).toBe(true);
  });

  it('delegates listBranches to NodeGitAdapter', async () => {
    const git = createGitService();
    const branches = await git.listBranches('/path/to/repo');
    expect(branches).toEqual(['main', 'feature-1', 'feature-2']);
  });

  it('delegates getDiff to NodeGitAdapter', async () => {
    const git = createGitService();
    const diff = await git.getDiff('/path/to/repo', 'abc123');
    expect(diff).toContain('diff --git');
  });
});
```

### Integration Test: Runner Execution

```bash
# Create a minimal test action
cat > /tmp/test-action.js << 'EOF'
export default {
  execute: async (context, sdk) => {
    sdk.log.info('Action executed', { contextType: context.contextType });
    await sdk.ui.showToast('Test complete', 'success');
  }
};
EOF

# Run the runner with test context
node core/sdk/runner.js \
  --action /tmp/test-action.js \
  --anvil-dir ~/.anvil \
  --context '{"contextType":"empty","repository":null,"worktree":null}'
```

Expected stdout output (JSON lines):
```json
{"event":"log","payload":{"level":"info","message":"Action executed","data":{"contextType":"empty"}}}
{"event":"ui:toast","payload":{"message":"Test complete","type":"success"}}
```

### Zod Validation Test

```bash
# Test invalid context is rejected
node core/sdk/runner.js \
  --action /tmp/test-action.js \
  --anvil-dir ~/.anvil \
  --context '{"contextType":"invalid"}'

# Expected: Process exits with code 1, stderr contains JSON error about Zod validation
```

### Timeout Test (DD #25)

```bash
# Create a slow action that exceeds the 30-second timeout
cat > /tmp/slow-action.js << 'EOF'
export default {
  execute: async (context, sdk) => {
    sdk.log.info('Starting slow action...');
    // Sleep for 35 seconds (exceeds 30-second timeout)
    await new Promise(resolve => setTimeout(resolve, 35000));
    sdk.log.info('This should never be logged');
  }
};
EOF

# Run the runner - should timeout after 30 seconds
time node core/sdk/runner.js \
  --action /tmp/slow-action.js \
  --anvil-dir ~/.anvil \
  --context '{"contextType":"empty","repository":null,"worktree":null}'

# Expected:
# - Process exits with code 1 after ~30 seconds (not 35)
# - stderr contains: {"event":"error","payload":{"message":"Action timed out after 30 seconds","isTimeout":true}}
```

### Timeout Unit Test

```typescript
// core/sdk/__tests__/sdk-timeout.test.ts
import { describe, it, expect } from 'vitest';

describe('Action Timeout (DD #25)', () => {
  it('completes normally for fast actions', async () => {
    const fastAction = async () => 'done';
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 100)
    );

    const result = await Promise.race([fastAction(), timeoutPromise]);
    expect(result).toBe('done');
  });

  it('rejects with timeout error for slow actions', async () => {
    const slowAction = new Promise((resolve) =>
      setTimeout(() => resolve('done'), 200)
    );
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Action timed out after 30 seconds')), 50)
    );

    await expect(Promise.race([slowAction, timeoutPromise])).rejects.toThrow(
      'Action timed out after 30 seconds'
    );
  });

  it('timeout error includes isTimeout flag in error output', () => {
    const err = new Error('Action timed out after 30 seconds');
    const isTimeout = err.message?.includes('timed out');
    const output = {
      event: 'error',
      payload: { message: err.message, isTimeout }
    };

    expect(output.payload.isTimeout).toBe(true);
    expect(output.event).toBe('error');
  });
});
```

Run with: `npx vitest run core/sdk/__tests__/sdk-timeout.test.ts`

### NodeGitAdapter Extension Tests

```typescript
// core/adapters/__tests__/node-git-adapter.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NodeGitAdapter } from '../node/git-adapter.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('NodeGitAdapter - New Methods', () => {
  let testRepoPath: string;
  let adapter: NodeGitAdapter;

  beforeAll(() => {
    // Create a temporary git repository for testing
    testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-adapter-test-'));
    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@test.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test"', { cwd: testRepoPath });

    // Create initial commit
    fs.writeFileSync(path.join(testRepoPath, 'file.txt'), 'initial content');
    execSync('git add .', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });

    // Create additional branches
    execSync('git branch feature-1', { cwd: testRepoPath });
    execSync('git branch feature-2', { cwd: testRepoPath });

    // Make a change for diff testing
    fs.writeFileSync(path.join(testRepoPath, 'file.txt'), 'modified content');

    adapter = new NodeGitAdapter();
  });

  afterAll(() => {
    fs.rmSync(testRepoPath, { recursive: true, force: true });
  });

  describe('listBranches', () => {
    it('returns all local branches', () => {
      const branches = adapter.listBranches(testRepoPath);
      expect(branches).toContain('master'); // or 'main' depending on git config
      expect(branches).toContain('feature-1');
      expect(branches).toContain('feature-2');
    });
  });

  describe('getHeadCommit', () => {
    it('returns the HEAD commit SHA', () => {
      const commit = adapter.getHeadCommit(testRepoPath);
      expect(commit).toMatch(/^[a-f0-9]{40}$/); // Full SHA
    });
  });

  describe('getDiff', () => {
    it('returns diff between base commit and HEAD', () => {
      const commit = adapter.getHeadCommit(testRepoPath);
      // Get diff of unstaged changes (working tree vs HEAD)
      const diff = adapter.getDiff(testRepoPath, commit);
      // Since we modified file.txt but didn't stage/commit, diff should show change
      expect(diff).toContain('file.txt');
    });
  });
});
```

### Event Format Verification

All emitted events must be valid JSON on a single line. Verify no multiline output:

```bash
node core/sdk/runner.js \
  --action /tmp/test-action.js \
  --anvil-dir ~/.anvil \
  --context '{"contextType":"empty","repository":null,"worktree":null}' \
  | while read line; do
    echo "$line" | jq . > /dev/null || echo "INVALID JSON: $line"
  done
```

## Implementation Checklist

### Prerequisites (do first)
1. [ ] Add `listBranches(repoPath: string): string[]` to `GitAdapter` interface in `core/adapters/types.ts`
2. [ ] Add `getDiff(repoPath: string, baseCommit: string): string` to `GitAdapter` interface
3. [ ] Add `getHeadCommit(repoPath: string): string` to `GitAdapter` interface
4. [ ] Implement `listBranches` in `NodeGitAdapter` using `['branch', '--format=%(refname:short)']`
5. [ ] Implement `getDiff` in `NodeGitAdapter` using `['diff', '${baseCommit}..HEAD']`
6. [ ] Implement `getHeadCommit` in `NodeGitAdapter` using `['rev-parse', 'HEAD']`
7. [ ] Verify `plans-index.json` schema includes `worktreePath` field

### SDK Runtime Files
8. [ ] Create `core/sdk/runtime/index.ts` with `createSDK` factory
9. [ ] Create `core/sdk/runtime/services/git.ts` that delegates to `NodeGitAdapter`
10. [ ] Create `core/sdk/runtime/services/threads.ts` with file reading + event emission
11. [ ] Create `core/sdk/runtime/services/plans.ts` with file reading + event emission
12. [ ] Create `core/sdk/runtime/services/ui.ts` with event emission
13. [ ] Create `core/sdk/runtime/services/log.ts` with event emission
14. [ ] Create `core/sdk/runner.ts` with Zod validation and timeout handling

### Verification
15. [ ] All files compile with `tsc --noEmit`
16. [ ] `createSDK` returns object with all 5 services
17. [ ] Git service methods delegate to `NodeGitAdapter` (no shell string interpolation)
18. [ ] Thread service reads from `{anvilDir}/threads/{threadId}/meta.json`
19. [ ] Plan service reads from `{anvilDir}/plans-index.json`
20. [ ] Plan `readContent` reads from `{worktreePath}/{relativePath}`
21. [ ] UI service methods emit correct event names
22. [ ] Thread/Plan service write methods emit correct events
23. [ ] Log service emits `log` event with level, message, and optional data
24. [ ] Runner validates context with Zod and rejects invalid input
25. [ ] Runner outputs JSON error event on failure and exits with code 1
26. [ ] Runner enforces 30-second timeout using `Promise.race()` (DD #25)
27. [ ] Timeout errors include `isTimeout: true` flag in error payload
