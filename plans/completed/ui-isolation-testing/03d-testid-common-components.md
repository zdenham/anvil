# Sub-Plan: Test IDs for Common Components

**Dependencies:** None
**Blocks:** Tests that check loading/error/empty states
**Parallel With:** 03a, 03b, 03c

## Objective

Add `data-testid` attributes to shared/common components used across the app for stable test selectors.

## Component Discovery

Before implementing, locate the actual components in the codebase:

```bash
# Find loading-related components
grep -r "loading\|spinner" src/components --include="*.tsx" -l

# Find error-related components
grep -r "error" src/components --include="*.tsx" -l

# Find empty state components
grep -r "empty" src/components --include="*.tsx" -l

# Find spotlight components
ls src/components/spotlight/
```

## Known Components

Based on codebase analysis, the following components exist:

| Component | Location | Purpose |
|-----------|----------|---------|
| EmptyState (thread) | `src/components/thread/empty-state.tsx` | Empty message list in thread panel |
| DiffEmptyState | `src/components/diff-viewer/diff-empty-state.tsx` | No changes to display |
| Spotlight | `src/components/spotlight/spotlight.tsx` | Command palette (main component) |
| ResultsTray | `src/components/spotlight/results-tray.tsx` | Spotlight results container |
| SearchInput | `src/components/reusable/search-input.tsx` | Reusable search input (used by Spotlight) |

**Note:** Generic `LoadingSpinner` and `ErrorMessage` components do not currently exist as standalone components. They may be inline in consuming components. Check if these need to be extracted or if test IDs should be added directly in consuming components.

## Required Test IDs

Based on `src/test/helpers/queries.ts`:

### Loading/Error/Empty States
```tsx
// Loading spinner - apply to any loading indicator
data-testid="loading-spinner"

// Error message container - apply to error displays
data-testid="error-message"

// Empty state container - apply to empty state displays
data-testid="empty-state"
```

### Spotlight (Command Palette)
```tsx
// Main spotlight container
data-testid="spotlight"

// Search input field
data-testid="spotlight-input"

// Results list container
data-testid="spotlight-results"

// Individual result items (parameterized)
data-testid={`spotlight-result-${index}`}  // e.g., spotlight-result-0
```

## Implementation

### 1. Thread EmptyState

**File:** `src/components/thread/empty-state.tsx`

Add test ID to the container div:

```tsx
export function EmptyState({ isRunning = false }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"  // ADD THIS
      className="flex flex-col items-center justify-center flex-1 gap-3 text-surface-400"
      role="status"
      aria-live="polite"
    >
      {/* ... existing content */}
    </div>
  );
}
```

### 2. DiffEmptyState

**File:** `src/components/diff-viewer/diff-empty-state.tsx`

Add test ID to the container div:

```tsx
export function DiffEmptyState() {
  return (
    <div
      data-testid="empty-state"  // ADD THIS
      className="flex flex-col items-center justify-center py-12 text-surface-400"
      role="status"
      aria-live="polite"
    >
      {/* ... existing content */}
    </div>
  );
}
```

### 3. Spotlight Components

**File:** `src/components/spotlight/spotlight.tsx`

The Spotlight component is complex with separate sub-components. Add test IDs as follows:

In the main `Spotlight` component's return statement:
```tsx
return (
  <div data-testid="spotlight" className={spotlightClasses}>  {/* ADD data-testid */}
    <form onSubmit={handleSubmit}>
      <SearchInput
        ref={inputRef}
        data-testid="spotlight-input"  {/* Pass through to input */}
        // ... other props
      />
    </form>
    <ResultsTray
      data-testid="spotlight-results"  {/* Pass for container */}
      results={results}
      // ... other props
    />
  </div>
);
```

**File:** `src/components/spotlight/results-tray.tsx`

Add test IDs to the results container and individual items:
```tsx
// Container
<div data-testid="spotlight-results" className="...">

// Individual result items (in map)
<div
  key={index}
  data-testid={`spotlight-result-${index}`}
  className="..."
>
```

