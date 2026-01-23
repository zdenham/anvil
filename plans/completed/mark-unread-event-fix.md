# Mark Unread Event Broadcasting Fix

## Problem

When marking a thread as "unread" via the control panel quick action, the main panel's blue dot does not update in real-time. However, "mark read" works correctly.

## Diagnosis

### Root Cause

The control panel's `handleSuggestedAction` function in `src/components/control-panel/control-panel-window.tsx:400-401` directly calls `threadService.update()` instead of using the store method:

```typescript
// Current (broken):
} else if (action === "markUnread") {
  await threadService.update(threadId, { isRead: false });
}
```

The `threadService.update()` method only:
1. Updates the disk
2. Applies an optimistic state change via `_applyUpdate`

It does **NOT** emit the `EventName.THREAD_UPDATED` event needed for cross-window broadcasting.

### Why Mark Read Works

The `useMarkThreadAsRead` hook correctly calls the store method:
```typescript
useThreadStore.getState().markThreadAsRead(threadId);
```

The store's `markThreadAsRead` method emits `EventName.THREAD_UPDATED`, which:
1. Gets picked up by `setupOutgoingBridge()` in `event-bridge.ts`
2. Broadcasts to all windows via Tauri IPC as `app:thread:updated`
3. Other windows receive it via `setupIncomingBridge()`
4. Thread listeners call `threadService.refreshById()` to update the UI

### Event Flow Comparison

| Action | Method Called | Emits Event? | Broadcasts Cross-Window? |
|--------|--------------|-------------|--------------------------|
| Mark Read | `store.markThreadAsRead()` | Yes | Yes |
| Mark Unread (current) | `threadService.update()` | No | No |
| Mark Unread (store method) | `store.markThreadAsUnread()` | Yes | Yes |

## Proposed Fix

Update `src/components/control-panel/control-panel-window.tsx` to use the store method instead of the service method:

```typescript
// Before (line 400-401):
} else if (action === "markUnread") {
  await threadService.update(threadId, { isRead: false });
}

// After:
} else if (action === "markUnread") {
  await useThreadStore.getState().markThreadAsUnread(threadId);
}
```

This is a one-line change. The import for `useThreadStore` should already exist in the file since it's commonly used in components.

## Files to Modify

1. `src/components/control-panel/control-panel-window.tsx` - Change line 401

## Testing

1. Open a thread in the control panel
2. Use the "Mark Unread" quick action
3. Verify the main panel's status dot turns blue immediately (without needing to refresh)
4. Verify the control panel hides after the action
