# Sub-Plan: TestStores Implementation

**Dependencies:** None
**Blocks:** 05-first-tests
**Estimated Scope:** ~150 lines across 3 files
**Status:** Not Started

## Background

Zustand stores persist state between test runs, causing test pollution. Currently, `setup-ui.ts` calls `resetAllMocks()` which clears Tauri mocks but does NOT clear Zustand stores. This leads to flaky tests where state from one test leaks into the next.

The solution follows the same pattern as `VirtualFS`: provide a `TestStores` class that tests use to explicitly seed store state, with a `clear()` method called in `beforeEach` to ensure isolation.

## Objective

Create the `TestStores` class for seeding Zustand stores in UI tests, ensuring complete test isolation between test runs.

**Success criteria:**
- `TestStores.clear()` resets all 5 stores to empty state with `_hydrated: false`
- Seed methods (`seedTask`, `seedThreads`, etc.) populate stores with test data and set `_hydrated: true`
- Getter methods allow assertions on store state after component interactions
- Running `pnpm test:ui` passes with no errors (even with no tests yet)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/test/helpers/stores.ts` | CREATE | TestStores class implementation |
| `src/test/setup-ui.ts` | MODIFY | Add `TestStores.clear()` to beforeEach |
| `src/test/helpers/index.ts` | MODIFY | Add export for TestStores |

## Implementation

### 1. Create `src/test/helpers/stores.ts`

```typescript
/**
 * Store seeding helpers for UI isolation tests.
 *
 * Provides utilities to seed Zustand stores with test data,
 * ensuring test isolation and predictable initial state.
 */

import { useTaskStore } from "@/entities/tasks/store";
import { useThreadStore } from "@/entities/threads/store";
import { useRepoStore } from "@/entities/repositories/store";
import { useSettingsStore } from "@/entities/settings/store";
import { useLogStore } from "@/entities/logs/store";
import { DEFAULT_WORKSPACE_SETTINGS } from "@/entities/settings/types";
import type { TaskMetadata } from "@/entities/tasks/types";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { Repository } from "@/entities/repositories/types";
import type { ThreadState } from "@/lib/types/agent-messages";

// ============================================================================
// Store State Types (for seeding)
// ============================================================================

interface ThreadStoreState {
  threads?: Record<string, ThreadMetadata>;
  activeThreadId?: string | null;
  threadStates?: Record<string, ThreadState>;
  activeThreadLoading?: boolean;
  threadErrors?: Record<string, string>;
}

interface RepoStoreState {
  repositories?: Record<string, Repository>;
}

// ============================================================================
// TestStores Class
// ============================================================================

export class TestStores {
  /**
   * Clear all stores to empty state.
   * Call this in beforeEach to ensure test isolation.
   * Sets _hydrated: false on all stores.
   */
  static clear(): void {
    useTaskStore.setState({
      tasks: {},
      taskContent: {},
      _hydrated: false,
    });

    useThreadStore.setState({
      threads: {},
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: false,
    });

    useRepoStore.setState({
      repositories: {},
      _hydrated: false,
    });

    useSettingsStore.setState({
      workspace: DEFAULT_WORKSPACE_SETTINGS,
      _hydrated: false,
    });

    useLogStore.setState({
      logs: [],
      _hydrated: false,
    });
  }

  // ==========================================================================
  // Task Store Methods
  // ==========================================================================

  static seedTasks(tasks: TaskMetadata[]): void {
    const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));
    useTaskStore.setState({ tasks: taskMap, _hydrated: true });
  }

  static seedTask(task: TaskMetadata): void {
    useTaskStore.setState((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
      _hydrated: true,
    }));
  }

  static seedTaskContent(taskId: string, content: string): void {
    useTaskStore.setState((state) => ({
      taskContent: { ...state.taskContent, [taskId]: content },
    }));
  }

  // ==========================================================================
  // Thread Store Methods
  // ==========================================================================

  static seedThreads(state: ThreadStoreState): void {
    useThreadStore.setState({
      threads: state.threads ?? {},
      activeThreadId: state.activeThreadId ?? null,
      threadStates: state.threadStates ?? {},
      activeThreadLoading: state.activeThreadLoading ?? false,
      threadErrors: state.threadErrors ?? {},
      _hydrated: true,
    });
  }

  static seedThread(thread: ThreadMetadata): void {
    useThreadStore.setState((state) => ({
      threads: { ...state.threads, [thread.id]: thread },
      _hydrated: true,
    }));
  }

  static seedThreadState(threadId: string, state: ThreadState): void {
    useThreadStore.setState((prev) => ({
      threadStates: { ...prev.threadStates, [threadId]: state },
    }));
  }

  static setActiveThread(threadId: string | null): void {
    useThreadStore.setState({ activeThreadId: threadId });
  }

  // ==========================================================================
  // Repository Store Methods
  // ==========================================================================

  static seedRepositories(state: RepoStoreState): void {
    useRepoStore.setState({
      repositories: state.repositories ?? {},
      _hydrated: true,
    });
  }

  static seedRepository(repo: Repository): void {
    useRepoStore.setState((state) => ({
      repositories: { ...state.repositories, [repo.name]: repo },
      _hydrated: true,
    }));
  }

  // ==========================================================================
  // Settings Store Methods
  // ==========================================================================

  static seedSettings(settings: Partial<typeof DEFAULT_WORKSPACE_SETTINGS>): void {
    useSettingsStore.setState({
      workspace: { ...DEFAULT_WORKSPACE_SETTINGS, ...settings },
      _hydrated: true,
    });
  }

  // ==========================================================================
  // Getter Methods (for assertions)
  // ==========================================================================

  static getTaskState() {
    return useTaskStore.getState();
  }

  static getThreadState() {
    return useThreadStore.getState();
  }

  static getRepoState() {
    return useRepoStore.getState();
  }

  static getSettingsState() {
    return useSettingsStore.getState();
  }

  static getLogsState() {
    return useLogStore.getState();
  }
}
```

### 2. Update `src/test/setup-ui.ts`

Add import at top:
```typescript
import { TestStores } from "./helpers/stores";
```

Add to existing `beforeEach`:
```typescript
beforeEach(() => {
  resetAllMocks();     // existing
  TestStores.clear();  // ADD THIS
});
```

### 3. Update `src/test/helpers/index.ts`

Add export:
```typescript
export { TestStores } from "./stores";
```

## Usage Examples

### Seeding a single task
```typescript
import { TestStores } from "@/test/helpers";

