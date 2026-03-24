# Quick Actions High-Level Testing Framework

## Overview

Implement a functional/integration testing framework for quick actions that spawns the actual runner process, captures stdout events, and verifies both the emitted events and disk state changes in a temporary `.anvil` directory.

## Goals

1. Test quick actions end-to-end by spawning the actual `runner.ts` process
2. Capture and assert on stdout JSON events
3. Provide a test fixture system with temporary `.anvil` directories
4. Enable testing of disk reads (threads, plans) via pre-populated test data
5. Support testing multiple actions in isolation

## Design

### Test Harness Architecture

```
core/sdk/__tests__/
├── harness/
│   ├── index.ts              # Main test harness exports
│   ├── runner-spawn.ts       # Spawns runner process, captures stdout
│   ├── anvil-fixture.ts       # Creates/manages temp .anvil directories
│   ├── event-collector.ts    # Parses JSON lines, provides assertions
│   └── fixtures/             # Reusable test data templates
│       ├── threads/          # Sample thread meta.json files
│       └── plans/            # Sample plan index entries
└── integration/
    ├── archive.test.ts       # Tests for archive action
    ├── mark-read.test.ts     # Tests for mark-read action
    ├── navigation.test.ts    # Tests for navigation actions
    └── error-handling.test.ts # Tests for error cases, timeouts
```

### Core Components

#### 1. `AnvilFixture` - Temporary .anvil Directory Manager

```typescript
interface AnvilFixture {
  // Path to the temporary .anvil directory
  readonly anvilDir: string;

  // Setup methods
  addThread(threadId: string, meta: Partial<ThreadMeta>): void;
  addPlan(planId: string, entry: Partial<PlanIndexEntry>): void;

  // Verification methods
  getThread(threadId: string): ThreadMeta | null;
  getPlan(planId: string): PlanIndexEntry | null;
  fileExists(relativePath: string): boolean;
  readFile(relativePath: string): string;

  // Cleanup
  cleanup(): Promise<void>;
}
```

**Implementation details:**
- Uses `os.tmpdir()` + unique suffix for isolation
- Creates standard `.anvil` structure: `threads/`, `plans-index.json`, etc.
- Auto-cleanup in `afterEach` or explicit `cleanup()`
- Factory function: `createAnvilFixture()`

#### 2. `QuickActionRunner` - Process Spawner

```typescript
interface RunnerOptions {
  actionPath: string;           // Path to compiled .js action
  context: QuickActionExecutionContext;
  anvilDir: string;
  timeout?: number;             // Override default timeout
}

interface RunnerResult {
  exitCode: number;
  events: QuickActionEvent[];   // Parsed JSON events
  stderr: string;               // Any stderr output
  duration: number;             // Execution time in ms
}

async function runQuickAction(options: RunnerOptions): Promise<RunnerResult>;
```

**Implementation details:**
- Spawns `node` with the compiled runner
- Passes `--action`, `--context`, `--anvil-dir` args
- Collects stdout line-by-line, parses JSON
- Returns structured result with parsed events
- Handles timeout/error cases

#### 3. `EventCollector` - Event Assertions

```typescript
interface EventCollector {
  readonly events: QuickActionEvent[];

  // Query methods
  getByType(eventType: string): QuickActionEvent[];
  first(eventType: string): QuickActionEvent | undefined;
  last(eventType: string): QuickActionEvent | undefined;
  count(eventType?: string): number;

  // Assertion methods
  expectEvent(eventType: string, payload?: unknown): void;
  expectEventSequence(eventTypes: string[]): void;
  expectNoEvent(eventType: string): void;
  expectError(message?: string | RegExp): void;
}
```

#### 4. Integrated Test API

```typescript
// High-level test helper combining all components
interface QuickActionTestContext {
  fixture: AnvilFixture;

  // Run action and return results
  run(actionSlug: string, context: Partial<QuickActionExecutionContext>): Promise<{
    result: RunnerResult;
    events: EventCollector;
  }>;
}

// Factory for use in tests
function createTestContext(): QuickActionTestContext;
```

### Test Examples

```typescript
describe('archive action', () => {
  let ctx: QuickActionTestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(async () => {
    await ctx.fixture.cleanup();
  });

  it('archives a thread and emits correct events', async () => {
    // Setup
    ctx.fixture.addThread('thread-123', {
      repoId: 'repo-1',
      status: 'idle',
      isRead: true,
    });

    // Execute
    const { result, events } = await ctx.run('archive', {
      contextType: 'thread',
      threadId: 'thread-123',
    });

    // Assert events
    expect(result.exitCode).toBe(0);
    events.expectEvent('thread:archive', { threadId: 'thread-123' });
    events.expectEvent('log', expect.objectContaining({
      level: 'info',
      message: 'Archived thread',
    }));
  });

  it('handles missing thread gracefully', async () => {
    const { result, events } = await ctx.run('archive', {
      contextType: 'thread',
      threadId: 'nonexistent',
    });

    // Action should complete without error (no thread to archive)
    expect(result.exitCode).toBe(0);
    // No archive event should be emitted
    events.expectNoEvent('thread:archive');
  });
});

describe('mark-read action', () => {
  it('reads thread state and emits markRead event', async () => {
    const ctx = createTestContext();

    ctx.fixture.addThread('thread-456', {
      repoId: 'repo-1',
      isRead: false,  // Unread thread
    });

    const { events } = await ctx.run('mark-read', {
      contextType: 'thread',
      threadId: 'thread-456',
    });

    events.expectEvent('thread:markRead', { threadId: 'thread-456' });

    await ctx.fixture.cleanup();
  });
});

describe('action timeout', () => {
  it('emits error event on timeout', async () => {
    const ctx = createTestContext();

    // Use a slow test action that exceeds timeout
    const { result, events } = await ctx.run('slow-action', {
      contextType: 'empty',
    }, { timeout: 100 }); // Very short timeout

    expect(result.exitCode).toBe(1);
    events.expectError(/timed out/);

    await ctx.fixture.cleanup();
  });
});
```

