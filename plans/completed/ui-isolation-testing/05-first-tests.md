# Sub-Plan: Write First UI Tests

**Status:** Complete

| Attribute | Value |
|-----------|-------|
| Dependencies | `01-test-stores` (required), at least one `03x` plan (required), `04-user-decisions` (recommended) |
| Blocks | None (final deliverable) |
| Estimated Effort | 2-3 hours |
| Output | 3 working `.ui.test.tsx` files validating the test infrastructure (27 tests total) |

## Objective

Write the first real `.ui.test.tsx` files to validate the full testing infrastructure works end-to-end. These tests serve as **validation that the infrastructure works** and as **reference implementations** for future test authors.

### Success Criteria

1. All 4 test files pass with `pnpm test:ui`
2. Tests complete in under 5 seconds total
3. No `act()` warnings in output
4. Tests are deterministic (run 3x, same results each time)
5. Store state is isolated between tests

## Approach

Start with the simplest component and progressively add complexity. Each test validates a specific capability of the test infrastructure:

| Test | Component | Validates |
|------|-----------|-----------|
| 1 | TaskStatusBadge (leaf) | Basic rendering works |
| 2 | TaskList (store-connected) | TestStores seeding works |
| 3 | TaskList (events) | TestEvents + UI updates work |
| 4 | ThreadPanel (routed) | renderWithRouter works |

---

## Test 1: Leaf Component (TaskStatusBadge)

**Purpose:** Validate basic rendering works without any store or router dependencies.

**File:** `src/components/task-status-badge.ui.test.tsx`

**Prerequisites:**
- Component exists at the expected path
- Component has `data-testid="task-status-badge"` (from 03x plans)

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/helpers/render";
import { TaskStatusBadge } from "./task-status-badge";

describe("TaskStatusBadge UI", () => {
  it("renders todo status", () => {
    render(<TaskStatusBadge status="todo" />);
    expect(screen.getByText(/todo/i)).toBeInTheDocument();
  });

  it("renders in-progress status", () => {
    render(<TaskStatusBadge status="in-progress" />);
    expect(screen.getByText(/in.progress/i)).toBeInTheDocument();
  });

  it("renders done status", () => {
    render(<TaskStatusBadge status="done" />);
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });

  it("applies correct class for error status", () => {
    render(<TaskStatusBadge status="error" />);
    // Adjust class name based on actual implementation
    expect(screen.getByTestId("task-status-badge")).toHaveClass("error");
  });
});
```

**Validation:** Run `pnpm test:ui src/components/task-status-badge.ui.test.tsx` - all tests should pass.

---

## Test 2: Store-Connected Component (TaskList)

**Purpose:** Validate TestStores seeding and store reads work correctly.

**File:** `src/components/task-list.ui.test.tsx`

**Prerequisites:**
- `TestStores` class implemented (from 01-test-stores)
- Component reads from `useTaskStore`
- Component has appropriate test IDs (from 03x plans)

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test/helpers/render";
import { TestStores } from "@/test/helpers/stores";
import { testIds, expectTaskExists } from "@/test/helpers/queries";
import { TaskList } from "./task-list";

describe("TaskList UI", () => {
  beforeEach(() => {
    // TestStores.clear() is called automatically in setup-ui.ts
    // No additional setup needed unless overriding defaults
  });

  it("shows empty state when no tasks", async () => {
    render(<TaskList />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  it("displays tasks from store", async () => {
    TestStores.seedTasks([
      {
        id: "task-1",
        slug: "fix-bug",
        title: "Fix the bug",
        status: "in-progress",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        repository: null,
      },
      {
        id: "task-2",
        slug: "add-feature",
        title: "Add new feature",
        status: "todo",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        repository: null,
      },
    ]);

    render(<TaskList />);

    await waitFor(() => {
      expectTaskExists("task-1");
      expectTaskExists("task-2");
      expect(screen.getByText("Fix the bug")).toBeInTheDocument();
      expect(screen.getByText("Add new feature")).toBeInTheDocument();
    });
  });
});
```

**Validation:** Run `pnpm test:ui src/components/task-list.ui.test.tsx` - all tests should pass.

---

## Test 3: Event-Reactive Component

**Purpose:** Validate TestEvents emitting works with UI updates.

**File:** `src/components/task-list.ui.test.tsx` (add to existing file)

**Prerequisites:**
- `TestEvents` helper implemented
- Entity listeners configured (see 04-user-decisions, Decision 2)

> **Note:** This test pattern depends on how entity listeners are configured. If using direct store seeding (recommended for initial tests), the pattern below applies. If entity listeners are active, adjust accordingly.