beforeEach(() => {
  TestStores.seedTask({
    id: "task-123",
    slug: "my-task",
    title: "Test Task",
    status: "in-progress",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
});
```

### Seeding with VirtualFS (typical pattern)
```typescript
import { VirtualFS, TestStores } from "@/test/helpers";

beforeEach(() => {
  // VirtualFS.seedTask returns a TaskMetadata object
  const task = VirtualFS.seedTask("my-task", { status: "in-progress" });
  TestStores.seedTask(task);
});
```

### Asserting on store state
```typescript
it("updates task status when action completes", async () => {
  // ... trigger action ...

  const state = TestStores.getTaskState();
  expect(state.tasks["task-123"].status).toBe("done");
});
```

## Verification

After implementation, run:
```bash
pnpm test:ui
```

**Expected outcomes:**
1. Command completes without errors
2. No "store is undefined" or similar Zustand errors
3. TypeScript compilation succeeds (no type errors in stores.ts)

To verify store clearing works correctly, temporarily add this test:
```typescript
// Temporary verification test (delete after confirming)
import { describe, it, expect, beforeEach } from "vitest";
import { TestStores } from "@/test/helpers/stores";

describe("TestStores", () => {
  beforeEach(() => {
    TestStores.clear();
  });

  it("clears all stores to empty state", () => {
    expect(TestStores.getTaskState().tasks).toEqual({});
    expect(TestStores.getTaskState()._hydrated).toBe(false);
    expect(TestStores.getThreadState().threads).toEqual({});
    expect(TestStores.getRepoState().repositories).toEqual({});
  });

  it("seeds task and sets hydrated to true", () => {
    TestStores.seedTask({
      id: "test-id",
      slug: "test",
      title: "Test",
      status: "todo",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(TestStores.getTaskState().tasks["test-id"]).toBeDefined();
    expect(TestStores.getTaskState()._hydrated).toBe(true);
  });
});
```

## Type Reference

Store shapes verified against actual implementations:

| Store | State Shape | Source |
|-------|-------------|--------|
| Task | `{ tasks, taskContent, _hydrated }` | `src/entities/tasks/store.ts` |
| Thread | `{ threads, activeThreadId, threadStates, activeThreadLoading, threadErrors, _hydrated }` | `src/entities/threads/store.ts` |
| Repository | `{ repositories, _hydrated }` | `src/entities/repositories/store.ts` |
| Settings | `{ workspace, _hydrated }` | `src/entities/settings/store.ts` |
| Logs | `{ logs, _hydrated }` | `src/entities/logs/store.ts` |

## Considerations

### Hydration state

- `clear()` sets `_hydrated: false` on all stores
- All seed methods set `_hydrated: true`
- This allows testing both hydrated and non-hydrated UI states
- Components may render differently based on `_hydrated` (e.g., showing loading skeletons)

### Store vs Disk seeding

| Scenario | Use VirtualFS | Use TestStores |
|----------|--------------|----------------|
| Component reads from Zustand directly | No | Yes |
| Testing initial render | Maybe | Yes |
| Testing event-triggered refresh | Yes (new state) | No (event handler updates) |
| Testing hydration flow | Yes | No (verify store gets populated) |

**Rule of thumb:** If the component uses `useTaskStore()` directly, seed the store. If the component triggers a Tauri command that reads from disk, seed the disk.

### Thread status types

Two different status types exist (see main plan for details):
- `ThreadState.status`: `"running" | "complete" | "error"` (agent runtime)
- `ThreadMetadata.status`: `"idle" | "running" | "completed" | "error" | "paused"` (stored metadata)

Use the correct type when seeding `threadStates` vs `threads`.

## Checklist

- [ ] Create `src/test/helpers/stores.ts` with TestStores class
- [ ] Update `src/test/setup-ui.ts` to import and call `TestStores.clear()`
- [ ] Update `src/test/helpers/index.ts` to export TestStores
- [ ] Run `pnpm test:ui` to verify no errors
- [ ] (Optional) Add and run verification test, then delete it
