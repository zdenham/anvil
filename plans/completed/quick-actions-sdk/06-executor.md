# 06 - Quick Action Executor

## Overview

Implement the executor that spawns Node.js processes to run quick actions and handles SDK events from stdout.

## Files to Create

### `src/lib/quick-action-executor.ts`

```typescript
import { Command, Child } from '@tauri-apps/plugin-shell';
import { z } from 'zod';
import type { ResolvedQuickAction } from '@/entities/quick-actions/types.js';
import { threadService } from '@/entities/threads/service.js';
import { planService } from '@/entities/plans/service.js';
import { treeMenuService } from '@/stores/tree-menu/service.js';
import { useInputStore } from '@/stores/input-store.js';
import { toast } from '@/components/ui/toast.js';
import { logger } from '@/lib/logger.js';
import { getMortDir, getRunnerPath } from '@/lib/paths.js';
import * as path from 'path';

const ACTION_TIMEOUT_MS = 30_000; // 30 seconds

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

export interface QuickActionResult {
  success: boolean;
  error?: { message: string; stack?: string };
  timedOut?: boolean;
}

// Zod schema for SDK events (trust boundary - IPC from child process)
const SDKEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('ui:setInput'),
    payload: z.string(),
  }),
  z.object({
    event: z.literal('ui:appendInput'),
    payload: z.string(),
  }),
  z.object({
    event: z.literal('ui:clearInput'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('ui:focusInput'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('ui:navigate'),
    payload: z.object({
      type: z.enum(['thread', 'plan', 'nextUnread', 'empty']),
      id: z.string().optional(),
    }),
  }),
  z.object({
    event: z.literal('ui:toast'),
    payload: z.object({
      message: z.string(),
      type: z.enum(['info', 'success', 'error']).optional(),
    }),
  }),
  z.object({
    event: z.literal('ui:closePanel'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('thread:archive'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('thread:markRead'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('thread:markUnread'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('plan:archive'),
    payload: z.object({ planId: z.string() }),
  }),
  z.object({
    event: z.literal('log'),
    payload: z.object({
      level: z.enum(['info', 'warn', 'error', 'debug']),
      message: z.string(),
      data: z.record(z.unknown()).optional(),
    }),
  }),
  z.object({
    event: z.literal('error'),
    payload: z.string(),
  }),
]);

type SDKEvent = z.infer<typeof SDKEventSchema>;

export async function executeQuickAction(
  action: ResolvedQuickAction,
  execContext: QuickActionExecutionContext
): Promise<QuickActionResult> {
  const mortDir = await getMortDir();
  const runnerPath = await getRunnerPath();

  // Resolve path to the built JS file
  const actionJsPath = path.join(action.projectPath, 'dist', action.entryPoint);

  // Spawn Node process (running pre-built JS)
  const command = Command.create('node', [
    runnerPath,
    '--action', actionJsPath,
    '--context', JSON.stringify(execContext),
    '--mort-dir', mortDir,
  ]);

  let child: Child;
  let errorOutput = '';

  // Handle stdout events from SDK
  command.stdout.on('data', (line) => {
    try {
      const parsed = JSON.parse(line);
      const result = SDKEventSchema.safeParse(parsed);
      if (result.success) {
        handleSDKEvent(result.data);
      }
    } catch {
      // Not JSON, ignore (could be console.log from user action)
    }
  });

  // Capture stderr for error reporting
  command.stderr.on('data', (line) => {
    errorOutput += line + '\n';
  });

  // Execute with timeout
  const executionPromise = new Promise<QuickActionResult>((resolve) => {
    command.on('close', (data) => {
      if (data.code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: { message: errorOutput || 'Action failed', stack: errorOutput },
        });
      }
    });

    command.on('error', (err) => {
      resolve({
        success: false,
        error: { message: err.message },
      });
    });
  });

  const timeoutPromise = new Promise<QuickActionResult>((resolve) => {
    setTimeout(() => {
      resolve({
        success: false,
        timedOut: true,
        error: { message: 'Action timed out after 30 seconds' }
      });
    }, ACTION_TIMEOUT_MS);
  });

  child = await command.spawn();

  const result = await Promise.race([executionPromise, timeoutPromise]);

  // Kill process if it timed out
  if (result.timedOut) {
    await child.kill();
  }

  return result;
}

async function handleSDKEvent(event: SDKEvent): Promise<void> {
  switch (event.event) {
    // Entity operations - call services (writes to disk, emits through event-bridge)
    case 'thread:archive':
      await threadService.archive(event.payload.threadId);
      break;
    case 'thread:markRead':
      await threadService.markRead(event.payload.threadId);
      break;
    case 'thread:markUnread':
      await threadService.markUnread(event.payload.threadId);
      break;
    case 'plan:archive':
      await planService.archive(event.payload.planId);
      break;

    // UI operations - handled locally (no disk persistence needed)
    case 'ui:setInput':
      useInputStore.getState().setContent(event.payload);
      break;
    case 'ui:appendInput':
      useInputStore.getState().appendContent(event.payload);
      break;
    case 'ui:clearInput':
      useInputStore.getState().clearContent();
      break;
    case 'ui:focusInput':
      useInputStore.getState().requestFocus();
      break;
    case 'ui:navigate':
      await handleNavigation(event.payload);
      break;
    case 'ui:toast':
      toast[event.payload.type ?? 'info'](event.payload.message);
      break;
    case 'ui:closePanel':
      await treeMenuService.setSelectedItem(null);
      break;

    // Logging - route to main logger
    case 'log':
      logger[event.payload.level](event.payload.message, event.payload.data);
      break;

    // Error from action
    case 'error':
      logger.error('Quick action error:', { message: event.payload });
      break;
  }
}

async function handleNavigation(payload: { type: string; id?: string }): Promise<void> {
  switch (payload.type) {
    case 'thread':
      if (payload.id) await treeMenuService.setSelectedItem(payload.id);
      break;
    case 'plan':
      if (payload.id) await treeMenuService.setSelectedItem(payload.id);
      break;
    case 'nextUnread':
      const nextItem = await findNextUnreadItem();
      if (nextItem) {
        await treeMenuService.setSelectedItem(nextItem.id);
      } else {
        await treeMenuService.setSelectedItem(null); // Navigate to empty state
      }
      break;
    case 'empty':
      await treeMenuService.setSelectedItem(null);
      break;
  }
}

async function findNextUnreadItem(): Promise<{ id: string; type: 'thread' | 'plan' } | null> {
  // Check threads first
  const unreadThreads = await threadService.getUnread();
  if (unreadThreads.length > 0) {
    // Sort by updatedAt descending (most recent first)
    const sorted = unreadThreads.sort((a, b) => b.updatedAt - a.updatedAt);
    return { id: sorted[0].id, type: 'thread' };
  }

  // Then check plans
  const unreadPlans = await planService.getUnread();
  if (unreadPlans.length > 0) {
    const sorted = unreadPlans.sort((a, b) => b.updatedAt - a.updatedAt);
    return { id: sorted[0].id, type: 'plan' };
  }

  return null;
}
```

