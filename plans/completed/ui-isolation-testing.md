# UI Isolation Testing Plan

High-level plan for implementing web-only UI tests that mock all Tauri/backend interactions.

**Decision:** Vitest + happy-dom. Real browser E2E coverage is handled separately via accessibility APIs.

**Status:** Infrastructure ~90% complete. Ready to write actual component tests.

## Requires User Discretion

### 1. Coverage Configuration

The plan mentions coverage timing but no configuration exists. Decide:

- **Option A**: Add coverage to `vitest.config.ui.ts` with thresholds (e.g., 80% statements)
- **Option B**: Keep UI tests coverage-free, rely on unit tests for coverage metrics
- **Option C**: Separate coverage command (`test:ui:coverage`) without enforced thresholds

### 2. Entity Listeners in Tests

`setupEntityListeners()` binds events to store updates. Choose:

- **Option A**: Call `setupEntityListeners()` in `setup-ui.ts` for realistic event->store flow (requires cleanup between tests)
- **Option B**: Skip entity listeners; tests seed stores directly (faster, but doesn't verify event->refresh->store flow)
- **Option C**: Provide both patterns; use listeners for integration-style tests, direct seeding for unit-style tests

### 3. CSS/Style Testing Strategy

Happy-dom has limited CSS support. For style-dependent tests:

- **Option A**: Skip style assertions entirely; test behavior only
- **Option B**: Use CSS class assertions (`toHaveClass()`) as proxy for visual state
- **Option C**: Accept happy-dom limitations; add visual regression tests separately

### 4. Test Data Factories

As the test suite grows, manually constructing full `ThreadMetadata` objects becomes tedious. Decide:

- **Option A**: Add factory helpers (e.g., `createThread({ status: "running" })`) that provide sensible defaults
- **Option B**: Keep manual construction; rely on IDE autocomplete and copy-paste from examples
- **Option C**: Add factories later when test count exceeds ~20 tests

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| `vitest.config.ui.ts` | Done | happy-dom, path aliases configured |
| `src/test/setup-ui.ts` | Done | Tauri mocks, plugin mocks, lifecycle hooks |
| `src/test/mocks/tauri-api.ts` | Done | All 6 command categories mocked |
| `src/test/helpers/virtual-fs.ts` | Done | VirtualFS with task/thread/repo helpers |
| `src/test/helpers/event-emitter.ts` | Done | TestEvents with all event types |
| `src/test/helpers/render.ts` | Done | renderUI with AllProviders wrapper |
| `src/test/helpers/queries.ts` | Done | testIds + query/assertion helpers |
| `src/test/helpers/stores.ts` | **TODO** | TestStores for Zustand seeding (see implementation below) |
| Package dependencies | Done | @testing-library/react, happy-dom, vitest |
| NPM scripts | Done | `test:ui`, `test:ui:watch` |
| Example `.ui.test.tsx` files | Missing | Need real component tests |
| data-testid attributes | Missing | Components need testids added |

## Goals

1. **Fast startup** - Tests spin up in milliseconds, not seconds
2. **Full isolation** - No Tauri, no Rust, no Node agents, no filesystem
3. **Deterministic** - Same inputs always produce same outputs
4. **Event-driven** - Simulate events + disk states, verify UI reactions
5. **Test-id based** - Assert on `data-testid` attributes for stability

## Architecture

```
+-------------------------------------------------------------------+
|                        Test Runner (Vitest)                        |
+-------------------------------------------------------------------+
|  +--------------+  +--------------+  +--------------------------+  |
|  |  Mock Tauri  |  | Mock Event   |  |  In-Memory Filesystem    |  |
|  |   Commands   |  |   Bridge     |  |       (Virtual)          |  |
|  +--------------+  +--------------+  +--------------------------+  |
+-------------------------------------------------------------------+
|                    React App (via happy-dom)                       |
+-------------------------------------------------------------------+
```

## Key Insight: Existing Abstraction Points

The codebase already has clean abstraction boundaries we can exploit:

1. **`tauri-commands.ts`** - All Tauri IPC goes through typed wrapper objects:
   - `gitCommands` - Branch, worktree, checkout operations
   - `fsCommands` - File read/write, directory listing
   - `processCommands` - Agent process spawning/termination
   - `threadCommands` - Thread status queries
   - `lockCommands` - Repository locking
   - `agentCommands` - Agent type queries
2. **`event-bridge.ts`** - Events flow through mitt `eventBus` before/after Tauri
3. **Adapters pattern** - Services accept injected dependencies

This means we can mock at the module level without touching application code.

## Type Imports (Resolved)

All types are properly defined and exported. Understanding the import chain is critical:

```typescript
// === Core types (source of truth) ===
// Task types
import type { TaskMetadata, TaskStatus } from "@core/types/tasks";

// Thread runtime state (agent output) - uses "complete" | "running" | "error"
import type { ThreadState } from "@core/types/events";

// === Frontend types ===
// Re-exported from src/entities for convenience (same types, shorter path)
import { eventBus, EventName, type AppEvents, type ThreadState } from "@/entities/events";

// Thread metadata (persisted to disk) - uses "idle" | "running" | "completed" | "error" | "paused"
import type { ThreadMetadata, ThreadStatus } from "@/entities/threads/types";

// Thread store re-exports ThreadState as DiskThreadState for clarity
import type { DiskThreadState } from "@/entities/threads/store";

// Frontend re-export path (same as @core/types/events, just more convenient)
import type { ThreadState } from "@/lib/types/agent-messages";

// Message types (from Anthropic SDK)
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
```

**Import Chain for ThreadState:**
1. `@core/types/events.ts` - defines `ThreadState` schema and type (canonical source)
2. `@/lib/types/agent-messages.ts` - re-exports `ThreadState` from core
3. `@/entities/threads/store.ts` - imports as `DiskThreadState` for internal use
4. `@/entities/events.ts` - re-exports for convenient access

**Import Chain for ThreadMetadata:**
1. `@/entities/threads/types.ts` - defines `ThreadMetadataSchema` and `ThreadMetadata` type (canonical source)
2. `@/entities/threads/store.ts` - imports for store typing

## Status Type Clarification

Two different status types exist - understanding when to use each is critical:

| Type | Source | Values | Used For |
|------|--------|--------|----------|
| `ThreadState.status` | `@core/types/events.ts` | `"running"`, `"complete"`, `"error"` | Agent runtime state (disk state.json) |
| `ThreadMetadata.status` | `src/entities/threads/types.ts` | `"idle"`, `"running"`, `"completed"`, `"error"`, `"paused"` | Thread metadata (disk metadata.json, Zustand store) |

**Key difference:** `ThreadState` uses `"complete"` while `ThreadMetadata` uses `"completed"`.

When seeding test data:
- Use `"complete"` for `ThreadState` objects (agent state snapshots)
- Use `"completed"` for `ThreadMetadata` objects (thread records in store)

**VirtualFS.seedThread() status conversion:**
The helper converts `ThreadMetadata` status values to `ThreadState` status values for state.json:
- `"completed"` -> `"complete"`
- `"error"` -> `"error"`
- All others (`"idle"`, `"running"`, `"paused"`) -> `"running"`

Note: This conversion is intentionally lossy for edge cases like `"idle"` and `"paused"` since `ThreadState` only represents active agent states. If testing these edge cases specifically, seed the state.json directly via `VirtualFS.seed()`.

## Implementation Steps

### Phase 1: Mock Infrastructure - COMPLETE

All mock infrastructure is implemented in `src/test/mocks/tauri-api.ts`:

- **mockFileSystem** - `Map<string, string>` for virtual filesystem
- **mockGitState** - Branches, default branch, worktrees
- **mockThreadState** - Thread metadata, running processes
- **mockInvoke** - Routes all 6 command categories
- **mockEmit / mockListen** - Event system with listener tracking
- **resetAllMocks()** - Clears all state between tests

**Also mocks:** `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-global-shortcut`, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-opener`

**Additional commands to add as needed:**
- `fs_create_dir` / `fs_create_dir_all` - Directory creation
- `fs_copy` / `fs_rename` - File operations
- `git_fetch` / `git_pull` / `git_push` - Remote operations
- `get_git_status` - Working tree status

### Phase 1.5: Virtual Filesystem - COMPLETE

`src/test/helpers/virtual-fs.ts` provides:

```typescript
// Seed arbitrary files
VirtualFS.seed({ "/path/to/file.json": { key: "value" } });

// Seed tasks with full metadata
const task = VirtualFS.seedTask("my-task", { status: "in-progress" });

// Seed multiple tasks
VirtualFS.seedTasks([{ slug: "task-1" }, { slug: "task-2" }]);

// Seed threads (converts "completed" -> "complete" for ThreadState automatically)
VirtualFS.seedThread("my-task", "thread-123", { status: "running" });

// Seed repositories
VirtualFS.seedRepository("my-repo", "/Users/test/code/my-repo");

// Query/update
VirtualFS.get("/path");
VirtualFS.exists("/path");
VirtualFS.updateTask("my-task", { status: "done" });
VirtualFS.updateThreadState("my-task", "thread-123", { status: "complete" });
```

**Constants:** `MOCK_HOME_DIR = "/Users/test"`, `MOCK_ANVIL_DIR = "/Users/test/.anvil"`

### Phase 2: Event Simulation - COMPLETE

`src/test/helpers/event-emitter.ts` provides `TestEvents` class:

```typescript
// Basic event emission
TestEvents.emit(EventName.TASK_UPDATED, { taskId: "task-123" });

// Emit and wait for React (uses setTimeout(0))
await TestEvents.emitAndWait(EventName.TASK_UPDATED, { taskId: "task-123" });

// Task events
await TestEvents.taskCreated(taskId);
await TestEvents.taskUpdated(taskId);
await TestEvents.taskDeleted(taskId);
await TestEvents.taskStatusChanged(taskId, "in-progress");

// Thread events
await TestEvents.threadCreated(threadId, taskId);
await TestEvents.threadUpdated(threadId, taskId);
await TestEvents.threadStatusChanged(threadId, "running");

// Agent events
await TestEvents.agentSpawned(threadId, taskId);
await TestEvents.agentState(threadId, { status: "running", messages: [...] });
await TestEvents.agentCompleted(threadId, exitCode, costUsd);
await TestEvents.agentError(threadId, "Error message");

// Simulate full agent lifecycle
await TestEvents.simulateAgentRun(threadId, taskId, [
  { role: "assistant", content: "Analyzing..." },
  { role: "assistant", content: "Done." },
]);

// Spy on events
// NOTE: The return type annotation in event-emitter.ts currently says jest.Mock
// but vi.fn() actually returns MockInstance. Tests work correctly; the type
// annotation is slightly incorrect and should be updated to use vi.Mock or MockInstance.
const spy = TestEvents.spy(EventName.TASK_UPDATED);
// ... trigger action
expect(spy).toHaveBeenCalledWith({ taskId: "task-123" });

// Wait for specific event
const payload = await TestEvents.waitFor(EventName.TASK_CREATED, 1000);

// Cleanup (called in afterEach by setup-ui.ts)
TestEvents.clearAllListeners();
```

**Utilities:** `waitForReact()`, `flushPromises()` for async test flows.

**Event Flow Note:** `TestEvents` emits directly to the mitt `eventBus`, skipping the Tauri event bridge. This is intentional - all app components should subscribe via mitt, not Tauri's `listen()` directly. If a component subscribes via Tauri API, it won't receive test events.

### Phase 3: Test Utilities - COMPLETE

#### 3.1 Render Helper

`src/test/helpers/render.ts` provides:

```typescript
import { render, screen, waitFor, userEvent } from "@/test/helpers/render";

// Standard render (no wrapper - Zustand stores don't need providers)
render(<MyComponent />);

// Re-exports @testing-library/react and @testing-library/user-event
```

**Context Providers:** The app has two React context providers (`GlobalErrorProvider`, `WorkspaceSettingsProvider`) but these don't fit the Zustand store pattern used elsewhere. For components using `useWorkspaceSettings()` or `useGlobalError()`, mock the hooks directly:

```typescript
import { vi } from "vitest";
import * as workspaceSettingsContext from "@/contexts/workspace-settings-context";

vi.spyOn(workspaceSettingsContext, "useWorkspaceSettings").mockReturnValue({
  settings: { repository: null, anthropicApiKey: null, workflowMode: "solo" },
  isLoading: false,
  error: null,
  updateSetting: vi.fn(),
  updateSettings: vi.fn(),
  reload: vi.fn(),
});
```

Most components use Zustand stores directly and won't need this.

#### 3.2 Router Integration (TODO)

**Status:** Not yet implemented.

For components using `useParams`, `useNavigate`, `useLocation`, add the following to `src/test/helpers/render.ts`:

```typescript
// src/test/helpers/render.ts - ADD THIS
import { MemoryRouter, Routes, Route } from "react-router-dom";

interface RenderWithRouterOptions {
  route?: string;
  path?: string;  // Route pattern, e.g., "/tasks/:taskId"
}

export function renderWithRouter(
  ui: ReactElement,
  { route = "/", path = route }: RenderWithRouterOptions = {}
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

// Usage:
renderWithRouter(<ThreadPanel />, {
  route: "/tasks/task-123/threads/thread-456",
  path: "/tasks/:taskId/threads/:threadId"
});
```

Also update `src/test/helpers/index.ts` to export `renderWithRouter` once implemented.

#### 3.3 User Event Setup

For interaction tests, use `userEvent.setup()` per test for isolation:

```typescript
import { render, screen } from "@/test/helpers/render";
import userEvent from "@testing-library/user-event";

it("handles click", async () => {
  const user = userEvent.setup();
  render(<Button />);
  await user.click(screen.getByTestId("submit-button"));
});
```

#### 3.4 Timer Mocking

For components with timeouts, intervals, or polling behavior, use Vitest's fake timers:

```typescript
import { vi, beforeEach, afterEach } from "vitest";

describe("PollingComponent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes after interval", async () => {
    render(<PollingComponent interval={5000} />);

    // Fast-forward time
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-count")).toHaveTextContent("1");
    });
  });

  it("handles Date.now() in tests", () => {
    const fixedDate = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(fixedDate);

    render(<TimestampDisplay />);
    expect(screen.getByTestId("timestamp")).toHaveTextContent("Jan 15, 2024");
  });
});
```

**Note:** When using fake timers with `userEvent`, initialize userEvent with `advanceTimers`:

```typescript
const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
```

#### 3.5 Test-ID Query Helpers

`src/test/helpers/queries.ts` provides:

```typescript
import { testIds, getTaskItem, expectTaskHasStatus } from "@/test/helpers/queries";

