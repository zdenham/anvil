# Fix: Plans and Threads Not Marked as Read in Main Window

## Status: IMPLEMENTED

## Solution Summary

Instead of checking panel visibility via polling, we now use **state-based tracking**:

1. When a panel is shown, `setActiveThread(threadId)` is called
2. When a panel is hidden/blurred, `setActiveThread(null)` is called via `panel-hidden` event listener
3. `useMarkThreadAsRead` simply checks if the thread is the active thread (`activeThreadId === threadId`)

This eliminates the need for:
- 100ms polling in `usePanelVisibility` hooks (deleted)
- `requiredPanel` option in `useMarkThreadAsRead`
- Complex visibility checking logic

## Implementation Details

### 1. Added `panel-hidden` Event Listener

**File:** `src/entities/threads/listeners.ts`

```typescript
// Panel hidden - clear active thread to prevent marking threads as read when panel is not visible
eventBus.on("panel-hidden", () => {
  const store = useThreadStore.getState();
  if (store.activeThreadId) {
    logger.info(`[ThreadListener] Panel hidden, clearing active thread: ${store.activeThreadId}`);
    store.setActiveThread(null);
  }
});
```

### 2. Simplified `useMarkThreadAsRead` Hook

**File:** `src/hooks/use-mark-thread-as-read.ts`

- Removed `usePanelVisibility` and `useSpecificPanelVisibility` imports
- Removed `requiredPanel` option
- Now checks `isActiveThread = useThreadStore((s) => s.activeThreadId === threadId)`
- All visibility checks replaced with `isActiveThread` check

### 3. Deleted `usePanelVisibility` Hook

**File:** `src/hooks/use-panel-visibility.ts` (DELETED)

The polling-based visibility hooks are no longer needed.

### 4. Updated Hook Usages

**Files updated:**
- `src/components/control-panel/control-panel-window.tsx` - Removed `requiredPanel` option
- `src/components/content-pane/thread-content.tsx` - Already had no `requiredPanel`, works as-is

## How It Works

1. **Panel Shown:** Rust emits `open-control-panel` event → `ControlPanelWindow` mounts → `threadService.setActiveThread(threadId)` is called

2. **Panel Hidden:** Rust emits `panel-hidden` event when NSPanel resigns key (blur) or is explicitly hidden → Thread listener clears `activeThreadId`

3. **Mark as Read:** `useMarkThreadAsRead` checks if `activeThreadId === threadId` before marking. If the panel is hidden, `activeThreadId` is null, so threads won't be marked as read.

## Benefits

- **No more polling:** Eliminated 100ms interval checking panel visibility
- **Simpler logic:** State-based approach is easier to reason about
- **Single source of truth:** `activeThreadId` represents "which thread is currently visible"
- **Works for main window:** Content panes set their own active thread when opened