### `src/lib/quick-action-validator.ts`

Project validation utility:

```typescript
import * as fs from '@tauri-apps/plugin-fs';
import * as path from 'path';
import { QuickActionManifestSchema, type QuickActionManifest } from '@core/types/quick-actions.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: QuickActionManifest;
}

export async function validateQuickActionProject(
  projectPath: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory exists
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory) {
      return { valid: false, errors: ['Path is not a directory'], warnings };
    }
  } catch {
    return { valid: false, errors: ['Directory does not exist'], warnings };
  }

  // Check manifest exists
  const manifestPath = path.join(projectPath, 'dist', 'manifest.json');
  try {
    await fs.stat(manifestPath);
  } catch {
    return {
      valid: false,
      errors: ['No dist/manifest.json found. Run `npm run build` first.'],
      warnings,
    };
  }

  // Parse and validate manifest
  let manifest: QuickActionManifest;
  try {
    const content = await fs.readTextFile(manifestPath);
    const parsed = JSON.parse(content);
    manifest = QuickActionManifestSchema.parse(parsed);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid manifest.json: ${e instanceof Error ? e.message : String(e)}`],
      warnings,
    };
  }

  // Check all entry points exist
  for (const action of manifest.actions) {
    const entryPath = path.join(projectPath, 'dist', action.entryPoint);
    try {
      await fs.stat(entryPath);
    } catch {
      errors.push(`Missing entry point: ${action.entryPoint}`);
    }
  }

  // Check for common issues
  try {
    await fs.stat(path.join(projectPath, 'package.json'));
  } catch {
    warnings.push('No package.json found - is this a valid project?');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}