// Static IDs
testIds.taskList           // "task-list"
testIds.threadPanel        // "thread-panel"
testIds.loadingSpinner     // "loading-spinner"

// Parameterized IDs
testIds.taskItem("task-123")        // "task-item-task-123"
testIds.taskStatus("task-123")      // "task-status-task-123"
testIds.messageItem(0)              // "message-0"
testIds.kanbanCard("task-123")      // "kanban-card-task-123"
testIds.kanbanColumn("in-progress") // "kanban-column-in-progress"

// Query helpers
getTaskItem(taskId)      // screen.getByTestId
queryTaskItem(taskId)    // returns null if not found
getTaskStatus(taskId)
getMessage(index)
getAllMessages()         // queryAllByTestId(/^message-\d+$/)
getThreadStatus()
getKanbanCard(taskId)
getKanbanColumn(status)
getCardsInColumn(status)
withinTestId(testId)     // within(screen.getByTestId(...))
isLoading()              // boolean check
hasError()               // boolean check

// Assertion helpers
expectTaskExists(taskId)
expectTaskNotExists(taskId)
expectTaskHasStatus(taskId, "in-progress")
expectThreadStatus("running")
expectMessageWithContent("Hello world")
```

### Phase 4: Example Tests - TODO

These tests need to be written. Examples below are **illustrative** and use the documented API.

**Important notes:**
- Component names and props are examples. Verify actual component signatures before implementing.
- These examples assume `TestStores` has been implemented per the "Remaining Work" section.
- The `VirtualFS.seedTask()` return value is a `TaskMetadata` object that can be passed directly to `TestStores.seedTask()`.

#### 4.1 Basic Event Reaction Test

```typescript
// src/components/task-list.ui.test.tsx

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test/helpers/render";
import { VirtualFS } from "@/test/helpers/virtual-fs";
import { TestStores } from "@/test/helpers/stores";
import { TestEvents } from "@/test/helpers/event-emitter";
import { testIds, expectTaskExists, expectTaskHasStatus } from "@/test/helpers/queries";
import { TaskList } from "./task-list";

