# Fix: Main Worktree lastAccessed Not Updated on Task Creation

## Problem Statement

When creating a task in the main worktree (source repository), the `lastAccessedAt` timestamp is not being updated. This causes the main worktree to not appear first in the task creation tray's MRU (Most Recently Used) list, forcing users to manually switch back to it after each task submission.

## Diagnosis

### Current Architecture

The main worktree is **already tracked** in the `worktrees[]` array with `name: "main"`. When a repository is created, the main worktree is registered:

```typescript
// src/entities/repositories/service.ts:212-217
worktrees: sourcePath ? [{
  path: sourcePath,
  name: 'main',
  lastAccessedAt: now,
  currentBranch: null,
}] : [],
```

The Rust sync operation also ensures the main worktree is named "main":

```rust
// src-tauri/src/worktree_commands.rs:239-244
let final_name = if git_wt.path == source_path {
  "main".to_string()
} else {
  name
};
```

### Root Cause

The issue is that **`createSimpleTask()` doesn't call `worktreeService.touch()`**:

- Location: `src/components/spotlight/spotlight.tsx:371-404`
- When a simple task is created (Enter key), no timestamp update occurs
- Compare with `createTask()` (lines 260-265) which does call `touch()`

Additionally, there may be issues with how `touch()` finds the worktree when the main worktree path is passed.

### Affected Code Paths

| Flow | Timestamp Update | Status |
|------|------------------|--------|
| `createTask()` with explicit worktree | ✅ Calls `touch()` | Working |
| `createTask()` defaulting to main worktree | ⚠️ `touch()` called but may not find it | Needs verification |
| `createSimpleTask()` with any worktree | ❌ No `touch()` call | Broken |

### Key Files

- `src/components/spotlight/spotlight.tsx` - Task creation methods
- `core/services/worktree/worktree-service.ts` - `touch()` method
- `core/types/repositories.ts` - `WorktreeState` schema
- `src/components/spotlight/results-tray.tsx` - Worktree display in tray

## Resolution: Ensure Touch is Called Consistently

Since the main worktree is already tracked in `worktrees[]`, we just need to ensure `touch()` is called in all task creation flows.

### Implementation Steps

#### 1. Verify `touch()` Works for Main Worktree

First, verify that `worktreeService.touch()` correctly finds and updates the main worktree when given its path.

**File:** `core/services/worktree/worktree-service.ts`

Check the `touch()` implementation:
- Does it search by path correctly?
- Does it handle the main worktree path (which matches `sourcePath`)?

If `touch()` searches the `worktrees[]` array by path, it should find the main worktree since it's already in the array.

#### 2. Add `touch()` Call to `createSimpleTask()`

**File:** `src/components/spotlight/spotlight.tsx`

In `createSimpleTask()`, after determining the worktree path, call `touch()`:

```typescript
// After line ~373, add:
const worktreeToTouch = worktreePath ?? repo.sourcePath;
if (worktreeToTouch) {
  await worktreeService.touch(repo.name, worktreeToTouch);
}
```

This ensures that:
- If an explicit worktree is selected, it gets touched
- If no worktree is selected (defaults to main), the main worktree gets touched

#### 3. Verify `createTask()` Handles Main Worktree

**File:** `src/components/spotlight/spotlight.tsx`

Check that `createTask()` also touches the main worktree when no explicit worktree is selected. The existing code may already handle this, but verify the fallback path.

#### 4. Consider Adding `touchByName()` Helper

If `touch()` has issues finding worktrees by path, consider adding a `touchByName()` method:

```typescript
async touchByName(repoName: string, worktreeName: string): Promise<void> {
  const settings = await this.settingsService.load(repoName);
  if (!settings) return;

  const worktree = settings.worktrees.find(w => w.name === worktreeName);
  if (!worktree) return;

  worktree.lastAccessedAt = Date.now();
  await this.settingsService.save(repoName, settings);
}
```

This provides a more reliable way to touch the main worktree:
```typescript
await worktreeService.touchByName(repo.name, 'main');
```

### Files to Modify

1. **`src/components/spotlight/spotlight.tsx`**
   - Add `touch()` call to `createSimpleTask()`
   - Verify `createTask()` touches main worktree correctly

2. **`core/services/worktree/worktree-service.ts`** (if needed)
   - Add `touchByName()` method if path-based lookup is unreliable
   - Or fix `touch()` to handle main worktree path correctly

## Test Cases

- [ ] Create simple task in main worktree → main worktree should be default on next Spotlight open
- [ ] Create simple task in managed worktree → that worktree should be default
- [ ] Create full task in main worktree → main worktree should be default
- [ ] Create full task in managed worktree → that worktree should be default
- [ ] Switch between worktrees multiple times → MRU order should reflect actual usage
- [ ] Verify `touch()` updates `lastAccessedAt` for main worktree (check settings.json)

## Notes

The existing architecture is sound - the main worktree is tracked alongside managed worktrees in the same array. The fix is simply ensuring `touch()` is called consistently in all task creation paths.

### Semantic Redundancy (Future Cleanup)

There's some redundancy in the current model:
- `sourcePath` in `RepositorySettings` points to the main worktree
- The main worktree is also in `worktrees[]` with `name: "main"`

A future refactor could eliminate `sourcePath` and derive it from `worktrees.find(w => w.name === 'main')?.path`. However, this is not needed for the current fix and would be a larger change affecting multiple components.