**File:** `src/components/reusable/search-input.tsx`

Ensure the input element accepts and applies `data-testid`:
```tsx
// If not already forwarding, add to input element
<textarea
  data-testid={props['data-testid']}
  // ... other props
/>
```

### 4. Loading and Error Components

**Action Required:** Search the codebase for inline loading/error patterns:

```bash
grep -r "loading\|spinner" src/components --include="*.tsx" -A 5
grep -r "error.*message\|Error" src/components --include="*.tsx" -A 5
```

Depending on findings:
- **If inline patterns exist:** Add test IDs directly where loading/error states render
- **If extraction is warranted:** Create `src/components/ui/loading-spinner.tsx` and `src/components/ui/error-message.tsx` with test IDs built in

## Steps

1. **Verify component locations**
   ```bash
   # Confirm files exist at expected paths
   ls -la src/components/thread/empty-state.tsx
   ls -la src/components/diff-viewer/diff-empty-state.tsx
   ls -la src/components/spotlight/spotlight.tsx
   ls -la src/components/spotlight/results-tray.tsx
   ```

2. **Add test IDs to EmptyState components**
   - `src/components/thread/empty-state.tsx`
   - `src/components/diff-viewer/diff-empty-state.tsx`

3. **Add test IDs to Spotlight components**
   - Main container in `spotlight.tsx`
   - Input field (may require prop forwarding through `SearchInput`)
   - Results container and items in `results-tray.tsx`

4. **Investigate loading/error components**
   - Search for existing patterns
   - Either add inline test IDs or create standalone components

5. **Verify test ID alignment with queries.ts**
   - Cross-reference with `src/test/helpers/queries.ts` test ID constants
   - Ensure all expected IDs are implemented

## Verification

```bash
# TypeScript check
pnpm typecheck

# Build verification
pnpm build

# Verify test IDs are in place
grep -r "data-testid" src/components/thread/empty-state.tsx
grep -r "data-testid" src/components/spotlight/
```

## Test Query Examples

```typescript
import { isLoading, hasError } from "@/test/helpers/queries";
import { screen, waitFor } from "@testing-library/react";

// Check loading state
render(<TaskList />);
expect(isLoading()).toBe(true);

await waitFor(() => {
  expect(isLoading()).toBe(false);
});

// Check error state
mockInvoke.mockRejectedValueOnce(new Error("Network error"));
render(<TaskList />);

await waitFor(() => {
  expect(hasError()).toBe(true);
  expect(screen.getByTestId("error-message")).toHaveTextContent("Network error");
});

// Check empty state
TestStores.seedTasks([]);
render(<TaskList />);

await waitFor(() => {
  expect(screen.getByTestId("empty-state")).toBeInTheDocument();
});

// Spotlight interaction
render(<Spotlight />);
const input = screen.getByTestId("spotlight-input");
await userEvent.type(input, "test query");

await waitFor(() => {
  expect(screen.getByTestId("spotlight-results")).toBeInTheDocument();
  expect(screen.getByTestId("spotlight-result-0")).toBeInTheDocument();
});
```

## Open Questions

1. **Multiple empty states:** Both `EmptyState` (thread) and `DiffEmptyState` use `empty-state` test ID. Consider if they need distinct IDs (e.g., `thread-empty-state`, `diff-empty-state`) for targeted testing.

2. **Loading component location:** No standalone loading spinner exists. Should one be created, or should test IDs be added to inline loading patterns?

3. **Error component pattern:** Similar to loading - clarify where error displays occur and whether to extract or annotate inline.

## Notes

- Do not change component behavior, only add data-testid attributes
- For components not accepting `data-testid` prop, spread props or add explicit prop
- Test IDs should match exactly with `src/test/helpers/queries.ts` constants
- The Spotlight component uses multiple sub-components; ensure test IDs are properly forwarded