describe("TaskList UI", () => {
  beforeEach(() => {
    // Seed disk state - VirtualFS.seedTask returns the full TaskMetadata with generated ID
    const task = VirtualFS.seedTask("my-task", {
      id: "task-my-task",  // Use fixed ID for predictable assertions
      title: "Fix the bug",
      status: "in-progress",
    });

    // Seed store state (for components that read from Zustand)
    TestStores.seedTask(task);
  });

  it("displays task from store", async () => {
    render(<TaskList />);

    await waitFor(() => {
      expectTaskExists("task-my-task");
      expect(screen.getByText("Fix the bug")).toBeInTheDocument();
    });
  });

  it("updates when task:updated event fires", async () => {
    render(<TaskList />);

    await waitFor(() => {
      expect(screen.getByText("Fix the bug")).toBeInTheDocument();
    });

    // Update disk state, then emit event
    const updated = VirtualFS.updateTask("my-task", {
      title: "Fix the bug (updated)",
      status: "done",
    });
    // Also update store (simulating what the event handler would do)
    TestStores.seedTask(updated!);
    await TestEvents.taskUpdated("task-my-task");

    await waitFor(() => {
      expect(screen.getByText("Fix the bug (updated)")).toBeInTheDocument();
      expectTaskHasStatus("task-my-task", "done");
    });
  });
});
```

#### 4.2 Agent State Streaming Test

```typescript
// src/components/thread-panel.ui.test.tsx

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test/helpers/render";
import { VirtualFS } from "@/test/helpers/virtual-fs";
import { TestStores } from "@/test/helpers/stores";
import { TestEvents } from "@/test/helpers/event-emitter";
import { expectThreadStatus, expectMessageWithContent } from "@/test/helpers/queries";
import { ThreadPanel } from "./thread-panel";

describe("ThreadPanel UI", () => {
  const threadId = "test-thread-123";
  const taskId = "task-my-task";

  beforeEach(() => {
    const task = VirtualFS.seedTask("my-task", {
      id: taskId,
      status: "in-progress"
    });
    VirtualFS.seedThread("my-task", threadId, { status: "running" });

    TestStores.seedTask(task);
    // Note: Thread store seeding would go here if component reads from thread store
  });

  it("shows messages as agent streams them", async () => {
    render(<ThreadPanel threadId={threadId} />);

    // ThreadState.status uses "running" | "complete" | "error"
    await TestEvents.agentState(threadId, {
      status: "running",
      messages: [{ role: "assistant", content: "Analyzing the codebase..." }],
      fileChanges: [],
      workingDirectory: "/test",
      timestamp: Date.now(),
      toolStates: {},
    });

    await waitFor(() => {
      expectMessageWithContent("Analyzing the codebase...");
    });
  });

  it("shows completion state when agent finishes", async () => {
    render(<ThreadPanel threadId={threadId} />);

    await TestEvents.agentCompleted(threadId);

    await waitFor(() => {
      // ThreadState uses "complete", ThreadMetadata uses "completed"
      expectThreadStatus("complete");
    });
  });

  it("handles agent errors gracefully", async () => {
    render(<ThreadPanel threadId={threadId} />);

    await TestEvents.agentError(threadId, "Connection failed");

    await waitFor(() => {
      expect(screen.getByText(/Connection failed/)).toBeInTheDocument();
    });
  });
});
```

#### 4.3 Error State Test Pattern

```typescript
// Example: Testing error scenarios

import { mockInvoke } from "@/test/mocks/tauri-api";

