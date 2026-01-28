# Context Menu Archive Double-Click Bug

## Problem

When double-clicking the "Archive worktree" option in the context menu, the archive operation appears to execute before or without the confirmation modal being acknowledged by the user.

## Root Cause Analysis

The issue stems from how double-click events interact with React's state batching and the async nature of the handlers.

### Current Flow

1. **Context Menu Button** (`src/components/tree-menu/repo-worktree-section.tsx:469-481`)
   ```tsx
   <button
     type="button"
     onClick={(e) => {
       e.stopPropagation();
       handleContextArchiveWorktree();
     }}
   >
     Archive worktree
   </button>
   ```

2. **Handler** (`repo-worktree-section.tsx:177-180`)
   ```tsx
   const handleContextArchiveWorktree = () => {
     setShowContextMenu(false);  // Queues state update (doesn't immediately re-render)
     onArchiveWorktree?.(section.repoName, section.worktreeId, section.worktreeName);
   };
   ```

3. **Archive Handler** (`src/components/main-window/main-window-layout.tsx:319-357`)
   ```tsx
   const handleArchiveWorktree = useCallback(async (...) => {
     // ... get thread count ...

     if (!window.confirm(message)) {  // Blocking native dialog
       return;
     }

     // Archive operation executes here
   }, []);
   ```

### The Bug

A double-click fires two `onClick` events in rapid succession. The key issue is timing:

1. **First click:**
   - `handleContextArchiveWorktree()` is called
   - `setShowContextMenu(false)` queues a state update (React batches this)
   - `onArchiveWorktree()` is invoked

2. **Second click (fires before React re-renders):**
   - The context menu button still exists in the DOM (React hasn't re-rendered yet)
   - `handleContextArchiveWorktree()` is called AGAIN
   - `onArchiveWorktree()` is invoked a SECOND time

Now we have **two concurrent calls** to `handleArchiveWorktree`. In Tauri's WebView environment:
- Both calls may race to show `window.confirm()`
- The dialogs may interact unexpectedly (one auto-dismissing, or stacking)
- If the second call's confirm somehow resolves first or auto-confirms, the archive executes

This explains why the archive appears to happen "before" the confirmation - it's actually the second invocation racing ahead or the confirm dialogs conflicting.

## Proposed Solutions

### Solution 1: Guard Against Multiple Invocations (Recommended)

Use a ref to track whether the handler has already been invoked, preventing the second click from triggering another call:

```tsx
const archiveInProgressRef = useRef(false);

const handleContextArchiveWorktree = () => {
  if (archiveInProgressRef.current) return;  // Prevent double execution
  archiveInProgressRef.current = true;

  setShowContextMenu(false);
  onArchiveWorktree?.(section.repoName, section.worktreeId, section.worktreeName);

  // Reset after a delay (in case user cancels and wants to try again)
  setTimeout(() => {
    archiveInProgressRef.current = false;
  }, 1000);
};
```

This is the simplest and most direct fix - it ensures only one call to `onArchiveWorktree` can be in flight at a time.

### Solution 2: Flush State Update Before Calling Handler

Force React to synchronously update state before invoking the handler, ensuring the button is removed from DOM before the second click can fire:

```tsx
import { flushSync } from 'react-dom';

const handleContextArchiveWorktree = () => {
  flushSync(() => {
    setShowContextMenu(false);
  });
  // Menu is now definitely unmounted - second click has nowhere to land
  onArchiveWorktree?.(section.repoName, section.worktreeId, section.worktreeName);
};
```

### Solution 3: Use requestAnimationFrame

Defer the handler call to the next frame, allowing React to process the state update first:

```tsx
const handleContextArchiveWorktree = () => {
  setShowContextMenu(false);
  requestAnimationFrame(() => {
    onArchiveWorktree?.(section.repoName, section.worktreeId, section.worktreeName);
  });
};
```

### Solution 4: Replace `window.confirm()` with Custom Modal (Future)

For better UX and more control, replace the native browser confirm dialog with a custom React modal. This would also solve the race condition since React state would gate the confirmation flow:

```tsx
// In main-window-layout.tsx
const [archiveConfirmation, setArchiveConfirmation] = useState<{
  repoName: string;
  worktreeId: string;
  worktreeName: string;
  threadCount: number;
} | null>(null);

const handleArchiveWorktree = useCallback((repoName, worktreeId, worktreeName) => {
  if (archiveConfirmation) return;  // Already showing confirmation
  const threads = threadService.getByWorktree(worktreeId);
  setArchiveConfirmation({ repoName, worktreeId, worktreeName, threadCount: threads.length });
}, [archiveConfirmation]);
```

## Recommended Implementation

**Solution 1 (ref guard)** is the recommended fix because:
- Minimal code change (add ~5 lines)
- Directly addresses the root cause (multiple invocations)
- No risk of breaking existing behavior
- Works regardless of React's batching behavior

Solution 2 (`flushSync`) is also valid but `flushSync` should be used sparingly as it can cause performance issues if overused.

Solution 4 (custom modal) is a good future enhancement for UX consistency but is more work than needed for this bug fix.

## Files to Modify

1. **`src/components/tree-menu/repo-worktree-section.tsx`**
   - Add ref-based click guard to `handleContextArchiveWorktree`
   - Location: lines 177-180 (handler definition)

## Testing

1. Right-click a worktree to open context menu
2. Double-click "Archive worktree" rapidly
3. Verify confirmation dialog appears and waits for user input
4. Verify only one archive operation occurs regardless of click speed
5. Test that canceling works correctly
6. Test that confirming still archives properly
