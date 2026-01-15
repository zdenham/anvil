# Sub-Plan: Router Integration Helper

**Status:** COMPLETE
**Dependencies:** None
**Blocks:** Tests for routed components (ThreadPanel, TaskDetail, etc.)
**Estimated Scope:** ~30 lines of code

## Objective

Add a `renderWithRouter` helper to enable testing components that depend on React Router hooks (`useParams`, `useNavigate`, `useLocation`). This is a prerequisite for testing any component that extracts data from URL parameters or performs programmatic navigation.

## Problem Statement

Components like `ThreadPanel` extract `taskId` and `threadId` from URL parameters via `useParams()`. Without router context, these components fail to render in tests:

```
Error: useParams() may only be used in the context of a <Router> component.
```

The `renderWithRouter` helper provides a lightweight `MemoryRouter` wrapper that:
1. Sets up a virtual URL for the test (e.g., `/tasks/task-123/threads/thread-456`)
2. Defines the route pattern so `useParams()` extracts the correct values
3. Returns standard testing-library render result for assertions

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/test/helpers/render.tsx` | MODIFY | Add `renderWithRouter` function and types |
| `src/test/helpers/index.ts` | MODIFY | Export `renderWithRouter` |

## Implementation

### 1. Update `src/test/helpers/render.tsx`

Add these imports at the top of the file:

```typescript
import { MemoryRouter, Routes, Route } from "react-router-dom";
```

Add the following type and function after the existing `renderUI` function:

```typescript
// ============================================================================
// Router Integration
// ============================================================================

interface RenderWithRouterOptions extends Omit<RenderOptions, "wrapper"> {
  /**
   * The URL to navigate to (e.g., "/tasks/task-123/threads/thread-456").
   * This becomes the initial entry in MemoryRouter.
   */
  route?: string;

  /**
   * The route pattern for matching (e.g., "/tasks/:taskId/threads/:threadId").
   * If not specified, defaults to the `route` value (exact match).
   */
  path?: string;
}

/**
 * Render a component with React Router context.
 *
 * Use this for components that use useParams, useNavigate, or useLocation.
 * The component is rendered inside a MemoryRouter with Routes configured
 * to match the specified path pattern.
 *
 * @param ui - The React element to render
 * @param options - Route configuration and standard render options
 * @returns Standard testing-library render result
 *
 * @example
 * // Testing a component that reads route params
 * renderWithRouter(<ThreadPanel />, {
 *   route: "/tasks/task-123/threads/thread-456",
 *   path: "/tasks/:taskId/threads/:threadId"
 * });
 *
 * // The component can now call useParams() and receive:
 * // { taskId: "task-123", threadId: "thread-456" }
 *
 * @example
 * // Testing a component with navigation
 * renderWithRouter(<TaskCard taskId="task-123" />, {
 *   route: "/tasks",
 *   path: "/tasks"
 * });
 * // Component can call useNavigate() to navigate
 */
export function renderWithRouter(
  ui: ReactElement,
  { route = "/", path = route, ...renderOptions }: RenderWithRouterOptions = {}
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={ui} />
      </Routes>
    </MemoryRouter>,
    renderOptions
  );
}
```

### 2. Update `src/test/helpers/index.ts`

Add export for the new helper:

```typescript
export { renderWithRouter } from "./render";
```

## Usage Patterns

### Pattern 1: Component with Route Parameters

For components that extract data from URL parameters:

```typescript
import { renderWithRouter, screen, waitFor } from "@/test/helpers";
import { VirtualFS } from "@/test/helpers/virtual-fs";
import { TestStores } from "@/test/helpers/stores";
import { ThreadPanel } from "./thread-panel";

describe("ThreadPanel", () => {
  it("displays thread from URL params", async () => {
    // Seed required data
    const task = VirtualFS.seedTask("my-task", { id: "task-123" });
    VirtualFS.seedThread("my-task", "thread-456", { status: "running" });
    TestStores.seedTask(task);

    // Render with route context
    renderWithRouter(<ThreadPanel />, {
      route: "/tasks/task-123/threads/thread-456",
      path: "/tasks/:taskId/threads/:threadId"
    });

    // Assert on rendered content
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toBeInTheDocument();
    });
  });
});
```

### Pattern 2: Component with Navigation

For components that programmatically navigate:

```typescript
import { renderWithRouter, screen } from "@/test/helpers";
import userEvent from "@testing-library/user-event";
import { TaskCard } from "./task-card";

it("navigates to task detail on click", async () => {
  const user = userEvent.setup();

  renderWithRouter(<TaskCard taskId="task-123" />, {
    route: "/tasks",
    path: "/tasks"
  });

  await user.click(screen.getByTestId("task-card-task-123"));

  // Note: MemoryRouter doesn't expose URL directly, but you can:
  // 1. Assert on content changes if the route renders different content
  // 2. Use a spy on the navigate function if needed for more precise testing
});
```

### Pattern 3: Component with Location State

For components that read from `useLocation()`:

```typescript
import { renderWithRouter, screen } from "@/test/helpers";
import { SearchResults } from "./search-results";

it("displays search query from location state", () => {
  renderWithRouter(<SearchResults />, {
    route: "/search?q=fix+bug",
    path: "/search"
  });

  // Component can access query params via useLocation().search
  expect(screen.getByTestId("search-query")).toHaveTextContent("fix bug");
});
```

## Limitations

1. **No URL assertion**: MemoryRouter does not expose the current URL for direct assertion. Test navigation by asserting on rendered content changes or by mocking `useNavigate`.

2. **Single route per render**: The helper renders one route at a time. For testing navigation between routes, either:
   - Render multiple routes in a custom wrapper
   - Assert on component behavior rather than URL changes

3. **No history manipulation**: Cannot test browser back/forward. Use `initialEntries` array for multi-step history if needed.

## Verification

After implementing, verify by running:

```bash
# TypeScript should compile without errors
pnpm tsc --noEmit

# Existing UI tests should still pass
pnpm test:ui
```

Then validate with a simple test:

```typescript
// Quick validation test
import { renderWithRouter, screen } from "@/test/helpers";

function TestComponent() {
  const params = useParams();
  return <div data-testid="params">{JSON.stringify(params)}</div>;
}

it("provides route params", () => {
  renderWithRouter(<TestComponent />, {
    route: "/test/abc",
    path: "/test/:id"
  });

  expect(screen.getByTestId("params")).toHaveTextContent('{"id":"abc"}');
});
```

## Related Documentation

- **Parent plan**: `/plans/ui-isolation-testing.md` - Section 3.2 documents the router integration requirement
- **Render helper**: `src/test/helpers/render.tsx` - Existing render infrastructure
- **React Router docs**: [MemoryRouter](https://reactrouter.com/en/main/router-components/memory-router)