```

### `src/lib/node-detection.ts`

Node.js availability check:

```typescript
import { Command } from '@tauri-apps/plugin-shell';

export interface NodeAvailability {
  available: boolean;
  version?: string;
  error?: string;
}

export async function checkNodeAvailable(): Promise<NodeAvailability> {
  try {
    const command = Command.create('node', ['--version']);
    const output = await command.execute();

    if (output.code === 0) {
      return { available: true, version: output.stdout.trim() };
    }
    return { available: false, error: 'Node.js command failed' };
  } catch (e) {
    return {
      available: false,
      error: 'Node.js not found. Please install Node.js to use quick actions.',
    };
  }
}
```

### `src/hooks/useQuickActionExecutor.ts`

React hook for executing actions:

```typescript
import { useState, useCallback } from 'react';
import { executeQuickAction, type QuickActionExecutionContext } from '@/lib/quick-action-executor.js';
import { quickActionService } from '@/entities/quick-actions/service.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';
import { toast } from '@/components/ui/toast.js';
import { useActiveContext } from '@/hooks/useActiveContext.js';
import { openLogsPanel } from '@/lib/navigation.js';

interface ExecutorState {
  isExecuting: boolean;
  executingAction: QuickActionMetadata | null;
}

export function useQuickActionExecutor() {
  const [state, setState] = useState<ExecutorState>({
    isExecuting: false,
    executingAction: null,
  });

  const activeContext = useActiveContext();

  const execute = useCallback(async (action: QuickActionMetadata) => {
    // Prevent concurrent execution
    if (state.isExecuting) return;

    const resolved = quickActionService.resolve(action.id);
    if (!resolved) {
      toast.error('Action not found');
      return;
    }

    setState({ isExecuting: true, executingAction: action });

    try {
      const execContext: QuickActionExecutionContext = {
        contextType: activeContext.type,
        threadId: activeContext.threadId,
        planId: activeContext.planId,
        repository: activeContext.repository,
        worktree: activeContext.worktree,
        threadState: activeContext.threadState,
      };

      const result = await executeQuickAction(resolved, execContext);

      if (!result.success) {
        if (result.timedOut) {
          toast.error('Action timed out after 30 seconds', {
            action: {
              label: 'View logs',
              onClick: () => openLogsPanel(),
            },
          });
        } else {
          toast.error(result.error?.message ?? 'Action failed', {
            action: {
              label: 'View logs',
              onClick: () => openLogsPanel(),
            },
          });
        }
      }
    } catch (e) {
      toast.error(`Action error: ${e instanceof Error ? e.message : String(e)}`, {
        action: {
          label: 'View logs',
          onClick: () => openLogsPanel(),
        },
      });
    } finally {
      setState({ isExecuting: false, executingAction: null });
    }
  }, [state.isExecuting, activeContext]);

  return {
    isExecuting: state.isExecuting,
    executingAction: state.executingAction,
    execute,
  };
}
```

## Design Decisions Referenced

- **#5 Runtime Dependency**: Only Node.js required, detect if missing
- **#7 Error Display**: Toast notification with "View logs" link for all error cases
- **#11 Execution UX**: Shows loading state, doesn't block interaction
- **#17 Execution Feedback**: Spinner with action name
- **#18 No Concurrent Actions**: Prevent execution while one is running
- **#24 State Sync via Events**: Entity operations call services which handle disk writes
- **#25 Action Timeout**: 30-second timeout using Promise.race()
- **#26 Error Detail Level**: Show actual error message and stack trace
- **#29 navigateToNextUnread() Empty Case**: Navigate to empty state if no unread

## Acceptance Criteria

- [ ] Spawns Node process with correct arguments
- [ ] Parses stdout JSON events correctly
- [ ] Handles all SDK event types
- [ ] Entity operations call existing services
- [ ] UI operations update stores directly
- [ ] Timeout kills process after 30 seconds
- [ ] Error output captured and displayed
- [ ] Node.js detection works correctly
- [ ] Concurrent execution prevented
- [ ] Validation checks manifest and entry points

## Design Decision Compliance Notes

### Compliant Decisions
- **#5 Runtime Dependency**: Node.js only, with detection
- **#7 Error Display**: Toast notification with "View logs" link for all error cases (timeout, action failure, exceptions)
- **#10 SDK Communication**: Uses stdout JSON for IPC
- **#11 Execution UX**: Non-blocking loading state
- **#17 Execution Feedback**: Spinner with action name
- **#18 No Concurrent Actions**: Prevented in hook
- **#24 State Sync via Events**: Entity operations call services
- **#25 Action Timeout**: 30-second Promise.race() timeout
- **#26 Error Detail Level**: Shows message and stack trace
- **#29 navigateToNextUnread() Empty Case**: Navigates to empty state
- **#33 SDK Write Operations**: SDK emits events, Mort handles writes
- **#15 Logging**: SDK logs route to main logger

### Additional Considerations
- **#6 Sandboxing**: Scripts run with same trust as user code (no sandboxing implemented)
- **#13 SDK Versioning**: Consider adding version check in executor for SDK compatibility
- **#28 Context Switching During Execution**: Action continues if user navigates away; UI updates apply on completion

## Verification & Testing

### 1. TypeScript Compilation Checks

```bash
# Verify all new files compile without errors
npx tsc --noEmit src/lib/quick-action-executor.ts src/lib/quick-action-validator.ts src/lib/node-detection.ts src/hooks/useQuickActionExecutor.ts

