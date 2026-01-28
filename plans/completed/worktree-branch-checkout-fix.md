# Worktree Branch Checkout Fix

## Problem Statement

When a worktree is renamed, the `currentBranch` field in `WorktreeState` remains `null`. The desired behavior is that:
1. The worktree should have a branch checked out (not detached HEAD)
2. The branch name should match the worktree meta-name

## Current State Audit

### Worktree Creation Flow

1. **`worktree_create()` in Rust** (`src-tauri/src/worktree_commands.rs:22-78`)
   - Calls `git_create_worktree()` with empty branch string
   - `git_create_worktree()` executes: `git worktree add --detach <path>`
   - Creates `WorktreeState` with `current_branch: None`
   - **Result: Worktree starts in detached HEAD state with no branch**

2. **`git_create_worktree()` in Rust** (`src-tauri/src/git_commands.rs:257-278`)
   - Uses `--detach` flag explicitly
   - Comment says "The caller will checkout the appropriate branch/commit" - but this never happens

### Worktree Renaming Flow

1. **Agent initiates renaming** (`agents/src/runners/simple-runner-strategy.ts:489-528`)
   - `initiateWorktreeNaming()` generates a name via `generateWorktreeName()`
   - Writes name directly to disk via `updateWorktreeNameOnDisk()`
   - Sets `isRenamed: true` in settings.json
   - Emits `worktree:name:generated` event

2. **`updateWorktreeNameOnDisk()`** (`agents/src/runners/simple-runner-strategy.ts:536-590`)
   - Scans repositories to find matching repoId
   - Updates worktree name and `isRenamed` flag
   - **Does NOT create or checkout any branch**

3. **Frontend listener** (`src/entities/worktrees/listeners.ts`)
   - Receives event, calls Rust `worktree_rename`

4. **`worktree_rename()` in Rust** (`src-tauri/src/worktree_commands.rs:138-222`)
   - Updates metadata (name, `is_renamed: true`)
   - Calls `rename_branch()` to rename git branch

5. **`rename_branch()` in Rust** (`src-tauri/src/worktree_commands.rs:225-251`)
   - Executes: `git branch -m <old_name> <new_name>`
   - **Problem: This tries to rename a branch that doesn't exist!**
   - Uses the old worktree name (random animal name) as old branch name
   - The worktree is in detached HEAD, so there's no branch to rename
   - This fails silently (logged as warning but doesn't propagate)

### Why `currentBranch` is Always Null

1. Worktrees are created with `--detach` → no branch
2. Branch rename tries to rename non-existent branch → fails silently
3. `currentBranch` is never set anywhere after creation
4. No branch is ever actually created or checked out

### Key Problem Areas

| Location | Issue |
|----------|-------|
| `git_create_worktree()` | Creates detached HEAD, no branch |
| `worktree_create()` | Sets `current_branch: None`, never updates |
| `rename_branch()` | Tries to rename non-existent branch |
| `updateWorktreeNameOnDisk()` | Only updates metadata, no git operations |

## Proposed Solution

The fix should happen at the **Node/Agent level** when the worktree gets renamed on disk, since that's where we have the worktree path and the new name available.

### Option A: Create and Checkout Branch in Agent (Recommended)

Add branch creation/checkout to `updateWorktreeNameOnDisk()` in `simple-runner-strategy.ts`:

1. After updating the settings.json, use `NodeGitAdapter` to:
   - Create a new branch with the worktree name
   - Checkout that branch in the worktree

This keeps the git operation close to where the rename happens and uses the existing `NodeGitAdapter` infrastructure.

### Option B: New Git Service in Agents

Create a dedicated git service in `agents/src/services/git-service.ts` that provides:
- `createAndCheckoutBranch(worktreePath, branchName)`
- Wraps `NodeGitAdapter` operations

This is cleaner separation but adds another abstraction layer.

## Implementation Plan

### Step 1: Update `updateWorktreeNameOnDisk()` to Create/Checkout Branch

**File:** `agents/src/runners/simple-runner-strategy.ts`

After writing the updated settings.json, add:

```typescript
import { NodeGitAdapter } from '../../../core/adapters/node/git-adapter';

// In updateWorktreeNameOnDisk(), after writeFileSync:
const gitAdapter = new NodeGitAdapter();
const worktreePath = settings.worktrees[worktreeIndex].path;

// Create and checkout the new branch
try {
  // Check if branch already exists
  if (!gitAdapter.branchExists(worktreePath, newName)) {
    gitAdapter.createBranch(worktreePath, newName);
  }
  gitAdapter.checkoutBranch(worktreePath, newName);

  // Update currentBranch in settings
  settings.worktrees[worktreeIndex].currentBranch = newName;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  emitLog("INFO", `[worktree_rename] Created and checked out branch: "${newName}"`);
} catch (err) {
  emitLog("WARN", `[worktree_rename] Failed to create/checkout branch: ${err}`);
  // Continue - branch creation is not critical
}
```

### Step 2: Update `WorktreeState` Type if Needed

**File:** `core/types/repositories.ts`

Verify that `currentBranch` is properly typed as `string | null`.

### Step 3: Update Rust `rename_branch()` to Handle Missing Branch

**File:** `src-tauri/src/worktree_commands.rs`

The Rust side's `rename_branch()` can be simplified since the agent will now handle branch creation. It should:
- Check if a branch exists before trying to rename
- Or be removed entirely since the agent handles it

### Step 4: Sync `currentBranch` After Rename

When the frontend receives the rename event, it should sync the worktree state to pick up the new `currentBranch` value.

## Files to Modify

1. **`agents/src/runners/simple-runner-strategy.ts`**
   - Add import for `NodeGitAdapter`
   - Modify `updateWorktreeNameOnDisk()` to create/checkout branch
   - Update `currentBranch` in settings after branch checkout

2. **`src-tauri/src/worktree_commands.rs`** (optional cleanup)
   - Remove or simplify `rename_branch()` function
   - The agent now handles branch creation

3. **`src/entities/worktrees/listeners.ts`** (optional)
   - Trigger sync after rename to refresh UI state

## Testing

1. Create a new worktree via agent
2. Wait for auto-rename to complete
3. Verify:
   - `currentBranch` in settings.json matches worktree name
   - `git branch` in worktree shows the correct branch checked out
   - UI displays the branch name correctly

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Branch name conflicts | Check `branchExists()` before creating |
| Git operation failures | Catch errors, log, continue (non-fatal) |
| Race conditions | Agent writes settings first, then UI syncs |

## Summary

The core issue is that worktrees are created in detached HEAD state and no branch is ever created. The fix is to add branch creation/checkout to the agent's `updateWorktreeNameOnDisk()` function, using the existing `NodeGitAdapter` infrastructure. This ensures the branch name matches the worktree meta-name as desired.
