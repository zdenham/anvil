# Agent Harness Test Audit

**Date:** 2026-01-22
**Context:** Post thread-plan-architecture refactor audit
**Related Plan:** [thread-plan-architecture/README.md](./completed/thread-plan-architecture/README.md)

## Executive Summary

After implementing the thread-plan-architecture refactor (which removed the `Task` entity), **26 tests are now failing** due to the `TestAnvilDirectory.createTask()` method being removed. The test harness still references this method but it no longer exists.

**Pass/Fail Summary:**
- **Passing:** 108 tests
- **Failing:** 26 tests
- **Total:** 134 tests

## Test Results by File

### Passing Tests (108 total)

| File | Tests | Status |
|------|-------|--------|
| `src/runners/message-handler.test.ts` | 19 | ✅ All pass |
| `src/runners/stdin-message-schema.test.ts` | 10 | ✅ All pass |
| `src/runners/simple-runner-strategy.test.ts` | 10 | ✅ All pass |
| `src/runners/stdin-message-stream.test.ts` | 15 | ✅ All pass |
| `src/testing/__tests__/exports.test.ts` | 34 | ✅ All pass |
| `src/runners/message-handler.integration.test.ts` | 5 | ✅ All pass |
| `src/runners/thread-history.test.ts` | 5 | ✅ All pass |
| `src/output.test.ts` | 2 | ✅ All pass |
| `src/runners/shared.integration.test.ts` | 5 | ✅ All pass |
| `src/permissions/permission-handler.test.ts` | 3 | ✅ All pass |

### Live LLM Tests (Passing)

| File | Tests | Status |
|------|-------|--------|
| `src/runners/thread-history-live.test.ts` | 2 | ✅ All pass (9.7s + 3s) |

These live tests verify:
- Agent remembers UUID from previous turn (multi-turn memory)
- Control test: agent does NOT know UUID without prior messages

### Failing Tests (26 total)

All failures stem from the same root cause: **`this.anvilDir.createTask is not a function`**

| File | Tests | Failure Reason |
|------|-------|----------------|
| `src/testing/__tests__/events.test.ts` | 2 | `createTask` removed |
| `src/testing/__tests__/state.test.ts` | 3 | `createTask` removed |
| `src/testing/__tests__/tools.test.ts` | 3 | `createTask` removed |
| `src/testing/__tests__/plan-detection.integration.test.ts` | 5 | `createTask` removed |
| `src/testing/__tests__/queued-messages.integration.test.ts` | 9 | `createTask` removed |
| `src/testing/__tests__/harness-self-test.ts` | 4 | `createTask` removed |

## Root Cause Analysis

### The Problem

The `AgentTestHarness.run()` method (line 90 in `agent-harness.ts`) calls:

```typescript
task = this.anvilDir.createTask({
  repositoryName: this.repo.name,
  slug: opts.taskSlug,
});
```

But `TestAnvilDirectory.createTask()` was removed as part of the task cleanup in plan `03-delete-tasks.md`.

### Files Affected

1. **`agents/src/testing/agent-harness.ts`** (line 16, 29, 90-93, 115)
   - Imports `TaskMetadata` from deleted `@core/types/tasks.js`
   - Uses `task` parameter throughout
   - Calls `this.anvilDir.createTask()`

2. **`agents/src/testing/services/test-anvil-directory.ts`**
   - Missing `createTask()` method
   - Missing `tasks/` directory creation (line 48 assertion fails)

3. **`agents/src/testing/types.ts`** (line 20)
   - `AgentTestOptions.taskSlug?: string` - references task concept

4. **`agents/src/testing/runner-config.ts`**
   - References `TaskMetadata` and passes it to `buildArgs`

## Event Emission Status

Since tests are failing at setup (before the agent spawns), we cannot verify current event emissions. However, the **live LLM tests that DON'T use `createTask`** are passing, which shows:

- Thread history/resume functionality works
- Basic agent spawning works
- State serialization works

## Required Fixes

### Update Test Harness for Thread-Only Model

