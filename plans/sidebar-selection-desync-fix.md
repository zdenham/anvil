# Fix: Sidebar selection desyncs on thread/plan events

## Problem

When a new thread is created (or other thread/plan events fire), the sidebar highlight reverts to the previously selected item instead of staying on the current one.

**Root cause**: `refreshFromDisk()` calls `hydrate()`, which unconditionally overwrites the in-memory `selectedItemId` with whatever is on disk. Event listeners in `listeners.ts` call `refreshFromDisk()` on `THREAD_CREATED`, `THREAD_UPDATED`, `THREAD_STATUS_CHANGED`, and `PLAN_UPDATED`. This races with `navigationService.navigateToThread()` which sets the selection via `setSelectedItem()`.

**Race sequence**:

1. User creates a new thread → navigation begins
2. `THREAD_CREATED` event fires (possibly before navigation completes)
3. Listener calls `refreshFromDisk()` → `hydrate()` reads old `selectedItemId` from disk → overwrites store
4. Navigation's `setSelectedItem()` writes the new ID to disk and store
5. But if another event fires (e.g., `THREAD_STATUS_CHANGED`), step 3 repeats and can revert the selection again

Even without a race, the write-to-disk-then-read-from-disk round-trip for `selectedItemId` is fragile. The disk write in `setSelectedItem` is async and the event listeners don't coordinate with it.

## Fix

`refreshFromDisk()` should **not** overwrite `selectedItemId`. Selection is UI-local state that is authoritative from the in-memory store. The disk-persisted `selectedItemId` is only needed for restoring state on app startup (initial `hydrate()`), not for mid-session refreshes.

## Phases

- [x] Split hydrate into full hydrate (startup) vs partial refresh (events) that preserves selectedItemId

- [x] Add integration test verifying selection survives a refreshFromDisk cycle

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Split hydrate

**Files to change**:

- `src/stores/tree-menu/store.ts` — add a `refreshTree(state)` action that updates everything *except* `selectedItemId`
- `src/stores/tree-menu/service.ts` — add a `refreshFromDisk()` implementation that uses the new partial refresh instead of calling `hydrate()`

**Details**:

In `store.ts`, add a new action:

```ts
refreshTree: (state: Omit<TreeMenuPersistedState, 'selectedItemId'>) => void;
```

This sets `expandedSections`, `pinnedWorktreeId`, `hiddenWorktreeIds`, `hiddenRepoIds` but leaves `selectedItemId` untouched.

In `service.ts`, change `refreshFromDisk()` from:

```ts
async refreshFromDisk(): Promise<void> {
  await this.hydrate();
}
```

To read from disk and call the new partial refresh, preserving the current in-memory selection:

```ts
async refreshFromDisk(): Promise<void> {
  try {
    const raw = await appData.readJson(UI_STATE_PATH);
    if (raw) {
      const result = TreeMenuPersistedStateSchema.safeParse(raw);
      if (result.success) {
        useTreeMenuStore.getState().refreshTree(result.data);
        return;
      }
    }
  } catch (err) {
    logger.error("[treeMenuService] Failed to refresh from disk:", err);
  }
}
```

The initial `hydrate()` call at app startup remains unchanged — it still restores `selectedItemId` from disk as intended.

## Phase 2: Test

Add a test (in `src/stores/__tests__/`) that:

1. Hydrates with `selectedItemId: "thread-A"`
2. Calls `setSelectedItem("thread-B")`
3. Calls `refreshFromDisk()`
4. Asserts `selectedItemId` is still `"thread-B"`