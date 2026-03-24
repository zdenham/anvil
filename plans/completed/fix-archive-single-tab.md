# Fix: Archiving Thread from Sidebar Opens Next Thread Instead of Empty State

## Problem

When a user archives a thread from the sidebar and it's the only tab open, the next thread from the sidebar list gets opened and persists. Expected behavior: the tab should transition to the empty pane ("Welcome to Anvil").

## Diagnosis

The bug is in `src/components/tree-menu/thread-item.tsx` lines 91-104. The `handleArchive` callback navigates to the next sidebar sibling **before** archiving:

```ts
// Navigate to next sibling before deleting to prevent flicker
if (isSelected && allItems.length > 1) {
  const nextItem = allItems[itemIndex + 1] ?? allItems[itemIndex - 1];
  if (nextItem) {
    await navigationService.navigateToThread(nextItem.id);
  }
}
await threadService.archive(item.id);
```

The flow:

1. User clicks archive on the only open thread in the sidebar
2. `handleArchive` checks `isSelected && allItems.length > 1` — true if other threads exist in the list
3. It navigates the current tab to the **next thread** (line 101)
4. Then it archives the original thread (line 105)
5. `THREAD_ARCHIVED` listener calls `closeMatchingTabs()` looking for tabs with the archived thread's ID
6. But the tab was already swapped to show the next thread — **no tabs match**, nothing gets closed
7. The next thread's content persists in the tab

The pre-navigation was added to "prevent flicker" but it defeats the close-matching-tabs mechanism entirely. The `_removeEmptyGroup` / `createDefaultState` path from `paneLayoutService` is never reached because the tab is never actually closed.

## Proposed Fix

Remove the pre-navigation from `handleArchive`. Let the archive happen first, then let the existing `THREAD_ARCHIVED` listener close the tab properly. The `closeTab` path in `paneLayoutService` already handles the last-tab case (or will, with the `closeTab` guard below).

### Change 1: `src/components/tree-menu/thread-item.tsx`

Remove the pre-navigation block from `handleArchive`:

```ts
const handleArchive = useCallback(async () => {
  setIsArchiving(true);
  try {
    await threadService.archive(item.id);
  } finally {
    setIsArchiving(false);
    setConfirming(false);
  }
}, [item.id]);
```

After the archive, the `THREAD_ARCHIVED` listener closes matching tabs. If it was the only tab, `closeTab` transitions it to empty view. If there were other tabs, the next tab becomes active normally.

### Change 2: `src/stores/pane-layout/service.ts`

Guard `closeTab` so the last tab in the last group transitions to empty view instead of being removed (prevents the UUID churn / full layout reset in `_removeEmptyGroup`):

```ts
async closeTab(groupId: string, tabId: string): Promise<void> {
  const store = usePaneLayoutStore.getState();
  const group = store.groups[groupId];
  if (!group) return;

  const groupCount = Object.keys(store.groups).length;
  const isLastTabInLastGroup = group.tabs.length === 1 && groupCount <= 1;

  if (isLastTabInLastGroup) {
    // Last tab in last group: switch to empty view instead of removing
    store._applySetTabView(groupId, tabId, { type: "empty" });
    await persistState();
    return;
  }

  store._applyCloseTab(groupId, tabId);
  const updatedGroup = usePaneLayoutStore.getState().groups[groupId];

  if (!updatedGroup || updatedGroup.tabs.length === 0) {
    await this._removeEmptyGroup(groupId);
  }
  await persistState();
},
```

## Files to Change

1. `src/components/tree-menu/thread-item.tsx` — remove pre-navigation from `handleArchive` (lines 91-110)
2. `src/stores/pane-layout/service.ts` — `closeTab()` last-tab guard (lines 82-95)

## Phases

- [x] Remove pre-navigation from handleArchive in thread-item.tsx
- [x] Implement the closeTab guard for last-tab-in-last-group in pane-layout service
- [x] Add safety comment to _removeEmptyGroup last-group branch (now a fallback only)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
