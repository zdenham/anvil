# Worktrees Showing Deleted Entries

## Problem

The worktrees list is displaying worktrees that no longer exist on disk. This happens because there are two different operations for loading worktrees:

1. **`worktree_list`** - Reads from `settings.json` only, does NOT verify worktrees exist on disk
2. **`worktree_sync`** - Reads from git, compares with settings, and removes orphaned entries

## Root Cause

The issue is that `worktree_list` (used by the Spotlight component on mount) returns whatever is stored in `settings.json` without validating that those paths still exist on disk.

In `src-tauri/src/worktree_commands.rs:18-30`:
```rust
pub async fn worktree_list(repo_name: String) -> Result<Vec<WorktreeState>, String> {
    let settings = load_settings(&repo_name)?;
    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    worktrees.sort_by(|a, b| { ... });
    Ok(worktrees)
}
```

This simply deserializes the worktrees array from settings and returns it. There is no validation that the paths actually exist.

### How Worktrees Can Get Out of Sync

Worktrees can be deleted externally (outside of the app) via:
- `git worktree remove <path>` from command line
- `rm -rf` of the worktree directory
- Other tools or scripts

When this happens, the settings.json still contains the entry, but the worktree no longer exists on disk.

### When the Problem Manifests

- **WorktreesPage** - Calls `sync()` on mount, so it self-heals and shows correct data
- **Spotlight** - Calls `list()` on mount (not sync), so it can show stale entries

From `src/components/spotlight/spotlight.tsx:879-881`:
```typescript
useEffect(() => {
  loadWorktrees(false);  // false = don't sync, just list
}, [loadWorktrees]);
```

## Proposed Fix

**Eliminate `worktree_list` and always use `worktree_sync`**

The `git worktree list --porcelain` command is a cheap local operation - it just reads git's internal worktree registry from `.git/worktrees/`. There's no network I/O and it's very fast. Having a separate `list` operation that can return stale data creates unnecessary complexity and bugs.

### Changes Required

#### 1. Remove `worktree_list` from Rust backend

Delete the `worktree_list` function from `src-tauri/src/worktree_commands.rs` and remove it from `lib.rs` command registration.

#### 2. Remove `list` from frontend service

In `src/entities/worktrees/service.ts`, remove the `list()` method entirely.

#### 3. Update Spotlight to use sync

In `src/components/spotlight/spotlight.tsx`, simplify the `loadWorktrees` function:

**Before:**
```typescript
const loadWorktrees = useCallback(async (syncFirst = false) => {
  const worktrees = syncFirst
    ? await worktreeService.sync(repo.name)
    : await worktreeService.list(repo.name);
  // ...
}, []);

useEffect(() => {
  loadWorktrees(false);  // Don't sync on mount
}, [loadWorktrees]);
```

**After:**
```typescript
const loadWorktrees = useCallback(async () => {
  const worktrees = await worktreeService.sync(repo.name);
  // ...
}, []);

useEffect(() => {
  loadWorktrees();
}, [loadWorktrees]);
```

#### 4. Audit other usages

Search for any other places that call `worktreeService.list()` and update them to use `sync()`.

## Why This Approach

- **Single source of truth**: Git is always authoritative for what worktrees exist
- **Self-healing**: Every load automatically cleans up stale entries in settings.json
- **Simpler API**: One method instead of two with subtle differences
- **No performance concern**: `git worktree list --porcelain` is ~1-2ms on typical repos
- **Eliminates the bug class entirely**: Impossible to show stale worktrees

## Files to Modify

1. `src-tauri/src/worktree_commands.rs` - Remove `worktree_list` function
2. `src-tauri/src/lib.rs` - Remove `worktree_list` from command registration
3. `src/entities/worktrees/service.ts` - Remove `list()` method
4. `src/components/spotlight/spotlight.tsx` - Always use sync, remove `syncFirst` parameter

## Testing

1. Create a worktree via the UI
2. Manually delete the worktree directory via command line (`rm -rf ~/.mort/repositories/<slug>/<worktree-name>`)
3. Open Spotlight - should NOT show the deleted worktree
4. Open Worktrees page - should NOT show the deleted worktree
5. Verify settings.json no longer contains the deleted worktree entry