# Verify the full project still compiles
npm run typecheck
```

### 2. Type Import Verification

Create a temporary test file to verify interfaces are properly exported:

```typescript
// test/quick-action-executor.test.ts
import type {
  QuickActionExecutionContext,
  QuickActionResult,
} from '@/lib/quick-action-executor.js';
import type { ValidationResult } from '@/lib/quick-action-validator.js';
import type { NodeAvailability } from '@/lib/node-detection.js';

// Type assertions - these should compile without errors
const _context: QuickActionExecutionContext = {
  contextType: 'thread',
  threadId: 'test-id',
  repository: null,
  worktree: null,
};

const _result: QuickActionResult = {
  success: true,
};

const _validation: ValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
};

const _nodeAvail: NodeAvailability = {
  available: true,
  version: 'v20.0.0',
};
```

### 3. Zod Schema Validation Tests

```typescript
// test/sdk-event-schema.test.ts
import { z } from 'zod';

// Copy SDKEventSchema from quick-action-executor.ts and test:

// Valid events should parse
const validEvents = [
  { event: 'ui:setInput', payload: 'test content' },
  { event: 'ui:clearInput' },
  { event: 'ui:navigate', payload: { type: 'thread', id: 'abc' } },
  { event: 'ui:toast', payload: { message: 'Hello', type: 'success' } },
  { event: 'thread:archive', payload: { threadId: 'abc' } },
  { event: 'log', payload: { level: 'info', message: 'test' } },
];