```typescript
import { TestEvents } from "@/test/helpers/event-emitter";

describe("TaskList UI - Events", () => {
  it("updates when task:updated event fires", async () => {
    // Seed initial state
    TestStores.seedTask({
      id: "task-1",
      slug: "my-task",
      title: "Original title",
      status: "todo",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repository: null,
    });

    render(<TaskList />);

    await waitFor(() => {
      expect(screen.getByText("Original title")).toBeInTheDocument();
    });

    // Update store and emit event
    TestStores.seedTask({
      id: "task-1",
      slug: "my-task",
      title: "Updated title",
      status: "in-progress",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repository: null,
    });
    await TestEvents.taskUpdated("task-1");

    await waitFor(() => {
      expect(screen.getByText("Updated title")).toBeInTheDocument();
    });
  });
});
```

**Validation:** Run `pnpm test:ui src/components/task-list.ui.test.tsx` - event test should pass.

---

## Test 4: Routed Component (ThreadPanel)

**Purpose:** Validate renderWithRouter works for components that read URL params.

**File:** `src/components/thread-panel.ui.test.tsx`

**Prerequisites:**
- `renderWithRouter` helper implemented (from 02-router-integration)
- Component reads params via `useParams()` or similar
- Component has `data-testid="thread-panel"`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { waitFor, renderWithRouter } from "@/test/helpers/render";
import { screen } from "@testing-library/react";
import { TestStores } from "@/test/helpers/stores";
import { ThreadPanel } from "./thread-panel";

describe("ThreadPanel UI", () => {
  const threadId = "thread-123";
  const taskId = "task-abc";

  beforeEach(() => {
    TestStores.seedThread({
      id: threadId,
      taskId: taskId,
      agentType: "execution",
      workingDirectory: "/Users/test/worktrees/my-task",
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    });
  });

  it("renders thread from URL params", async () => {
    renderWithRouter(<ThreadPanel />, {
      route: `/tasks/${taskId}/threads/${threadId}`,
      path: "/tasks/:taskId/threads/:threadId",
    });

    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toBeInTheDocument();
    });
  });
});
```

**Validation:** Run `pnpm test:ui src/components/thread-panel.ui.test.tsx` - should pass.

---

## Execution Steps

Execute these steps in order. Stop and fix issues before proceeding.

### Step 1: Verify Infrastructure

Before writing tests, confirm dependencies are in place:

```bash
# Check that test command exists
pnpm test:ui --help

# Check that TestStores is importable (run from src/)
# Look for: src/test/helpers/stores.ts
```

### Step 2: Create Tests Incrementally

1. Create Test 1 (TaskStatusBadge)
2. Run `pnpm test:ui` - should pass
3. Create Test 2 (TaskList basic)
4. Run `pnpm test:ui` - should pass
5. Add Test 3 (TaskList events) to existing file
6. Run `pnpm test:ui` - should pass
7. Create Test 4 (ThreadPanel)
8. Run `pnpm test:ui` - all should pass

### Step 3: Validate Quality

Run the full validation checklist:

```bash
# Run all UI tests
pnpm test:ui

# Run 3 times to check determinism
pnpm test:ui && pnpm test:ui && pnpm test:ui

# Check for act() warnings in output
pnpm test:ui 2>&1 | grep -i "act("
```

---

## Debugging Guide

### Common Issues and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot find module '@/test/helpers/stores'` | Path alias not configured | Check `vitest.config.ui.ts` aliases |
| `Cannot find module './task-status-badge'` | Component path incorrect | Verify component exists at path |
| `Unable to find element` | Component async or not rendered | Wrap assertion in `await waitFor()` |
| `act() warning` | State update outside act() | Use `await waitFor()` or `userEvent.setup()` |
| `Hydration mismatch` | Store not cleared between tests | Ensure `TestStores.clear()` in setup-ui.ts |

### Debugging Commands

```typescript
// Print current DOM state
screen.debug();

// Print specific element
screen.debug(screen.getByTestId("task-list"));

// Inspect store state
console.log(TestStores.getTaskState());
console.log(TestStores.getThreadState());

// Log all test IDs in document
screen.debug(document.querySelectorAll("[data-testid]"));
```

---

## Validation Checklist

Before marking this plan complete, verify:

- [ ] `pnpm test:ui` runs without errors
- [ ] All 4 test files exist and pass
- [ ] Tests complete in < 5 seconds total
- [ ] No `act()` warnings in test output
- [ ] Tests are deterministic (run 3x, same results)
- [ ] Store state isolated between tests (modify one test, others still pass)
- [ ] Test patterns documented for future reference

---

## Next Steps After Success

1. **Expand test coverage** - Add more tests following these patterns
2. **Add test factories** - If tests become verbose with repeated data setup (see 04-user-decisions, Decision 4)
3. **Enable coverage reporting** - Add `pnpm test:ui:coverage` script
4. **Document patterns** - Record any component-specific testing patterns discovered
5. **Update 00-overview.md** - Mark this plan as complete
