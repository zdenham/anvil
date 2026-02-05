# Testing

This document describes how to test the Mort codebase.

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all TypeScript unit/integration tests |
| `pnpm test:ui` | Run UI isolation tests |
| `cd core/sdk && pnpm test` | Run Quick Actions SDK tests |
| `pnpm tsc --noEmit` | Type check frontend |
| `pnpm --filter agents typecheck` | Type check agents |
| `cd src-tauri && cargo test` | Run Rust tests |
| `./src-tauri/target/debug/mort-test` | Run E2E accessibility tests |

## Test Types

Mort uses five distinct testing approaches, each serving a specific purpose in the verification pyramid.

**Unit & Integration Tests** (`pnpm test`)
- Test services and libraries in isolation using mock adapters.
- Run headlessly via Vitest. Fast feedback loop.
- Tests live in `core/services/**/*.test.ts` and `src/lib/*.test.ts`.

**UI Isolation Tests** (`pnpm test:ui`)
- Test React components with mocked Tauri APIs and virtual filesystem.
- Run headlessly via Vitest + happy-dom. No Tauri runtime required.
- Tests use `.ui.test.tsx` suffix. See `plans/ui-isolation-testing.md` for details.
- Key helpers: `TestEvents` (emit mock events), `TestLogs` (assert on log output), `VirtualFS` (seed filesystem).

**Agent Functional Tests** (`cd agents && pnpm test`)
- Test agent behavior end-to-end with real or mocked Anthropic APIs.
- Verify event emissions, tool usage, and agent lifecycle.
- Tests live in `agents/src/testing/__tests__/`.

**Quick Actions Integration Tests** (`cd core/sdk && pnpm test`)
- Test quick actions by spawning the actual runner process.
- Capture stdout JSON events and verify correctness.
- Use temporary `.mort` directories for isolated test environments.
- Tests live in `core/sdk/__tests__/integration/`.
- See [Quick Actions Test Harness](#quick-actions-test-harness) below for details.

**E2E Accessibility Tests** (`mort-test`)
- Test the real app using native macOS accessibility APIs.
- Trigger keyboard shortcuts, verify window state, run scenarios.
- CLI at `src-tauri/src/bin/mort-test/`.

## Verification Philosophy

All code must be verified. Static analysis is insufficient.

1. **Unit tests** - Test individual functions and classes in isolation
2. **Integration tests** - Test interfaces between services
3. **Reproduction** - Prove diagnoses by reproducing issues or analyzing logs

Logs are written to `logs/dev.log`. See [logs.md](./logs.md) for how to read them safely.

## When to Use Each Test Type

| Scenario | Test Type |
|----------|-----------|
| Testing a pure utility function | Unit |
| Testing a service with dependencies | Unit (with mock adapters) |
| Testing React component rendering | UI Isolation |
| Testing component user interactions | UI Isolation |
| Testing event-driven UI updates | UI Isolation |
| Testing agent completes a task | Agent Functional |
| Testing agent emits correct events | Agent Functional |
| Testing quick action event emissions | Quick Actions Integration |
| Testing quick action reads from .mort | Quick Actions Integration |
| Testing keyboard shortcuts work | E2E |
| Testing window opens/closes | E2E |
| Testing full user workflows | E2E |

## Type Checking

Type checking is separate from tests and should pass before committing.

```bash
# Check frontend types
pnpm tsc --noEmit

# Check agents types
pnpm --filter agents typecheck
```

## Quick Actions Test Harness

The Quick Actions SDK includes an integration test harness for end-to-end testing of quick actions. Tests spawn the actual runner process, capture stdout events, and verify both emitted events and disk state.

### Running Tests

```bash
cd core/sdk
pnpm test              # Run all SDK tests
pnpm test:integration  # Run only integration tests
pnpm test:watch        # Watch mode
```

### Test Harness Components

The harness lives in `core/sdk/__tests__/harness/` and provides:

**MortFixture** - Temporary `.mort` directory manager
```typescript
const fixture = await createMortFixture();
await fixture.addThread('thread-123', { isRead: false, status: 'idle' });
await fixture.addPlan('plan-456', { relativePath: 'plans/my-plan.md' });
// ... run tests ...
await fixture.cleanup();
```

**QuickActionRunner** - Process spawner that executes actions
```typescript
const result = await runQuickAction({
  actionPath: getTemplateActionPath('archive'),
  context: { contextType: 'thread', threadId: 'thread-123' },
  mortDir: fixture.mortDir,
  timeout: 5000,
});
```

**EventCollector** - Event query and assertions
```typescript
const events = EventCollector.from(result.events);
events.expectEvent('thread:archive', { threadId: 'thread-123' });
events.expectLog('info', 'Archived thread');
events.expectNoEvent('error');
events.expectEventSequence(['thread:archive', 'log']);
```

### Writing Integration Tests

Use `createTestContext()` for a high-level API that combines fixture and runner:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type QuickActionTestContext } from '../harness/index.js';

describe('my-action', () => {
  let ctx: QuickActionTestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('does the expected thing', async () => {
    // Setup fixtures
    await ctx.fixture.addThread('thread-123', { isRead: false });

    // Run action
    const { result, events } = await ctx.run('my-action', {
      contextType: 'thread',
      threadId: 'thread-123',
    });

    // Assert
    expect(result.exitCode).toBe(0);
    events.expectEvent('thread:markRead', { threadId: 'thread-123' });
    events.expectNoError();
  });
});
```

### Fixture Builders

Pre-built fixture helpers for common patterns:

```typescript
import {
  buildThreadMeta,
  buildUnreadThread,
  buildRunningThread,
  buildPlanEntry,
  buildUnreadPlan,
} from '../harness/index.js';

// Default thread (idle, read)
await fixture.addThread('t1', buildThreadMeta());

// Unread thread
await fixture.addThread('t2', buildUnreadThread());

// Running thread
await fixture.addThread('t3', buildRunningThread());

// Plan with custom path
await fixture.addPlan('p1', buildPlanEntry({ relativePath: 'docs/plan.md' }));
```

### Event Types

Events emitted by quick actions that can be asserted on:

| Event | Payload | Description |
|-------|---------|-------------|
| `ui:setInput` | `string` | Set input field content |
| `ui:appendInput` | `string` | Append to input field |
| `ui:clearInput` | `undefined` | Clear input field |
| `ui:focusInput` | `undefined` | Focus input field |
| `ui:navigate` | `{ type, id? }` | Navigate to thread/plan/nextUnread |
| `ui:toast` | `{ message, type? }` | Show toast notification |
| `ui:closePanel` | `undefined` | Close current panel |
| `thread:archive` | `{ threadId }` | Archive a thread |
| `thread:markRead` | `{ threadId }` | Mark thread as read |
| `thread:markUnread` | `{ threadId }` | Mark thread as unread |
| `plan:archive` | `{ planId }` | Archive a plan |
| `log` | `{ level, message, data? }` | Log message |
| `error` | `{ message, isTimeout }` | Error occurred |
