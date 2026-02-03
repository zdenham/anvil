# Command+N: Create Thread in Selected/Recent Context

## Problem

Currently, when pressing Command+N to create a new thread:
- The new thread is created in the **most recently used worktree** (based on earliest item creation timestamp)
- This ignores the **currently selected thread** in the sidebar

**Expected Behavior:** If a thread is selected in the sidebar, Command+N should create the new thread in the same worktree as the selected thread.

**Fallback:** If nothing is selected (or a non-thread item is selected), fall back to the most recently used worktree.

## Note on Current "Most Recent Worktree" Logic

The current fallback logic in `use-tree-data.ts` sorts by `earliestCreated` (descending), meaning it prioritizes worktrees where you **first started working most recently** - not where you have the **most recent activity**. This may be a separate issue to address, but is outside the scope of this plan which focuses on respecting the selected thread context.

## Current Implementation

**File:** `src/components/main-window/main-window-layout.tsx` (lines 86-121)

```typescript
// Current: Always uses sections[0] (most recently used worktree)
const mostRecent = sections[0];
const thread = await threadService.create({
  repoId: mostRecent.repoId,
  worktreeId: mostRecent.worktreeId,
  prompt: "",
});
```

## Proposed Solution

### Step 1: Get the currently selected item from tree menu store

The `useTreeMenuStore` already tracks `selectedItemId`. We can access this via:
```typescript
const selectedItemId = useTreeMenuStore.getState().selectedItemId;
```

### Step 2: If a thread is selected, look up its worktree info

Use `threadService.get(selectedItemId)` to get the thread metadata which contains `repoId` and `worktreeId`.

### Step 3: Modify the Command+N handler

**Updated logic in `main-window-layout.tsx`:**

```typescript
useEffect(() => {
  const handleKeyDown = async (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();

      let repoId: string;
      let worktreeId: string;
      let worktreeName: string;

      // 1. Check if a thread is currently selected
      const selectedItemId = useTreeMenuStore.getState().selectedItemId;
      if (selectedItemId) {
        const selectedThread = threadService.get(selectedItemId);
        if (selectedThread) {
          // Use the selected thread's worktree
          repoId = selectedThread.repoId;
          worktreeId = selectedThread.worktreeId;
          // Find worktree name from sections for logging
          const section = treeSectionsRef.current.find(
            s => s.repoId === repoId && s.worktreeId === worktreeId
          );
          worktreeName = section?.worktreeName ?? "unknown";
          logger.info(`[MainWindowLayout] Command+N: Creating new thread in selected thread's worktree "${worktreeName}"`);
        }
      }

      // 2. Fallback to most recently used worktree
      if (!repoId || !worktreeId) {
        const sections = treeSectionsRef.current;
        if (sections.length === 0) {
          logger.warn("[MainWindowLayout] Command+N: No worktrees available");
          return;
        }
        const mostRecent = sections[0];
        repoId = mostRecent.repoId;
        worktreeId = mostRecent.worktreeId;
        worktreeName = mostRecent.worktreeName;
        logger.info(`[MainWindowLayout] Command+N: Creating new thread in most recent worktree "${worktreeName}"`);
      }

      try {
        const thread = await threadService.create({
          repoId,
          worktreeId,
          prompt: "",
        });

        await treeMenuService.hydrate();
        await navigationService.navigateToThread(thread.id, { autoFocus: true });

        logger.info(`[MainWindowLayout] Command+N: Created new thread ${thread.id}`);
      } catch (err) {
        logger.error(`[MainWindowLayout] Command+N: Failed to create thread:`, err);
      }
    }
  };

  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, []);
```

### Step 4: Handle Plan Selection (Optional Enhancement)

If a **plan** is selected instead of a thread, we could:
1. Look up the plan's `repoId` and `worktreeId` similarly
2. Create the new thread in that worktree

This would require checking if `selectedItemId` is a plan (using `planService.get()`) when it's not found as a thread.

## Files to Modify

1. **`src/components/main-window/main-window-layout.tsx`**
   - Import `useTreeMenuStore` from `@/stores/tree-menu/store`
   - Modify the Command+N handler to check selected item first

## Testing

1. Select a thread in worktree A, press Command+N → new thread should appear in worktree A
2. Select a thread in worktree B, press Command+N → new thread should appear in worktree B
3. Select nothing (or settings/logs view), press Command+N → new thread in most recently used worktree
4. If implementing plan support: Select a plan, press Command+N → new thread in that plan's worktree

## Edge Cases

- **Selected item no longer exists:** Fall back to most recently used worktree
- **Selected item is not a thread/plan:** Fall back to most recently used worktree
- **No worktrees available:** Show warning (existing behavior)