## Implementation Steps

### Phase 1: Core Harness Infrastructure

1. Create `core/sdk/__tests__/harness/` directory structure
2. Implement `AnvilFixture` class
   - Temp directory creation with unique naming
   - Standard `.anvil` structure initialization
   - Thread/plan fixture methods
   - Cleanup with proper error handling
3. Implement `runQuickAction` spawner
   - Process spawning with correct args
   - stdout line parsing
   - Exit code and stderr capture
   - Timeout handling
4. Implement `EventCollector` with query/assertion methods

### Phase 2: Test Utilities

1. Create `createTestContext()` factory function
2. Add pre-built fixtures in `fixtures/` directory
   - Sample thread metadata
   - Sample plan index entries
   - Repository/worktree mock data
3. Add helper to build compiled action paths
   - Point to `core/sdk/template/dist/actions/` for template actions
   - Support custom test actions

### Phase 3: Integration Tests

1. Write tests for each template action:
   - `archive.test.ts`
   - `mark-read.test.ts`
   - `mark-unread.test.ts`
   - `next-unread.test.ts`
   - `archive-and-next.test.ts`
   - `close-panel.test.ts`
2. Write error/edge case tests:
   - Invalid context types
   - Missing thread/plan IDs
   - Timeout behavior
   - Malformed action exports

### Phase 4: CI Integration

1. Add test script to `core/sdk/package.json`
2. Ensure tests run in CI pipeline
3. Add documentation for writing new integration tests

## File Structure Summary

```
core/sdk/
├── __tests__/
│   ├── harness/
│   │   ├── index.ts
│   │   ├── anvil-fixture.ts
│   │   ├── runner-spawn.ts
│   │   ├── event-collector.ts
│   │   └── fixtures/
│   │       ├── thread-meta.ts    # Thread fixture builders
│   │       └── plan-entry.ts     # Plan fixture builders
│   └── integration/
│       ├── archive.test.ts
│       ├── mark-read.test.ts
│       ├── mark-unread.test.ts
│       ├── next-unread.test.ts
│       ├── archive-and-next.test.ts
│       ├── close-panel.test.ts
│       └── error-handling.test.ts
└── package.json  # Add test:integration script
```

## Event Types to Test

From the SDK types, these events should be verified:

**UI Events:**
- `ui:setInput` - payload: string
- `ui:appendInput` - payload: string
- `ui:clearInput` - payload: undefined
- `ui:focusInput` - payload: undefined
- `ui:navigate` - payload: `{ type: 'thread'|'plan'|'nextUnread'|'empty', id?: string }`
- `ui:toast` - payload: `{ message: string, type?: 'success'|'error'|'info' }`
- `ui:closePanel` - payload: undefined

**Entity Events:**
- `thread:archive` - payload: `{ threadId: string }`
- `thread:markRead` - payload: `{ threadId: string }`
- `thread:markUnread` - payload: `{ threadId: string }`
- `plan:archive` - payload: `{ planId: string }`

**Logging Events:**
- `log` - payload: `{ level: 'info'|'warn'|'error'|'debug', message: string, data?: unknown }`
- `error` - payload: `{ message: string, isTimeout: boolean }`

## Testing SDK Read Operations

For actions that read from the `.anvil` directory (e.g., `sdk.threads.list()`, `sdk.plans.get()`), the fixture system should support:

1. **Thread fixtures**: Create `threads/{threadId}/meta.json` with proper structure
2. **Plan fixtures**: Populate `plans-index.json` with entries
3. **Worktree fixtures**: Create plan content files at worktree paths

Example fixture setup for testing `sdk.threads.getUnread()`:

```typescript
ctx.fixture.addThread('thread-1', { isRead: false });
ctx.fixture.addThread('thread-2', { isRead: true });
ctx.fixture.addThread('thread-3', { isRead: false });

// Action can now call sdk.threads.getUnread() and get thread-1, thread-3
```

## Dependencies

- vitest (already in project)
- Node.js child_process (built-in)
- fs/promises for fixture management
- os.tmpdir() for temp directories

## Success Criteria

1. Can spawn runner process and capture all stdout events
2. Can create isolated `.anvil` fixtures per test
3. Can verify both event emission AND file system reads work correctly
4. Tests are fast (< 5s each) and isolated
5. Clear assertion API for event verification
6. Easy to add tests for new actions