// Invalid events should fail
const invalidEvents = [
  { event: 'unknown:event', payload: {} },
  { event: 'ui:setInput' }, // missing payload
  { event: 'ui:navigate', payload: { type: 'invalid' } },
  { event: 'thread:archive', payload: {} }, // missing threadId
];
```

### 4. Node Detection Test

```bash
# Verify node detection works on the current system
node -e "console.log('Node.js available:', process.version)"

# Test with PATH manipulation to simulate missing Node
PATH="" node --version 2>&1 || echo "Correctly fails when Node not in PATH"
```

### 5. Integration Test: End-to-End Execution

```typescript
// test/executor-integration.test.ts
import { executeQuickAction } from '@/lib/quick-action-executor.js';
import type { ResolvedQuickAction } from '@/entities/quick-actions/types.js';

// Create a minimal test action that emits events
const testAction: ResolvedQuickAction = {
  id: 'test-action',
  title: 'Test Action',
  projectPath: '/path/to/test-project',
  entryPoint: 'test.js',
  contexts: ['thread'],
};

const testContext = {
  contextType: 'empty' as const,
  repository: null,
  worktree: null,
};

// Execute and verify result shape
const result = await executeQuickAction(testAction, testContext);
console.assert(typeof result.success === 'boolean', 'Result has success boolean');
console.assert(result.timedOut === undefined || typeof result.timedOut === 'boolean', 'timedOut is boolean or undefined');
```

### 6. Service Dependency Verification

Verify that required services have the methods called by the executor:

```bash
# Check threadService has required methods
grep -n "archive\|markRead\|markUnread\|getUnread" src/entities/threads/service.ts

# Check planService has required methods
grep -n "archive\|getUnread" src/entities/plans/service.ts

# Check treeMenuService has setSelectedItem
grep -n "setSelectedItem" src/stores/tree-menu/service.ts

# Check useInputStore has required methods
grep -n "setContent\|appendContent\|clearContent\|requestFocus" src/stores/input-store.ts
```

### 7. Path Module Verification

```bash
# Verify getMortDir and getRunnerPath exist and are exported
grep -n "export.*getMortDir\|export.*getRunnerPath" src/lib/paths.ts
```

### 8. Toast Function Verification

```bash
# Verify toast has info/success/error methods
grep -n "toast\." src/components/ui/toast.ts
```

### 9. Hook State Management Test

```typescript
// Verify the hook prevents concurrent execution
import { renderHook, act } from '@testing-library/react-hooks';
import { useQuickActionExecutor } from '@/hooks/useQuickActionExecutor.js';

const { result } = renderHook(() => useQuickActionExecutor());

// Initial state
console.assert(result.current.isExecuting === false, 'Initially not executing');
console.assert(result.current.executingAction === null, 'No executing action initially');
```

### 10. Timeout Behavior Test

Create a test action that hangs and verify timeout:

```javascript
// test-actions/hang.js - Test action that never completes
setTimeout(() => {}, 60000); // Hang for 60 seconds
```

```typescript
// Test that executor times out after 30 seconds
const startTime = Date.now();
const result = await executeQuickAction(hangAction, testContext);
const elapsed = Date.now() - startTime;

console.assert(result.timedOut === true, 'Should timeout');
console.assert(elapsed >= 30000 && elapsed < 35000, 'Should timeout around 30 seconds');
```

### 11. Manual Verification Checklist

- [ ] Run `npm run build` successfully
- [ ] Run `npm run typecheck` with no errors
- [ ] Run `npm run lint` with no errors related to new files
- [ ] Verify imports resolve correctly in VS Code (no red squiggles)
- [ ] Test quick action execution in the running app with a simple action
- [ ] Verify toast appears on action error
- [ ] Verify spinner shows during execution
- [ ] Verify concurrent execution is blocked (try triggering action while one runs)
