# Fix Tree Delete Flicker & "No Repository" Flash

Two distinct visual jank issues that share a root cause pattern: **state transitions leave stale/empty intermediate states visible to the user for 1-3 frames**.

## Phases

- [x] Fix thread deletion flicker (select next sibling before delete)
- [x] Fix "no repository" flash (avoid empty pane intermediate state)
- [ ] Add integration tests for both scenarios

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Issue 1: Tree Item Flicker on Delete

### Evidence

**The archive flow** (`threads/service.ts:719-775`) does optimistic deletion via `_applyDelete()` at line 748, which immediately removes the thread from the store. The `THREAD_ARCHIVED` event fires at line 764, and the content panes listener (`content-panes/listeners.ts:13-24`) sets the pane view to `{ type: "empty" }`.

**The problem**: There is no "select next thread" logic anywhere in the delete path. The sequence is:

1. User clicks archive on the selected thread (`thread-item.tsx:90-98`)
2. `_applyDelete(id)` removes thread from store — tree re-renders, item vanishes (`store.ts:258-266`)
3. `THREAD_ARCHIVED` event fires — content panes listener sets view to `{ type: "empty" }` (`content-panes/listeners.ts:19-21`)
4. Tree selection (`selectedItemId`) still points to the deleted thread ID — orphaned reference
5. Content pane briefly shows `EmptyPaneContent` (the "Welcome to Mort" screen)
6. No auto-navigation to next/previous thread occurs

**The flicker** is the 1-3 frames where:
- The tree item disappears but selection highlight has nowhere to go
- The content pane flashes to empty before the user can process what happened
- If there are sibling threads, the user expects the next one to be auto-selected (standard UX pattern — VS Code, Finder, etc.)

**Key files**:
- `src/entities/threads/service.ts:719-775` — archive() has no selection logic
- `src/entities/threads/store.ts:258-266` — `_applyDelete()` doesn't touch `activeThreadId`
- `src/stores/content-panes/listeners.ts:13-24` — blindly sets to empty on archive
- `src/components/tree-menu/thread-item.tsx:90-98` — `handleArchive` just calls `threadService.archive()`

### Fix

**Before calling `_applyDelete()`**, determine the next sibling thread to select. After deletion, navigate to it.

Modify `threadService.archive()` (or the archive caller) to:

