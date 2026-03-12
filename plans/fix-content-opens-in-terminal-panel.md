# Fix: Content opens in terminal panel after closing all content tabs

## Problem

After closing all content threads (so no content groups remain), the next thread/plan/file opened appears in the terminal pane instead of the content zone.

## Root Cause

`closeTab` and `_removeEmptyGroup` in `service.ts` count **all** groups including the terminal panel group when deciding whether this is the "last group." When the terminal panel group exists, the count is 2 even though there's only 1 content group, so the safeguards don't fire.

### Exact trace

1. State: 1 content group (1 thread tab) + 1 terminal panel group
2. User closes the thread tab → `closeTab(contentGroupId, tabId)`
3. `groupCount = Object.keys(store.groups).length` → **2** (includes terminal group)
4. `isLastTabInLastGroup = (1 === 1 && 2 <= 1)` → **false** — doesn't trigger the "replace with empty view" safeguard
5. Tab is removed, group is empty → `_removeEmptyGroup(contentGroupId)` called
6. Inside `_removeEmptyGroup`: `groupCount` is still 2 → doesn't trigger `createDefaultState()` reset
7. Content group is removed from `groups` map
8. `activeGroupId` was the content group → falls to `remaining[0]` which is the **terminal panel group**
9. Next `navigateToThread` → `findOrOpenTab` → `openTab` / `setActiveTabView` uses `activeGroupId` → **terminal panel group receives the content view**

## Fix

Two complementary changes in `service.ts`:

### 1. Exclude terminal panel group from "content group count" checks

Both `closeTab` and `_removeEmptyGroup` need a content-group-only count:

`closeTab` (line 97-98): Change the group count to exclude the terminal panel group:

```typescript
const terminalGroupId = store.terminalPanel?.groupId;
const contentGroupCount = Object.keys(store.groups)
  .filter((id) => id !== terminalGroupId).length;
const isLastTabInLastGroup = group.tabs.length === 1 && contentGroupCount <= 1;
```

`_removeEmptyGroup` (line 127-133): Same fix — use content-only count. Also, when resetting to defaults, preserve the terminal panel state:

```typescript
const terminalGroupId = store.terminalPanel?.groupId;
const contentGroupCount = Object.keys(store.groups)
  .filter((id) => id !== terminalGroupId).length;

if (contentGroupCount <= 1) {
  const defaults = createDefaultState();
  store.hydrate({ ...defaults, terminalPanel: store.terminalPanel });
  return;
}
```

`_removeEmptyGroup` fallback active group (line 142-147): When picking a remaining group after removal, skip the terminal panel group:

```typescript
if (store.activeGroupId === groupId) {
  const remaining = Object.keys(usePaneLayoutStore.getState().groups)
    .filter((id) => id !== store.terminalPanel?.groupId);
  if (remaining.length > 0) {
    usePaneLayoutStore.getState()._applySetActiveGroup(remaining[0]);
  }
}
```

### 2. Safety net in `findOrOpenTab` / `openTab`

If `activeGroupId` somehow points to the terminal panel group when opening non-terminal content, create a new content group instead of corrupting the terminal panel. This is a defense-in-depth guard.

In `openTab`: before using `targetGroupId`, check if it's the terminal panel group and the view is not a terminal. If so, create a fresh content group and add it to the split tree.

In `findOrOpenTab`: at the fallback `setActiveTabView` path, same check — if active group is the terminal panel group, create a new content group rather than replacing the terminal tab view.

## Phases

- [x] Fix group counting in `closeTab` and `_removeEmptyGroup` to exclude terminal panel group; preserve terminal panel state on defaults reset

- [x] Add safety net in `openTab` and `findOrOpenTab` to never route content to the terminal panel group

- [x] Verify the `_removeEmptyGroup` active group fallback skips the terminal panel group

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Change

| File | Change |
| --- | --- |
| `src/stores/pane-layout/service.ts` | Fix `closeTab` group count, fix `_removeEmptyGroup` group count + active group fallback, add guard in `openTab` and `findOrOpenTab` |