it("shows error when task load fails", async () => {
  // Override mock for this test
  mockInvoke.mockImplementationOnce(async (cmd) => {
    if (cmd === "fs_read_file") throw new Error("Permission denied");
    throw new Error(`Unmocked: ${cmd}`);
  });

  render(<TaskList />);

  await waitFor(() => {
    expect(screen.getByTestId("error-message")).toHaveTextContent("Permission denied");
  });
});
```

#### 4.4 Testing Disk-as-Truth Flow

For tests that verify the full event->disk->store flow:

```typescript
// Example: Verifying event triggers disk read and store update

import { VirtualFS } from "@/test/helpers/virtual-fs";
import { TestStores } from "@/test/helpers/stores";
import { TestEvents } from "@/test/helpers/event-emitter";

it("refreshes from disk when event fires", async () => {
  // 1. Seed disk with initial state
  VirtualFS.seedTask("my-task", { id: "task-1", status: "todo" });

  // 2. Seed store with DIFFERENT state (simulating stale cache)
  TestStores.seedTask({
    id: "task-1",
    slug: "my-task",
    status: "in-progress", // Intentionally different from disk
    // ... other required fields
  });

  render(<TaskList />);

  // 3. Verify UI shows store state initially
  await waitFor(() => {
    expectTaskHasStatus("task-1", "in-progress");
  });

  // 4. Update disk, emit event
  VirtualFS.updateTask("my-task", { status: "done" });
  await TestEvents.taskUpdated("task-1");

  // 5. Verify store (and UI) now reflects disk state
  // Note: This only works if setupEntityListeners() is called
  await waitFor(() => {
    expectTaskHasStatus("task-1", "done");
  });
});
```

#### 4.5 Error Boundary Testing

```typescript
// Example: Testing error boundaries

import { ErrorBoundary } from "@/components/error-boundary";

const ThrowingComponent = () => {
  throw new Error("Component crashed!");
};

it("shows fallback UI when child throws", () => {
  // Suppress console.error for this test
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  render(
    <ErrorBoundary fallback={<div data-testid="error-fallback">Something went wrong</div>}>
      <ThrowingComponent />
    </ErrorBoundary>
  );

  expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
  spy.mockRestore();
});
```

### Phase 5: Vitest Configuration - COMPLETE

`vitest.config.ui.ts` exists at project root with:
- `environment: "happy-dom"`
- `setupFiles: ["./src/test/setup-ui.ts"]`
- `include: ["src/**/*.ui.test.{ts,tsx}"]`
- Path aliases: `@` -> `./src`, `@core` -> `./core`
- `globals: true`

### Phase 6: NPM Scripts - COMPLETE

```json
{
  "test:ui": "vitest run --config vitest.config.ui.ts",
  "test:ui:watch": "vitest --config vitest.config.ui.ts"
}
```

### Phase 7: Dependencies - COMPLETE

Already in `devDependencies`:
- `@testing-library/react@16.3.0`
- `@testing-library/jest-dom` (for matchers)
- `@testing-library/user-event` (for interactions)
- `happy-dom@20.1.0`
- `vitest@4.0.14`

## File Structure

```
src/
  test/
    setup-ui.ts              # Vitest setup with mocks
    mocks/
      tauri-api.ts           # Mock invoke, emit, listen
    helpers/
      index.ts               # Central re-exports
      virtual-fs.ts          # VirtualFS - disk state seeding
      stores.ts              # TestStores - Zustand seeding (TODO)
      event-emitter.ts       # TestEvents class
      render.ts              # renderUI + re-exports
      queries.ts             # testIds + query helpers
  components/
    task-list.tsx
    task-list.ui.test.tsx    # TODO
    ...
  entities/
    tasks/store.ts           # Zustand store
    threads/store.ts         # Zustand store
    repositories/store.ts    # Zustand store
    settings/store.ts        # Zustand store
    logs/store.ts            # Zustand store (also needs reset)
