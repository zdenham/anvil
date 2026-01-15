# Tasks Panel Not Showing Tasks - Bug Diagnosis

## Bug Summary

When opening the task panel, no tasks are displayed even though tasks exist in the store. The panel shows "No tasks yet" despite tasks being present.

## Root Cause

The bug is in `src/components/tasks-panel/tasks-panel.tsx:18`:

```typescript
const tasks = useTaskStore((s) => s.getRootTasks());
```

This selector pattern is **broken** because `getRootTasks` uses Zustand's internal `get()` function instead of the selector's state parameter `s`.

### Why This Breaks Zustand Subscriptions

Looking at the store definition in `src/entities/tasks/store.ts:47`:

```typescript
getRootTasks: () => Object.values(get().tasks).filter((t) => !t.parentId),
```

Zustand's subscription mechanism works by tracking which properties of the `state` object are accessed during selector execution. When you write:

```typescript
const tasks = useTaskStore((s) => s.getRootTasks());
```

Zustand passes the current state as `s`. But `getRootTasks()` doesn't access `s.tasks` - it calls `get()` internally, which is a different code path. **Zustand has no way to know that `tasks` was read**, so it doesn't subscribe the component to `tasks` changes.

### Consequence

1. Initial render: `getRootTasks()` returns empty array (store not hydrated yet)
2. `hydrateEntities()` completes, `tasks` state is populated
3. Zustand doesn't trigger re-render because the selector didn't access `s.tasks`
4. Component remains stuck showing "No tasks yet"

### Correct Pattern (for comparison)

`src/hooks/use-task-board.ts:22` uses the correct pattern:

```typescript
const tasks = useTaskStore((s) => s.tasks);

const groupedTasks = useMemo(() => {
  // Filter/transform tasks here
  for (const task of Object.values(tasks)) { ... }
}, [tasks]);
```

This works because:
1. Selector directly accesses `s.tasks`
2. Zustand tracks this access and subscribes to `tasks` changes
3. Component re-renders when `tasks` is updated

## Fix Options

### Option A: Direct state access with useMemo (Recommended)

```typescript
export function TasksPanel() {
  const allTasks = useTaskStore((s) => s.tasks);

  const tasks = useMemo(() =>
    Object.values(allTasks).filter((t) => !t.parentId),
    [allTasks]
  );
  // ...
}
```

### Option B: Inline the filter in the selector

```typescript
export function TasksPanel() {
  const tasks = useTaskStore((s) =>
    Object.values(s.tasks).filter((t) => !t.parentId)
  );
  // ...
}
```

Note: Option B creates a new array every render, which may cause unnecessary child re-renders. Option A with `useMemo` is preferred.

### Option C: Fix getRootTasks to accept state

This would require refactoring the store pattern, which is more invasive.

---

## Test Plan

### Unit Test: Zustand Selector Subscription Bug

Create a test that validates the bug exists (should fail with current code):

**File:** `src/entities/tasks/store.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskStore } from "./store";
import type { TaskMetadata } from "./types";

const createMockTask = (id: string, parentId: string | null = null): TaskMetadata => ({
  id,
  slug: `task-${id}`,
  title: `Task ${id}`,
  description: "Test task",
  branchName: `task/task-${id}`,
  type: "work",
  subtasks: [],
  status: "todo",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  parentId,
  tags: [],
  sortOrder: 0,
  repositoryName: "test-repo",
  pendingReviews: [],
});

describe("useTaskStore selectors", () => {
  beforeEach(() => {
    // Reset store state before each test
    useTaskStore.setState({ tasks: {}, taskContent: {}, _hydrated: false });
  });

  describe("getRootTasks selector subscription bug", () => {
    it("should re-render when tasks are hydrated using getRootTasks selector", async () => {
      // This test validates the bug: using (s) => s.getRootTasks() doesn't
      // subscribe to tasks changes because getRootTasks uses get() internally.

      const renderCount = { current: 0 };

      const { result } = renderHook(() => {
        renderCount.current++;
        // This is the BROKEN pattern used in tasks-panel.tsx
        return useTaskStore((s) => s.getRootTasks());
      });

      // Initially empty
      expect(result.current).toHaveLength(0);
      const initialRenderCount = renderCount.current;

      // Simulate hydration (what happens at app startup)
      act(() => {
        useTaskStore.getState().hydrate({
          "task-1": createMockTask("task-1"),
          "task-2": createMockTask("task-2"),
        });
      });

      // BUG: With the broken selector, this will FAIL because the component
      // doesn't re-render after hydration
      await waitFor(() => {
        expect(result.current).toHaveLength(2);
      });

      // Should have re-rendered at least once after hydration
      expect(renderCount.current).toBeGreaterThan(initialRenderCount);
    });

    it("should re-render when tasks are hydrated using direct state access", async () => {
      // This test shows the CORRECT pattern that works

      const renderCount = { current: 0 };

      const { result } = renderHook(() => {
        renderCount.current++;
        // CORRECT pattern: directly access s.tasks
        const allTasks = useTaskStore((s) => s.tasks);
        return Object.values(allTasks).filter((t) => !t.parentId);
      });

      // Initially empty
      expect(result.current).toHaveLength(0);
      const initialRenderCount = renderCount.current;

      // Simulate hydration
      act(() => {
        useTaskStore.getState().hydrate({
          "task-1": createMockTask("task-1"),
          "task-2": createMockTask("task-2"),
        });
      });

      // With correct selector, this should pass
      await waitFor(() => {
        expect(result.current).toHaveLength(2);
      });

      expect(renderCount.current).toBeGreaterThan(initialRenderCount);
    });
  });

  describe("getRootTasks filters correctly", () => {
    it("should only return tasks without parentId", () => {
      useTaskStore.setState({
        tasks: {
          "task-1": createMockTask("task-1", null),  // root task
          "task-2": createMockTask("task-2", null),  // root task
          "subtask-1": createMockTask("subtask-1", "task-1"),  // subtask
        },
        _hydrated: true,
      });

      const rootTasks = useTaskStore.getState().getRootTasks();

      expect(rootTasks).toHaveLength(2);
      expect(rootTasks.map(t => t.id).sort()).toEqual(["task-1", "task-2"]);
    });
  });
});
```