The agent runner should only accept a `threadId` - no task concept at all. Updates needed:

1. **Remove task references from `AgentTestHarness`:**
   - Remove `TaskMetadata` import and usage
   - Remove `createTask()` call entirely
   - Update `spawnAgent()` to accept only `threadId`
   - The harness should create a thread via `createThread()` and pass only the thread ID to the agent

2. **Update `TestAnvilDirectory`:**
   - Ensure `createThread()` method exists and works
   - Remove any `tasks/` directory creation

3. **Update `runner-config.ts`:**
   - Change `buildArgs` signature to accept only `threadId: string`
   - Remove any `TaskMetadata` references

4. **Update agent runner itself (`agents/src/runner.ts`):**
   - The runner should only accept `--thread-id`, not any task-related arguments
   - Remove any task ID handling from the spawn process

5. **Update all test files:**
   - Replace `taskSlug` with `threadId` in test options
   - Tests should work purely with thread IDs

## Tests That Need Special Attention

### Event Emission Tests (`events.test.ts`)

These tests verify critical events:
- `thread:created` on startup
- `thread:status:changed` on completion

**Note:** These events should still work conceptually, just need the test harness fixed.

### Plan Detection Tests (`plan-detection.integration.test.ts`)

These are **LIVE LLM tests** that verify:
- `PLAN_DETECTED` event emission when agent creates a plan file
- Plan update/unread marking when agent edits plan file
- Nested plan paths
- Plan-thread association (was plan-task-thread association)
- Non-plan files don't trigger events

### Queued Messages Tests (`queued-messages.integration.test.ts`)

Mix of mock and live tests:
- Scheduling queued messages without crashing
- Multiple queued messages at different times
- Cleanup on early termination
- JSON message formatting
- `queued-message:ack` event emission
- Live API tests for ack events

## Conclusion

The test failures are **expected and isolated** to a single breaking change: removal of the Task entity. The core agent functionality (spawning, state management, thread history, live LLM communication) is working as evidenced by passing live tests.

**Fix:** Remove all task references from the test harness and agent runner. The agent should only accept a `threadId` parameter - no task concept should exist in the agent layer.

---

## Appendix: Full Test Output

```
 ✓ src/runners/message-handler.test.ts (19 tests) 6ms
 ✓ src/runners/stdin-message-schema.test.ts (10 tests) 4ms
 ✓ src/runners/simple-runner-strategy.test.ts (10 tests) 5ms
 ✓ src/runners/stdin-message-stream.test.ts (15 tests) 6ms
 ✓ src/testing/__tests__/exports.test.ts (34 tests) 6ms
 ✓ src/runners/message-handler.integration.test.ts (5 tests) 9ms
 ✓ src/runners/thread-history.test.ts (5 tests) 79ms
 ✓ src/output.test.ts (2 tests) 3ms
 ✓ src/runners/shared.integration.test.ts (5 tests) 96ms
 ✓ src/permissions/permission-handler.test.ts (3 tests) 2ms
 ✓ src/runners/thread-history-live.test.ts (2 tests) 12757ms
   ✓ agent should remember UUID from previous turn (LIVE LLM) 9730ms
   ✓ agent should NOT know UUID without prior messages (control test) 3026ms

 ❯ src/testing/__tests__/events.test.ts (2 tests | 2 failed) 215ms
 ❯ src/testing/__tests__/state.test.ts (3 tests | 3 failed) 326ms
 ❯ src/testing/__tests__/tools.test.ts (3 tests | 3 failed) 327ms
 ❯ src/testing/__tests__/plan-detection.integration.test.ts (5 tests | 5 failed) 476ms
 ❯ src/testing/__tests__/queued-messages.integration.test.ts (9 tests | 9 failed) 768ms
 ❯ src/testing/__tests__/harness-self-test.ts (18 tests | 4 failed) 792ms
```

**Error signature for all 26 failures:**
```
TypeError: this.anvilDir.createTask is not a function
  ❯ AgentTestHarness.run src/testing/agent-harness.ts:90:27
```