vitest.config.ui.ts          # Separate config for UI tests
```

## Test Naming Convention

- `*.test.ts` - Unit/integration tests (existing)
- `*.ui.test.ts` - UI isolation tests (new)

This keeps them separate and allows different Vitest configs.

## Performance Expectations

| Test Type | Expected Time |
|-----------|---------------|
| Single UI test | ~10-50ms |
| Full UI test suite (50 tests) | ~2-5 seconds |
| With coverage | ~5-10 seconds |

**Note on act() warnings:** Testing Library's `waitFor` handles React batching automatically. If you see "not wrapped in act()" warnings, ensure you're using `await waitFor()` for all assertions that depend on state updates.

## Migration Path

1. Start with one component (e.g., TaskList)
2. Add test-ids to components as needed
3. Write first UI test to validate the approach
4. Expand to critical paths (task creation, thread streaming)

## Decisions

1. **Test-ID Strategy** - Hybrid approach:
   - Static strings for singleton elements: `"task-list"`, `"thread-panel"`
   - Utility functions for parameterized IDs: `testIds.taskItem(id)` -> `"task-item-${id}"`

2. **Snapshot Testing** - Skip. Behavioral assertions are more meaningful. Add surgically later if needed for stable serialization outputs.

3. **Context providers** - The app uses two React contexts (`GlobalErrorProvider`, `WorkspaceSettingsProvider`) but Zustand stores are the primary state pattern. Tests should mock context hooks directly when needed rather than wrapping in providers. See section 3.1 for example.

4. **happy-dom over jsdom** - Faster startup, lighter memory footprint, sufficient DOM fidelity for UI tests.

5. **Store initialization strategy** - Explicit seeding via `TestStores` class:
   - `TestStores.clear()` in `beforeEach` ensures isolation
   - `TestStores.seedTask()`, `seedThreads()`, etc. for explicit state setup
   - Mirrors `VirtualFS` pattern for consistency
   - Tests declare their required state upfront (no implicit behavior)

6. **Hydration state** - `TestStores.clear()` sets `_hydrated: false`. When seeding via `TestStores.seedTask()` etc., `_hydrated` is set to `true`. This allows testing both hydrated and non-hydrated states.

## Remaining Work

### 1. Zustand Store Initialization (Critical)

**Status:** NOT YET IMPLEMENTED. This file needs to be created.

The current `setup-ui.ts` calls `resetAllMocks()` which clears Tauri mocks but **not** Zustand stores. Stores persist state between tests, causing flaky tests.

**Approach: Explicit Store Seeding**

Follow the same pattern as `VirtualFS` - tests explicitly initialize the store state they need.

#### Implementation: `src/test/helpers/stores.ts` (CREATE THIS FILE)

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

/**
 * Partial thread store state for seeding.
 * All fields are optional - unspecified fields use defaults.
 */
interface ThreadStoreState {
  threads?: Record<string, ThreadMetadata>;
  activeThreadId?: string | null;
  threadStates?: Record<string, ThreadState>;
  activeThreadLoading?: boolean;
  threadErrors?: Record<string, string>;
}

/**
 * Partial repository store state for seeding.
 */
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
   *
   * Sets _hydrated: false on all stores. Use seed methods to set _hydrated: true.
   */
  static clear(): void {
    // Task store - verified against src/entities/tasks/store.ts
    useTaskStore.setState({
      tasks: {},
      taskContent: {},
      _hydrated: false,
    });

    // Thread store - verified against src/entities/threads/store.ts
    useThreadStore.setState({
      threads: {},
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: false,
    });

    // Repository store - verified against src/entities/repositories/store.ts
    useRepoStore.setState({
      repositories: {},
      _hydrated: false,
    });

    // Settings store - verified against src/entities/settings/store.ts
    // Uses DEFAULT_WORKSPACE_SETTINGS which has: repository: null, anthropicApiKey: null, workflowMode: "solo"
    useSettingsStore.setState({
      workspace: DEFAULT_WORKSPACE_SETTINGS,
      _hydrated: false,
    });

    // Logs store - verified against src/entities/logs/store.ts
    useLogStore.setState({
      logs: [],
      _hydrated: false,
    });
  }

  // ==========================================================================
  // Task Store Methods
  // ==========================================================================

  /**
   * Seed task store with multiple tasks.
   * Automatically sets _hydrated: true.
   */
  static seedTasks(tasks: TaskMetadata[]): void {
    const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));
    useTaskStore.setState({ tasks: taskMap, _hydrated: true });
  }

  /**
   * Seed a single task into the store.
   * Merges with existing tasks.
   */
  static seedTask(task: TaskMetadata): void {
    useTaskStore.setState((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
      _hydrated: true,
    }));
  }

  /**
   * Seed task content (markdown body).
   */
  static seedTaskContent(taskId: string, content: string): void {
    useTaskStore.setState((state) => ({
      taskContent: { ...state.taskContent, [taskId]: content },
    }));
  }

  // ==========================================================================
  // Thread Store Methods
  // ==========================================================================

  /**
   * Seed thread store with threads and optional state.
   * Replaces entire store state.
   */
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

  /**
   * Seed a single thread into the store.
   * Merges with existing threads.
   */
  static seedThread(thread: ThreadMetadata): void {
    useThreadStore.setState((state) => ({
      threads: { ...state.threads, [thread.id]: thread },
      _hydrated: true,
    }));
  }

  /**
   * Seed a thread's runtime state (from state.json).
   * Use ThreadState values: status is "running" | "complete" | "error"
   */
  static seedThreadState(threadId: string, state: ThreadState): void {
    useThreadStore.setState((prev) => ({
      threadStates: { ...prev.threadStates, [threadId]: state },
    }));
  }

  /**
   * Set the active thread ID.
   */
  static setActiveThread(threadId: string | null): void {
    useThreadStore.setState({ activeThreadId: threadId });
  }

  // ==========================================================================
  // Repository Store Methods
  // ==========================================================================

  /**
   * Seed repository store.
   * Replaces entire store state.
   */
  static seedRepositories(state: RepoStoreState): void {
    useRepoStore.setState({
      repositories: state.repositories ?? {},
      _hydrated: true,
    });
  }

  /**
   * Seed a single repository.
   * Merges with existing repositories.
   */
  static seedRepository(repo: Repository): void {
    useRepoStore.setState((state) => ({
      repositories: { ...state.repositories, [repo.name]: repo },
      _hydrated: true,
    }));
  }

  // ==========================================================================
  // Settings Store Methods
  // ==========================================================================

  /**
   * Seed settings store.
   */
  static seedSettings(settings: Partial<typeof DEFAULT_WORKSPACE_SETTINGS>): void {
    useSettingsStore.setState({
      workspace: { ...DEFAULT_WORKSPACE_SETTINGS, ...settings },
      _hydrated: true,
    });
  }

  // ==========================================================================
  // Getter Methods (for assertions)
  // ==========================================================================

  /**
   * Get current task store state (for assertions).
   */
  static getTaskState() {
    return useTaskStore.getState();
  }

  /**
   * Get current thread store state (for assertions).
   */
  static getThreadState() {
    return useThreadStore.getState();
  }

  /**
   * Get current repository store state (for assertions).
   */
  static getRepoState() {
    return useRepoStore.getState();
  }

  /**
   * Get current settings store state (for assertions).
   */
  static getSettingsState() {
    return useSettingsStore.getState();
  }

  /**
   * Get current logs store state (for assertions).
   */
  static getLogsState() {
    return useLogStore.getState();
  }
}
```

#### Update `setup-ui.ts` (REQUIRED CHANGE)

The current `setup-ui.ts` does NOT clear Zustand stores. Add this:

```typescript
// src/test/setup-ui.ts - ADD THIS IMPORT
import { TestStores } from "./helpers/stores";

// MODIFY the existing beforeEach to add TestStores.clear()
beforeEach(() => {
  resetAllMocks();        // Clears Tauri mocks and VirtualFS
  TestStores.clear();     // ADD THIS - clears Zustand stores
});
```

Also update `src/test/helpers/index.ts` to export `TestStores`:

```typescript
// src/test/helpers/index.ts - ADD THIS LINE
export { TestStores } from "./stores";
```

#### When to Seed Disk vs Store

| Scenario | Seed Disk (VirtualFS) | Seed Store (TestStores) |
|----------|----------------------|------------------------|
| Component reads from Zustand store | No | Yes |
| Component triggers Tauri command that reads disk | Yes | Maybe (if store caches) |
| Testing event-driven updates | Yes (new state) | No (event handler updates store) |
| Testing initial render | Depends on data flow | Usually yes |
| Testing hydration flow | Yes | No (verify store gets populated) |
| Testing optimistic updates | No | Yes (then verify disk write) |

**Rule of thumb:** If the component uses `useTaskStore()` directly, seed the store. If it calls a service that reads from disk, seed the disk.

#### ThreadMetadata Required Fields

When seeding threads via `TestStores.seedThread()`, you must provide a complete `ThreadMetadata` object. The schema requires these fields (from `src/entities/threads/types.ts`):

```typescript
const thread: ThreadMetadata = {
  id: "thread-123",
  taskId: "task-abc",
  agentType: "execution",           // Required: "entrypoint" | "execution" | "review" | etc.
  workingDirectory: "/Users/test/worktrees/my-task",
  status: "running",                // "idle" | "running" | "completed" | "error" | "paused"
  createdAt: Date.now(),
  updatedAt: Date.now(),
  turns: [],                        // Required: array of ThreadTurn
  git: {                            // Optional
    branch: "anvil/my-task",
    commitHash: "abc123",
  },
  ttlMs: undefined,                 // Optional
};

TestStores.seedThread(thread);
```

Note: `VirtualFS.seedThread()` creates a minimal metadata.json that may not pass schema validation. For comprehensive tests, seed the store directly with complete metadata.