### Integration Test: TasksPanel Component

**File:** `src/components/tasks-panel/tasks-panel.test.tsx`

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { TasksPanel } from "./tasks-panel";
import { useTaskStore } from "@/entities/tasks/store";
import type { TaskMetadata } from "@/entities/tasks/types";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const createMockTask = (id: string): TaskMetadata => ({
  id,
  slug: `task-${id}`,
  title: `Task ${id}`,
  description: "Test task",
  branchName: `task/task-${id}`,
  type: "work",
  subtasks: [],
  status: "todo",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  parentId: null,
  tags: [],
  sortOrder: 0,
  repositoryName: "test-repo",
  pendingReviews: [],
});

describe("TasksPanel", () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: {}, taskContent: {}, _hydrated: false });
  });

  it("should display 'No tasks yet' when store is empty", () => {
    render(<TasksPanel />);
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });

  it("should display tasks after hydration", async () => {
    // Render first (simulates component mounting before hydration)
    render(<TasksPanel />);

    // Initially shows no tasks
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();

    // Simulate hydration (what happens at app startup)
    act(() => {
      useTaskStore.getState().hydrate({
        "task-1": createMockTask("task-1"),
        "task-2": createMockTask("task-2"),
      });
    });

    // BUG: This will FAIL with current code because the component
    // doesn't re-render after hydration
    await waitFor(() => {
      expect(screen.getByText("Task task-1")).toBeInTheDocument();
      expect(screen.getByText("Task task-2")).toBeInTheDocument();
    });
  });

  it("should update when a new task is added", async () => {
    // Start with one task
    useTaskStore.setState({
      tasks: { "task-1": createMockTask("task-1") },
      _hydrated: true,
    });

    render(<TasksPanel />);
    expect(screen.getByText("Task task-1")).toBeInTheDocument();

    // Add another task
    act(() => {
      useTaskStore.getState()._applyCreate(createMockTask("task-2"));
    });

    // BUG: This will FAIL with current code
    await waitFor(() => {
      expect(screen.getByText("Task task-2")).toBeInTheDocument();
    });
  });
});
```

### Running the Tests

```bash
# Run only the store tests
pnpm test src/entities/tasks/store.test.ts

# Run only the component tests
pnpm test src/components/tasks-panel/tasks-panel.test.ts

# Run all related tests
pnpm test --filter "*task*"
```

### Expected Results

With the current buggy code:
- `"should re-render when tasks are hydrated using getRootTasks selector"` - **FAIL**
- `"should re-render when tasks are hydrated using direct state access"` - **PASS**
- `"should display tasks after hydration"` - **FAIL**
- `"should update when a new task is added"` - **FAIL**

After applying the fix:
- All tests should **PASS**

---

## Files to Modify

1. `src/components/tasks-panel/tasks-panel.tsx` - Fix the selector pattern
2. `src/entities/tasks/store.test.ts` - Add tests (new file)
3. `src/components/tasks-panel/tasks-panel.test.tsx` - Add tests (new file)

## Related Files

- `src/entities/tasks/store.ts` - Store definition with broken `getRootTasks`
- `src/hooks/use-task-board.ts` - Example of correct selector pattern
- `src/tasks-panel-main.tsx` - Bootstrap sequence (not the cause)
