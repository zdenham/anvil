# Global Error State Implementation Plan

## Overview
Implement a global error view that can be displayed in any window, fitting any window size. The error view shows an error message and provides a button to copy the stack trace. The spotlight task creation flow will be wrapped to display this error view on failure.

## Requirements
- Fits any window size (responsive, minimal UI)
- Shows error message text
- Button to copy stack trace to clipboard
- Wrap spotlight task creation flow to catch and display errors

---

## Implementation Steps

### Step 1: Create Global Error View Component

**File**: `src/components/global-error-view.tsx`

A simple, full-screen error component that:
- Centers content vertically and horizontally using flexbox
- Shows error message in readable text
- Has a "Copy Stack Trace" button
- Uses existing styling patterns (Tailwind, cn utility, Button component)

```tsx
interface GlobalErrorViewProps {
  message: string;
  stack?: string;
  onDismiss?: () => void;
}
```

**Styling approach**:
- `fixed inset-0` to cover entire window
- `flex items-center justify-center` for centering
- Dark background matching app theme (`bg-[var(--bg-chat)]`)
- Minimal padding with `p-4` for small windows
- Text wrapping with `break-words` for long messages

### Step 2: Create Error State Context

**File**: `src/contexts/global-error-context.tsx`

A React context to manage global error state across the app:

```tsx
interface GlobalErrorState {
  error: { message: string; stack?: string } | null;
  showError: (message: string, stack?: string) => void;
  clearError: () => void;
}
```

This allows any component to trigger the global error view.

### Step 3: Create Error Boundary Wrapper

**File**: `src/components/global-error-boundary.tsx`

A class-based React Error Boundary that:
- Catches unhandled render errors
- Uses the global error context to display errors
- Can be placed at the app root level

### Step 4: Wrap Spotlight Task Creation Flow

**File**: `src/components/spotlight/spotlight.tsx`

Modify the `activateResult` function (around line 443) to:
1. Wrap the `controller.createTask()` call in try-catch
2. On error, call `showError()` from global error context
3. Format the error with message and stack trace

Current error handling (line 443-450) logs but doesn't display to user:
```tsx
// Current code just logs
logger.warn("Error activating task", error);
```

Change to:
```tsx
// New code displays global error
showError(error.message, error.stack);
```

### Step 5: Integrate Provider at App Root

**File**: `src/App.tsx` or relevant entry point

Wrap the app with `GlobalErrorProvider` so the error context is available everywhere.

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/components/global-error-view.tsx` | **New** - Error display component |
| `src/contexts/global-error-context.tsx` | **New** - Error state context |
| `src/components/global-error-boundary.tsx` | **New** - React error boundary |
| `src/components/spotlight/spotlight.tsx` | **Modify** - Wrap task creation with error handling |
| `src/App.tsx` | **Modify** - Add GlobalErrorProvider |

---

## Component Design

### GlobalErrorView Layout

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│      ⚠️ Error                       │
│                                     │
│      [Error message text here,      │
│       wrapping as needed for        │
│       any window size]              │
│                                     │
│      [Copy Stack Trace]             │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

- Icon optional (can be omitted for simplicity)
- Message text is the primary content
- Single button for copying stack trace
- Optional dismiss button if `onDismiss` provided

### Clipboard Copy Implementation

Use the existing clipboard pattern from the codebase:
```tsx
await navigator.clipboard.writeText(stack);
```

Provide visual feedback (button text change or brief state).

---

## Error Types to Handle

From spotlight types (line 22-27):
```typescript
type TaskCreationError =
  | { type: "no_repositories" }
  | { type: "no_versions"; repoName: string }
  | { type: "no_worktrees_available" }
  | { type: "agent_failed"; message: string };
```

Map these to user-friendly messages:
- `no_repositories` → "No repositories configured. Please add a repository first."
- `no_versions` → "No versions available for repository: {repoName}"
- `no_worktrees_available` → "No worktrees available. Please free up a worktree."
- `agent_failed` → Show the agent error message directly

---

## Testing Considerations

1. Test with very small window sizes
2. Test with very long error messages
3. Test clipboard copy functionality
4. Test error boundary catches render errors
5. Test spotlight task creation failure paths