1. Check if the thread being archived is the currently selected item (from `treeMenuStore.selectedItemId`)
2. If yes, find the next sibling thread in the same section (or previous if it's the last)
3. Call `navigationService.navigateToThread(nextThreadId)` before or immediately after the optimistic delete
4. Update `content-panes/listeners.ts` to skip setting `{ type: "empty" }` if the pane has already navigated away

The cleanest approach is to handle this **at the call site** in `thread-item.tsx:handleArchive`:

```typescript
const handleArchive = useCallback(async () => {
  setIsArchiving(true);
  try {
    // Find next sibling to select before deleting
    if (isSelected) {
      const nextItem = findNextSibling(item, allItems);
      if (nextItem) {
        await navigationService.navigateToThread(nextItem.id);
      }
    }
    await threadService.archive(item.id);
  } finally {
    setIsArchiving(false);
    setConfirming(false);
  }
}, [item.id, isSelected, allItems]);
```

The `allItems` and `itemIndex` props already exist on `ThreadItem` (used by keyboard nav at line 149-191). The sibling lookup logic already exists in the keyboard nav handler — extract it into a shared utility.

---

## Issue 2: "No Repository" Flash

### Evidence

**The content pane** (`content-pane.tsx:154-193`) renders based on two conditions:
- `view.type === "thread"` — set immediately by navigation
- `activeMetadata?.worktreeId` — derived from `useThreadStore(s => s.threads[threadId])` at line 74-76

**The race**: When navigating to a thread:

1. `navigationService.navigateToThread()` calls `contentPanesService.setActivePaneView({ type: "thread", threadId })` — view updates immediately (`navigation-service.ts:23`)
2. Content pane renders with new `view.threadId`
3. `activeMetadata` selector runs: `s.threads[threadId]` — this may be `undefined` if the thread hasn't been loaded into the store yet
4. When `activeMetadata` is undefined, `!activeMetadata?.worktreeId` is true → the branch at line 175 renders `ThreadContent` **without** `DiffCommentProvider`
5. `ThreadContent` mounts and calls `initThread()` in a `useEffect` (`thread-content.tsx:146-167`)
6. `initThread()` does `await threadService.refreshById(threadId)` if not in store, then `threadService.setActiveThread(threadId)` — async, fire-and-forget
7. Meanwhile, if the content pane listener from a **previous** thread's archive event fires `setPaneView(paneId, { type: "empty" })` slightly late, it briefly shows `EmptyPaneContent`

**The "no repository" text** comes from `empty-pane-content.tsx:64-82`:
```typescript
const noRepoConfigured = !mruWorktree;
// ...
{noRepoConfigured ? (
  <p>Add a repository to get started</p>
) : (
  <p>Type a message below to get started</p>
)}
```

This flashes when:
- The content pane view is briefly set to `{ type: "empty" }` during the archive → navigate transition
- `useMRUWorktree` starts with `isLoading: true` and `mruWorktree = null` (`use-mru-worktree.ts:55`), then loads async in a `useEffect` at line 115-117
- On app startup, the persisted pane state restores the view before the thread store is hydrated, causing a momentary `activeMetadata === undefined`

**The core issue**: the content panes archive listener (`content-panes/listeners.ts:19-21`) **unconditionally** sets the pane to `{ type: "empty" }` on `THREAD_ARCHIVED`, even if the pane has already navigated to a different thread. Combined with the fact that `_applyDelete` fires before `THREAD_ARCHIVED` (they're in the same `for` loop at `service.ts:737-766`), there's a window where:

1. Archive starts → `_applyDelete` → store updates → tree re-renders
2. Navigation to next thread fires (if we fix issue 1) → pane view set to new thread
3. `THREAD_ARCHIVED` event fires → listener sees old threadId, but pane has already moved on — **except the listener checks `pane.view.threadId === threadId`**, so this is actually safe IF navigation happened first

The real problem is the **startup race**: persisted pane state says `{ type: "thread", threadId: "abc" }` but the thread store hasn't hydrated yet, so `activeMetadata` is undefined.

### Fix

Two changes needed:

**A. Fix the archive listener race** — In `content-panes/listeners.ts`, before setting to empty, check if navigation has already moved the pane away. This is already partially handled (the listener checks `pane.view.threadId === threadId`), but the timing between `_applyDelete` and `THREAD_ARCHIVED` means the pane view may not have updated yet if navigation is async. **Solution**: Move the "select next sibling" logic to fire BEFORE `_applyDelete`, so by the time `THREAD_ARCHIVED` fires, the pane is already showing a different thread.

**B. Fix the startup race** — In `content-pane.tsx`, don't render `ThreadContent` until `activeMetadata` exists in the store. Add a loading/skeleton state:

```typescript
{view.type === "thread" && !activeMetadata && (
  <div className="flex-1" /> // or a skeleton/spinner
)}
{view.type === "thread" && activeMetadata?.worktreeId && (
  <DiffCommentProvider ...>
    <ThreadContent ... />
  </DiffCommentProvider>
)}
{view.type === "thread" && activeMetadata && !activeMetadata.worktreeId && (
  <ThreadContent ... />
)}
```

This prevents the "no repository" flash because `EmptyPaneContent` only renders when `view.type === "empty"`, and we never briefly flash to empty during thread transitions.

**C. Fix `EmptyPaneContent` loading state** — Show a loading indicator while `useMRUWorktree` is loading instead of assuming "no repo configured":

```typescript
const noRepoConfigured = !isLoading && !mruWorktree;
```

This prevents the "Add a repository" message from flashing during the initial async load.

---

## Key Files to Modify

| File | Change |
|------|--------|
| `src/components/tree-menu/thread-item.tsx` | Navigate to next sibling before archive |
| `src/entities/threads/service.ts` | (Optional) Add `archiveWithNavigation()` helper |
| `src/stores/content-panes/listeners.ts` | Guard against already-navigated pane |
| `src/components/content-pane/content-pane.tsx` | Add `!activeMetadata` guard for thread views |
| `src/components/content-pane/empty-pane-content.tsx` | Use `isLoading` from `useMRUWorktree` |
| `src/index.css` | (Optional) Consider removing 150ms tree animation or making it shorter |