### 2. Add data-testid Attributes to Components

Components need `data-testid` attributes matching `testIds` in `queries.ts`:

| Component | Required testids |
|-----------|-----------------|
| TaskList | `task-list`, `task-item-{id}`, `task-status-{id}`, `task-title-{id}` |
| ThreadPanel | `thread-panel`, `thread-status`, `message-list`, `message-{n}` |
| KanbanBoard | `kanban-board`, `kanban-column-{status}`, `kanban-card-{id}` |
| Spotlight | `spotlight`, `spotlight-input`, `spotlight-results` |
| Common | `loading-spinner`, `error-message`, `empty-state` |

### 3. Write First Real Test

Start with a simple component to validate the full flow:

1. Pick a leaf component (e.g., `TaskStatusBadge`)
2. Add `data-testid` attributes
3. Write a `.ui.test.tsx` file
4. Run `pnpm test:ui` to verify setup works

## Troubleshooting

### Common Issues

**"Component not re-rendering after event"**
1. Check if `TestStores.clear()` was called in `beforeEach` (requires implementing stores.ts first)
2. Verify the component subscribes via mitt `eventBus`, not Tauri's `listen()`
3. Use `await waitFor()` for assertions, not synchronous expects
4. If testing full event->store flow, ensure `setupEntityListeners()` is called

**"Unmocked Tauri command: xyz"**
- Add the missing command to `mockInvoke` in `tauri-api.ts`
- Check if the command name matches exactly (case-sensitive)

**"File not found" in tests**
- Use `VirtualFS.seed()` or `VirtualFS.seedTask()` to create the file
- Verify the path matches what the component requests

**Filesystem reset behavior**
- `resetAllMocks()` in `tauri-api.ts` calls `mockFileSystem.clear()`, which clears VirtualFS
- You do NOT need to call `VirtualFS.clear()` separately in `beforeEach`
- If you need explicit VirtualFS control, `VirtualFS.clear()` is available

**Inspecting state during tests**
```typescript
// Inspect virtual filesystem
console.log(VirtualFS.allPaths());
console.log(VirtualFS.get("/path/to/file"));

// Inspect store state (requires TestStores implementation)
console.log(TestStores.getTaskState());
console.log(TestStores.getThreadState());

// Inspect event listeners
import { eventBus } from "@/entities/events";
console.log([...eventBus.all.keys()]);
```

**act() warnings**
- Always use `await waitFor()` for state-dependent assertions
- Use `userEvent.setup()` for interactions (returns promises)
- If warning persists, wrap the action in `act()` explicitly

**Portal-rendered components (modals, tooltips, dropdowns)**
- Portals render to `document.body`, outside the component tree
- `screen` queries the entire document, so most cases work automatically
- For portals using custom containers, ensure the container exists in happy-dom:
```typescript
beforeEach(() => {
  // Create portal target if needed
  const portalRoot = document.createElement("div");
  portalRoot.id = "portal-root";
  document.body.appendChild(portalRoot);
});
```

**Event listeners cleared between tests**
- `TestEvents.clearAllListeners()` is called in `afterEach` by `setup-ui.ts`
- This clears ALL listeners from the mitt event bus, including any registered by components
- This is intentional - components should re-register listeners when they mount during each test

### CI Integration

UI tests run alongside other tests in CI. No special configuration needed for happy-dom.

```yaml
# Example CI step
- name: Run UI Tests
  run: pnpm test:ui
```

For parallel execution, Vitest handles this automatically with its worker pool.

**Retry strategy for flaky tests:**

```yaml
# With retry on failure
- name: Run UI Tests
  run: pnpm test:ui --retry=2
```

Or configure in `vitest.config.ui.ts`:

```typescript
export default defineConfig({
  test: {
    retry: process.env.CI ? 2 : 0,
  },
});
```

**Note:** If tests are consistently flaky, fix the root cause rather than relying on retries. Common causes:
- Missing `await waitFor()` for async state updates
- Race conditions in event handlers
- Timer-dependent code without fake timers

## Summary

| Item | Status | Notes |
|------|--------|-------|
| Vitest + happy-dom config | Complete | `vitest.config.ui.ts` at project root |
| Mock at module boundaries | Complete | `src/test/mocks/tauri-api.ts` |
| VirtualFS for disk state | Complete | `src/test/helpers/virtual-fs.ts` |
| TestStores for Zustand state | **TODO** | Implementation provided above, needs creating |
| TestEvents for event injection | Complete | `src/test/helpers/event-emitter.ts` |
| Test-id query helpers | Complete | `src/test/helpers/queries.ts` |
| Timer mocking guidance | Complete | Documented in section 3.4 |
| Portal testing guidance | Complete | Documented in Troubleshooting |
| Context hook mocking | Complete | Documented in section 3.1 |
| renderWithRouter helper | **TODO** | Implementation provided above, needs adding |
| setup-ui.ts store clearing | **TODO** | Needs `TestStores.clear()` in beforeEach |
| index.ts re-exports | Partial | Exists, needs `TestStores` export added |
| Component data-testids | Missing | Components need testids added |
| Actual test files | Missing | Need real `.ui.test.tsx` files |
| NPM scripts | Complete | `test:ui`, `test:ui:watch` verified in package.json |
| CI retry strategy | Complete | Documented in CI Integration section |

**Next steps (in order):**
1. Create `src/test/helpers/stores.ts` with `TestStores` class (copy implementation from above)
2. Update `src/test/helpers/index.ts` to export `TestStores`
3. Update `src/test/setup-ui.ts` to import and call `TestStores.clear()` in `beforeEach`
4. (Optional) Add `renderWithRouter` to `src/test/helpers/render.ts`
5. Add data-testids to a simple component
6. Write first `.ui.test.tsx` to validate the full setup

Real browser testing (visual regression, cross-browser) is covered by existing accessibility-based E2E tests.

## Changes Made - Round 1

### Critical Fixes

