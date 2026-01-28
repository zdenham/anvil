# Worktree Rename UI Sync Fix

## Problem Statement

When a worktree is renamed (either by the agent auto-naming or user-initiated), the main window sidebar does not immediately reflect the new name. The worktree is renamed on disk correctly, but the UI shows the stale name until a manual refresh occurs.

## Diagnosis

### Current Architecture

The worktree renaming flow has two paths:

**1. Agent-Initiated Rename (Auto-naming)**
- Agent generates name via Claude Haiku
- Agent writes to `settings.json` on disk
- Agent emits `WORKTREE_NAME_GENERATED` event via stdout
- `agent-service.ts` parses event and broadcasts via Tauri
- Main window receives event via `event-bridge.ts`
- Worktree listener (`src/entities/worktrees/listeners.ts`) receives the event

**2. User-Initiated Rename (Context Menu)**
- User right-clicks worktree → "Rename worktree"
- Calls `worktreeService.rename()` directly
- Rust backend updates disk
- Calls `onRefresh?.()` to hydrate lookup store (local only)

### The Gap

**In `src/entities/worktrees/listeners.ts` (lines 17-31):**

```typescript
eventBus.on(EventName.WORKTREE_NAME_GENERATED, async ({ worktreeId, repoId, name }) => {
  await worktreeService.rename(repoId, worktreeId, name);
  // <-- MISSING: No UI refresh triggered here!
});
```

The listener calls `worktreeService.rename()` which updates the Rust backend and disk, but **does not call `useRepoWorktreeLookupStore.getState().hydrate()`** to refresh the UI.

### Why the UI Doesn't Update

The tree menu displays worktree names from `useRepoWorktreeLookupStore`:
- `src/stores/repo-worktree-lookup-store.ts` holds a cached map of repo/worktree names
- `src/hooks/use-tree-data.ts` uses `getWorktreeName()` from this store
- The store reads from disk during `hydrate()`, then serves cached data

After the agent renames the worktree:
1. Disk is updated (agent writes to `settings.json`)
2. Event is broadcast and received
3. `worktreeService.rename()` is called (updates Rust backend - may be idempotent if already written)
4. **BUT:** `useRepoWorktreeLookupStore` still has the old cached name
5. Tree menu continues showing the old name

### Thread Creation from Main Window

When a thread is created from the main window:
1. User clicks "+" → `handleNewThread()` → `threadService.create()`
2. Thread appears in sidebar immediately (optimistic update)
3. User types prompt → `spawnSimpleAgent()` launches agent
4. Agent runs `initiateWorktreeNaming()` (fire-and-forget, parallel)
5. Agent generates name and emits `WORKTREE_NAME_GENERATED`
6. Main window receives event → calls `worktreeService.rename()`
7. **Gap**: No hydrate called → sidebar shows old worktree name

This is the exact scenario where the user expects to see the worktree name update in the sidebar after creating a thread.

## Proposed Fix

### Option A: Hydrate in the Worktree Listener (Recommended)

Modify `src/entities/worktrees/listeners.ts` to hydrate the lookup store after rename:

```typescript
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

eventBus.on(EventName.WORKTREE_NAME_GENERATED, async ({ worktreeId, repoId, name }) => {
  logger.info(`[WorktreeListener] Received worktree:name:generated...`);
  try {
    await worktreeService.rename(repoId, worktreeId, name);

    // Refresh the UI by re-hydrating the lookup store
    await useRepoWorktreeLookupStore.getState().hydrate();

    logger.info(`[WorktreeListener] Rename complete and UI refreshed...`);
  } catch (error) {
    logger.error(`[WorktreeListener] Failed to rename...`, error);
  }
});
```

**Pros:**
- Single point of fix
- All windows will automatically refresh when they receive the broadcast event
- Consistent behavior for both agent-initiated and cross-window scenarios

**Cons:**
- Full hydrate reads all repo settings from disk (minor performance hit)

### Option B: Targeted Store Update

Instead of full hydrate, add a method to update a single worktree name in the store:

```typescript
// In repo-worktree-lookup-store.ts
updateWorktreeName: (repoId: string, worktreeId: string, name: string) => {
  const repos = get().repos;
  const repo = repos.get(repoId);
  if (repo) {
    const worktree = repo.worktrees.get(worktreeId);
    if (worktree) {
      worktree.name = name;
      set({ repos: new Map(repos) }); // Trigger re-render
    }
  }
}
```

Then call this in the listener instead of full hydrate.

**Pros:**
- More efficient (no disk read)
- Immediate update

**Cons:**
- Requires adding new store method
- Could get out of sync with disk if rename partially fails

### Recommendation

**Use Option A** (hydrate in listener) because:
1. It's a minimal code change (2-3 lines)
2. It ensures UI is always in sync with disk state
3. The performance cost is negligible (reading a few JSON files)
4. It handles edge cases automatically (e.g., if agent's disk write failed but Rust's succeeded)

## Implementation Steps

1. **Edit `src/entities/worktrees/listeners.ts`**:
   - Import `useRepoWorktreeLookupStore`
   - Add `await useRepoWorktreeLookupStore.getState().hydrate()` after `worktreeService.rename()`

2. **Test the fix**:
   - Create a new thread from the main window
   - Submit a prompt with more than 20 characters
   - Watch the sidebar - worktree name should update within 1-2 seconds
   - Also test cross-window: rename in one window, verify other window updates

## Files to Modify

- `src/entities/worktrees/listeners.ts` - Add hydrate call after rename