1. **Fixed TestStores implementation** (Gap #1)
   - Added `taskContent` to task store clear
   - Added `activeThreadLoading` and `threadErrors` to thread store clear
   - Fixed settings store to use `DEFAULT_WORKSPACE_SETTINGS` instead of incorrect `{ repositories: {}, version: 1 }`
   - Added logs store to `TestStores.clear()`
   - Added proper type imports from actual source files

2. **Clarified status type differences** (Gap #2)
   - Added new "Status Type Clarification" section with table showing differences
   - `ThreadState.status`: `"running" | "complete" | "error"` (agent runtime state)
   - `ThreadMetadata.status`: `"idle" | "running" | "completed" | "error" | "paused"` (thread metadata)
   - Noted that `VirtualFS.seedThread()` handles conversion automatically

3. **Added logs store** (Gap #3)
   - Added `useLogStore` to `TestStores.clear()`
   - Updated file structure to show `logs/store.ts`

### Moderate Fixes

4. **Documented event flow limitation** (Gap #4)
   - Added "Event Flow Note" under TestEvents section explaining that events go directly to mitt, skipping Tauri bridge
   - Clarified that components should subscribe via mitt, not Tauri's `listen()`

5. **Expanded disk vs store seeding table** (Gap #5)
   - Added scenarios: "Testing hydration flow", "Testing optimistic updates"
   - Added example test pattern for verifying disk-as-truth flow

6. **Added router integration guidance** (Gap #6)
   - Added `renderWithRouter` helper with `route` and `path` parameters
   - Added usage example showing how to test components with route params

7. **Documented missing commands** (Gap #7)
   - Added list of additional commands to add as needed: `fs_create_dir`, `fs_copy`, `git_fetch`, etc.

8. **Added act() warning handling** (Gap #8)
   - Added note under Performance Expectations about act() warnings
   - Added troubleshooting entry for act() warnings

### Minor Fixes

9. **Fixed example test task IDs** (Gap #9)
   - Updated examples to pass explicit `id` to `VirtualFS.seedTask()` for predictable assertions
   - Showed pattern of capturing returned task and using its ID

10. **Fixed spy() return type** (Gap #10)
    - Updated documentation comment to note "returns vi.Mock, not jest.Mock"

11. **Added user event setup guidance** (Gap #11)
    - Added section 3.3 showing `userEvent.setup()` per test for isolation

12. **Added coverage decision to user discretion** (Gap #12)
    - Added to "Requires User Discretion" section with three options

13. **Added CSS/style testing decision** (Gap #13)
    - Added to "Requires User Discretion" section with three options

### Architecture Fixes

14. **Added disk-as-truth test pattern** (Gap #14)
    - Added example 4.4 showing how to test full event->disk->store flow

15. **Added entity listeners decision** (Gap #15)
    - Added to "Requires User Discretion" section with three options
    - Documented the tradeoff between realistic flow and test simplicity

16. **Clarified hydration state handling** (Gap #16)
    - Added decision #6 about hydration state
    - `clear()` sets `_hydrated: false`, seeding sets `_hydrated: true`

### Missing Scenario Fixes

17. **Added error boundary testing** (Gap #17)
    - Added example 4.5 showing error boundary test pattern

18. **Did not add concurrent testing guidance** (Gap #18)
    - This is an advanced topic; basic tests should be working first
    - Can be added in a future round if needed

19. **Did not add detailed accessibility testing** (Gap #19)
    - Basic accessibility (ARIA, keyboard) can use existing testing-library matchers
    - Detailed a11y testing is better suited for E2E tests

### Documentation Fixes

20. **Added Troubleshooting section** (Gap #20)
    - Common issues and solutions
    - How to inspect state during tests
    - How to debug event flow

21. **Added CI Integration section** (Gap #21)
    - Basic CI example
    - Note about parallel execution

### Removed

- Removed "Gaps Identified - Round 1" section (replaced by this changes documentation)

## Changes Made - Round 2

Addressed all 14 gaps identified in the Round 2 review by verifying against actual codebase files and updating the plan accordingly.

### Critical Fixes

#### 1. Clarified TestStores Implementation Status (Gap #1)
- **Changed:** Updated Implementation Status table to show `**TODO**` with clear note
- **Changed:** Added explicit "Status: NOT YET IMPLEMENTED" to section header
- **Changed:** Added "(CREATE THIS FILE)" to the implementation code block header
- **Changed:** Updated summary table to show three separate TODO items (stores.ts, setup-ui.ts change, index.ts export)
- **Changed:** Added concrete next steps in order

#### 2. Standardized Type Import Documentation (Gap #2)
- **Changed:** Completely rewrote "Type Imports (Resolved)" section
- **Added:** Clear import chain documentation for `ThreadState` showing 4-step path
- **Added:** Separate import chain for `ThreadMetadata`
- **Added:** Comments in code examples showing which imports are from core vs frontend
- **Fixed:** TestStores implementation now imports `ThreadState` from `@/lib/types/agent-messages` (matching thread store pattern)

### Moderate Fixes

#### 3. Documented spy() Type Issue (Gap #3)
- **Changed:** Updated the spy() example comment to explicitly note the type annotation mismatch
- **Added:** Note that the actual code uses `jest.Mock` type but returns `vi.fn()` which is `MockInstance`
- **Action:** This is a documentation acknowledgment; the actual fix requires code change to `event-emitter.ts`

#### 4. Marked renderWithRouter as TODO (Gap #4)
- **Changed:** Section 3.2 header from "Router Integration" to "Router Integration (TODO)"
- **Added:** "Status: Not yet implemented" at the start of the section
- **Added:** "ADD THIS" comment in the code block to clarify it needs to be added
- **Added:** Instruction to update index.ts exports once implemented

#### 5. Documented VirtualFS Status Conversion Limitations (Gap #5)
- **Changed:** "Status Type Clarification" section now explicitly lists the conversion rules
- **Added:** Bullet points showing: completed->complete, error->error, others->running
- **Added:** Note explaining this is intentionally lossy for edge cases
- **Added:** Guidance to use `VirtualFS.seed()` directly for testing edge cases like "idle" or "paused"

#### 6. Documented Index Re-exports (Gap #6)
- **Added:** Note in setup-ui.ts update section to add `TestStores` export to index.ts
- **Verified:** index.ts exists and currently exports VirtualFS, TestEvents, render utilities, and queries
- **Note:** Central imports like `import { VirtualFS, TestEvents } from "@/test/helpers"` ARE supported

### Minor Fixes

#### 7. MOCK_HOME_DIR Documentation (Gap #7)
- These constants are already documented in Phase 1.5 section
- **Verified:** `MOCK_HOME_DIR` and `MOCK_ANVIL_DIR` are exported from `tauri-api.ts`
- **Note:** `VirtualFS` imports these from tauri-api.ts, so tests can use VirtualFS helpers

#### 8. ThreadMetadata Schema Fields (Gap #8)
- **Added:** New "ThreadMetadata Required Fields" section under "When to Seed Disk vs Store"
- **Added:** Complete example showing all required fields from the actual schema
- **Added:** Note that VirtualFS.seedThread() creates minimal metadata that may not validate

#### 9. Example Tests Clarified (Gap #9)
- **Added:** "Important notes" block at start of Phase 4 section
- **Added:** Note that component names and props are illustrative
- **Added:** Note to verify actual component signatures before implementing

#### 10. Hook Testing Guidance (Gap #10)
- **Deferred:** Hook testing is an advanced topic beyond current scope
- **Rationale:** Basic component testing should work first; hook testing can be added later

### Documentation Fixes

#### 11. Type Import Chain Clarity (Gap #11)
- **Addressed:** By the complete rewrite of "Type Imports (Resolved)" section (see Fix #2)

#### 12. VirtualFS Reset Behavior (Gap #12)
- **Added:** "Filesystem reset behavior" section in Troubleshooting
- **Documented:** `resetAllMocks()` calls `mockFileSystem.clear()` automatically
- **Clarified:** No need to call `VirtualFS.clear()` separately in beforeEach

#### 13. Event Bus Clear Safety (Gap #13)
- **Added:** "Event listeners cleared between tests" section in Troubleshooting
- **Documented:** This is intentional - components re-register listeners on mount during each test
- **Clarified:** The pattern assumes React component lifecycle manages listener registration

#### 14. Package.json Scripts Verified (Gap #14)
- **Verified:** Checked actual package.json - scripts exist and are correct:
  - `"test:ui": "vitest run --config vitest.config.ui.ts"`
  - `"test:ui:watch": "vitest --config vitest.config.ui.ts"`
- **Updated:** Summary table now notes "verified in package.json"

### Additional Improvements

- **Updated:** Summary table now has three columns (Item, Status, Notes) for clarity
- **Updated:** Next steps are now numbered and in dependency order
- **Added:** Explicit file paths throughout to remove ambiguity
- **Verified:** All store shapes match actual implementations in:
  - `src/entities/tasks/store.ts`
  - `src/entities/threads/store.ts`
  - `src/entities/repositories/store.ts`
  - `src/entities/settings/store.ts`
  - `src/entities/logs/store.ts`

## Review Complete - Round 3

After thorough verification against the actual codebase, **the plan is ready for implementation** with one minor observation documented below.

### Verification Summary

All critical elements have been verified against the actual codebase:

**1. Store Shapes - VERIFIED**
- Task store: `{ tasks, taskContent, _hydrated }` matches `src/entities/tasks/store.ts` exactly
- Thread store: `{ threads, activeThreadId, threadStates, activeThreadLoading, threadErrors, _hydrated }` matches `src/entities/threads/store.ts` exactly
- Repository store: `{ repositories, _hydrated }` matches `src/entities/repositories/store.ts` exactly
- Settings store: `{ workspace, _hydrated }` with `DEFAULT_WORKSPACE_SETTINGS` matches `src/entities/settings/store.ts` exactly
- Logs store: `{ logs, _hydrated }` matches `src/entities/logs/store.ts` exactly

**2. Type Imports - VERIFIED**
- `ThreadState` type chain: `@core/types/events.ts` -> `@/lib/types/agent-messages.ts` -> `@/entities/events.ts` is correct
- `ThreadMetadata` from `@/entities/threads/types.ts` is correct
- `TaskMetadata` re-export chain from `core/types/tasks.ts` is correct
- `DEFAULT_WORKSPACE_SETTINGS` from `@/entities/settings/types.ts` is correct

**3. Status Type Differences - VERIFIED**
- `ThreadState.status` uses `"running" | "complete" | "error"` (line 36: `AgentThreadStatusSchema = z.enum(["running", "complete", "error"])`)
- `ThreadMetadata.status` uses `"idle" | "running" | "completed" | "error" | "paused"` (line 3 of threads/types.ts)
- The plan correctly documents this distinction

**4. Test Infrastructure - VERIFIED**
- `vitest.config.ui.ts` exists with correct configuration (happy-dom, setup file, includes pattern)
- `src/test/setup-ui.ts` exists with Tauri mocks and lifecycle hooks
- `src/test/mocks/tauri-api.ts` exists with all mock implementations
- `src/test/helpers/` contains: `virtual-fs.ts`, `event-emitter.ts`, `render.ts`, `queries.ts`, `index.ts`
- NPM scripts verified: `test:ui` and `test:ui:watch` exist in `package.json`

**5. Dependencies - VERIFIED**
- `@testing-library/react@16.3.0` - present
- `@testing-library/jest-dom@6.9.1` - present
- `@testing-library/user-event@14.6.1` - present
- `happy-dom@20.1.0` - present
- `vitest@4.0.14` - present

**6. Event System - VERIFIED**
- `EventName` constants and `AppEvents` type are correctly exported from `@/entities/events.ts`
- `eventBus` is a mitt instance that `TestEvents` correctly interfaces with

**7. VirtualFS Status Conversion - VERIFIED**
- Lines 190-191 of `virtual-fs.ts` correctly convert `"completed" -> "complete"` and `"error" -> "error"`, with others defaulting to `"running"`

### Minor Observation (Not a Gap)

The plan's `TestStores` implementation shows importing `vi` from `"vitest"` for the `spy()` method type annotation issue. However, the `event-emitter.ts` file already imports `vi` at the top level. The type annotation `jest.Mock` on line 254 is technically incorrect (should be `MockInstance` from vitest), but this is purely a type annotation issue that does not affect runtime behavior. The plan already documents this in the "Changes Made - Round 2" section, acknowledging it as a documentation-only fix.

### Implementation Readiness Checklist

The plan provides:
- [x] Clear implementation status table with TODO items marked
- [x] Complete code for `TestStores` class ready to copy
- [x] Required changes to `setup-ui.ts` documented
- [x] Required changes to `index.ts` documented
- [x] Ordered next steps for implementation
- [x] Complete troubleshooting guide
- [x] Three "Requires User Discretion" items properly framed
- [x] Example tests with caveats about illustrative nature

### Conclusion

The plan is internally consistent, technically accurate, and provides everything a developer needs to implement the remaining TODO items. No meaningful gaps remain. The plan can proceed to implementation.

## Changes Made - Round 4

Addressed gaps identified in external review.

### Additions

1. **Timer mocking guidance** (Section 3.4)
   - Added `vi.useFakeTimers()` / `vi.useRealTimers()` pattern
   - Documented `vi.advanceTimersByTime()` for testing intervals
   - Documented `vi.setSystemTime()` for date-dependent tests
   - Added note about `userEvent.setup({ advanceTimers })` interaction

2. **Portal testing guidance** (Troubleshooting section)
   - Documented that `screen` queries the entire document
   - Added pattern for creating custom portal containers in happy-dom

3. **CI retry strategy** (CI Integration section)
   - Added command-line retry flag example
   - Added vitest.config.ts retry configuration
   - Documented common flakiness causes to fix rather than retry

4. **Test data factories decision** (Requires User Discretion #4)
   - Added decision point for when to introduce factory helpers
   - Three options: now, never, or after ~20 tests

### Changes

5. **Context provider strategy** (Section 3.1, Decision #3)
   - Removed AllProviders wrapper recommendation
   - Replaced with direct hook mocking pattern for `useWorkspaceSettings()` and `useGlobalError()`
   - Documents that most components use Zustand stores and won't need this

6. **Updated Summary table**
   - Added timer mocking, portal testing, context hook mocking, CI retry strategy as Complete
   - Total items tracked: 16

### Not Added (Per User Request)

- Role-based queries guidance (user prefers testid approach)
