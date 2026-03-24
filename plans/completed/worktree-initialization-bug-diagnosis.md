# Worktree Initialization Bug Diagnosis

## Problem Statement

When a new task runs, the worktree should be initialized with the latest from local main before creating the task branch. However, we observed that task `add-hello-world-to-readme` (created 2026-01-04) has a branch diverging from commit `a86f842` (2025-12-28), which is 57 commits behind current main (`e35c4c4`).

## Root Cause Analysis

There are **two bugs** - one historical (now fixed) and one current:

### Historical Bug (Fixed Jan 3)

The OLD code in `agents/src/git.ts` (before Jan 3) had no merge base checkout:

```typescript
// OLD CODE (Dec 28) - agents/src/git.ts
export function createTaskBranch(cwd: string, branchName: string): void {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd });
    execFileSync("git", ["checkout", branchName], { cwd, stdio: "pipe" });
  } catch {
    // BUG: Creates branch from worktree HEAD, not from latest main!
    execFileSync("git", ["checkout", "-b", branchName], { cwd, stdio: "pipe" });
  }
}
```

This created branches from wherever the worktree HEAD happened to be, not from latest main.

**Evidence from reflog:**
```
8f8e641 task/add-hello-world-to-readme@{3}: branch: Created from HEAD
```

The branch was created from `8f8e641` (worktree HEAD on Dec 28), not from the merge base.

### Current Bug (Still Exists)

The NEW code in `core/services/worktree/branch-manager.ts` has the fix for new branches, but doesn't handle existing branches correctly:

### Bug 1: Early Return Optimization (Line 39-41)

```typescript
// Optimization: skip if already on target branch
if (this.isOnBranch(worktreePath, branch)) {
  return;  // <-- BUG: Skips merge base checkout entirely
}
```

**Impact**: When a worktree is reused for the same task (via task affinity or concurrent access), and it's already on the task branch, the function returns immediately without:
- Fetching updates (already done in allocation-service, but...)
- Checking out the new merge base
- Doing anything to update the branch

**Scenario**:
1. First thread runs on task, creates branch from commit X
2. Thread completes, worktree released (keeps `lastTaskId` affinity)
3. Main advances to commit Y
4. New thread runs on same task
5. Worktree claimed via affinity, already on task branch
6. `ensureBranch()` returns early → branch still based on X

### Bug 2: Existing Branch Checkout (Line 47-52)

```typescript
// Checkout merge base first (clean state)
this.git.checkoutCommit(worktreePath, mergeBase);

// Create branch if it doesn't exist
if (!this.git.branchExists(sourcePath, branch)) {
  this.git.createBranch(worktreePath, branch);
}

// Checkout the branch (attach HEAD)
this.git.checkoutBranch(worktreePath, branch);  // <-- BUG: Jumps back to old branch tip
```

**Impact**: When a task branch already exists (from a previous thread) but the worktree is not currently on it:
1. We correctly checkout the merge base (detached HEAD at latest main)
2. Branch exists, so we skip creation
3. We checkout the existing branch → **This moves HEAD back to the old branch tip, undoing the merge base positioning**

The merge base checkout is essentially useless because we immediately jump to wherever the existing branch was pointing.

## Evidence

```bash
# Task branch divergence point
$ git merge-base main task/add-hello-world-to-readme
a86f8427aaa713952bbb6ef27bddb08fe38fc82f

# That commit is from Dec 28
$ git log -1 --format="%ci %s" a86f842
2025-12-28 19:49:19 -0800 remove hello worlds from the readme

# Current main is 57 commits ahead
$ git log --oneline a86f842..e35c4c4 | wc -l
57

# But the task was created today
$ cat metadata.json | jq .createdAt
1767558934825  # 2026-01-04
```

## Code Flow

### Allocation Service (`allocation-service.ts:77-128`)

```
allocate() {
  1. claimWorktree()     → Get or claim worktree (may be reused via affinity)
  2. safeFetch()         → Fetch from origin in SOURCE REPO (not worktree)
  3. compute mergeBase   → git merge-base HEAD origin/main in SOURCE REPO
  4. ensureBranch()      → *** BUG LOCATION ***
}
```

### Branch Manager (`branch-manager.ts:32-53`)

```
ensureBranch() {
  if (already on branch) return;        // BUG 1: Early return
  checkout mergeBase;                   // Correctly positions at latest
  if (branch doesn't exist) create it;  // Only for new branches
  checkout branch;                      // BUG 2: Jumps back to old tip
}
```

## Proposed Fix

The fundamental issue is that `ensureBranch()` doesn't handle the case where a task branch needs to be **rebased** onto a newer main.

### Option A: Reset Branch to Merge Base (Simple but Lossy)

Force the branch to start from the new merge base:

```typescript
ensureBranch(worktreePath, branch, sourcePath, mergeBase): void {
  // Always checkout merge base first
  this.git.checkoutCommit(worktreePath, mergeBase);

  if (!this.git.branchExists(sourcePath, branch)) {
    // New branch: create at merge base
    this.git.createBranch(worktreePath, branch);
  } else {
    // Existing branch: reset to merge base (loses previous work!)
    this.git.resetBranch(worktreePath, branch, mergeBase);
  }

  this.git.checkoutBranch(worktreePath, branch);
}
```

**Pros**: Simple, always starts fresh
**Cons**: Loses any uncommitted work on the branch

### Option B: Rebase Existing Work (Preserves Commits)

Rebase the task branch onto the new merge base:

```typescript
ensureBranch(worktreePath, branch, sourcePath, mergeBase): void {
  if (!this.git.branchExists(sourcePath, branch)) {
    // New branch: create at merge base
    this.git.checkoutCommit(worktreePath, mergeBase);
    this.git.createBranch(worktreePath, branch);
    this.git.checkoutBranch(worktreePath, branch);
  } else {
    // Existing branch: checkout and rebase onto new merge base
    this.git.checkoutBranch(worktreePath, branch);
    const currentBase = this.git.getMergeBase(worktreePath, 'HEAD', mergeBase);
    if (currentBase !== mergeBase) {
      this.git.rebase(worktreePath, mergeBase);
    }
  }
}
```

**Pros**: Preserves existing commits, updates base
**Cons**: Rebase can fail with conflicts, more complex

### Option C: Keep Branch as-is (Document Behavior)

If the intent is that task branches should NOT be updated once created:
- Remove the misleading merge base computation for existing branches
- Document that tasks are "frozen" to their original main commit
- Add explicit "rebase task" functionality if user wants to update

### Recommended: Branch Name Collision Handling

Use `settings.taskBranches` (keyed by task ID) to differentiate resume vs collision:

```typescript
// In BranchManager or AllocationService:

function resolveBranchName(
  taskId: string,
  desiredBranch: string,
  settings: RepositorySettings,
  sourcePath: string
): { branch: string; isResume: boolean } {
  // 1. Check if this task already has a branch registered
  const existingInfo = settings.taskBranches[taskId];
  if (existingInfo) {
    return { branch: existingInfo.branch, isResume: true };
  }

  // 2. Check if desired branch name is taken
  const isTaken = (name: string) =>
    this.git.branchExists(sourcePath, name) ||
    Object.values(settings.taskBranches).some(info => info.branch === name);

  if (!isTaken(desiredBranch)) {
    return { branch: desiredBranch, isResume: false };
  }

  // 3. Collision - find unique name
  let suffix = 2;
  let uniqueName = `${desiredBranch}-${suffix}`;
  while (isTaken(uniqueName)) {
    suffix++;
    uniqueName = `${desiredBranch}-${suffix}`;
  }

  return { branch: uniqueName, isResume: false };
}
```

**Flow:**
1. **Resume**: Task ID found in `taskBranches` → use recorded branch, checkout existing
2. **New task, name available**: Create branch at merge base
3. **Collision**: Different task owns the name → create `branch-2`, `branch-3`, etc.

**After branch creation**, register in settings:
```typescript
settings.taskBranches[taskId] = {
  branch: resolvedBranch,
  baseBranch: settings.defaultBranch,
  mergeBase: mergeBase,
  createdAt: Date.now(),
};
```

## Files to Modify

1. `core/services/worktree/branch-manager.ts` - Fix `ensureBranch()` logic
2. `core/adapters/node/git-adapter.ts` - May need to add `resetBranch()` or `rebase()` methods
3. `core/adapters/types.ts` - Update GitAdapter interface if adding methods

## Testing Strategy

1. Unit tests for `BranchManager.ensureBranch()`:
   - New branch creation (should work)
   - Existing branch, worktree already on it (currently broken)
   - Existing branch, worktree on different branch (currently broken)
   - Existing branch with commits, mergeBase advanced (rebase case)

2. Integration test:
   - Create task, run first thread
   - Advance main with new commits
   - Run second thread on same task
   - Verify worktree is based on new main

## Questions to Resolve

1. **Should task branches auto-rebase?** Or should this be an explicit user action?
2. **What if rebase fails?** Conflict resolution strategy needed
3. **Concurrent threads**: If multiple threads share a worktree, rebasing could disrupt ongoing work

## Summary

| Bug | When | Status | Impact |
|-----|------|--------|--------|
| Branch created from worktree HEAD | Dec 28 (old code) | Fixed Jan 3 | Old branches still exist with wrong base |
| Existing branches not updated to new main | Current | **Still exists** | Reused branch names stay on old base |

**Why this task has wrong base**: The branch `task/add-hello-world-to-readme` was created by OLD code on Dec 28 from worktree HEAD (`8f8e641`), not from main. Today's task reused the same branch name, and the current code just checked out the existing branch without updating it.

**Immediate fix for this task**: Delete the old branch and re-run:
```bash
git -C /Users/zac/.anvil-dev/repositories/anvil/anvil-2 branch -D task/add-hello-world-to-readme
```

**Code fix needed**: Update `branch-manager.ts` to handle existing branches - either rebase them or reset them to the new merge base.

## Logging Added

Added logging to diagnose the exact flow. Run a new task and check logs for:

```
[AllocationService] Computed merge base
  - sourcePath: /path/to/main/repo
  - remoteBranch: origin/main
  - mergeBase: <should be latest main commit>
  - worktreePath: /path/to/worktree
  - taskBranch: task/branch-name

[BranchManager] ensureBranch called
  - worktreePath, branch, sourcePath, mergeBase

[BranchManager] Already on target branch, skipping  <-- BUG PATH 1
  OR
[BranchManager] Checking out merge base
[BranchManager] Branch existence check
  - branchExists: true  <-- BUG PATH 2: existing branch will be checked out
[BranchManager] Branch already exists - checking out existing branch (may not be at merge base!)
[BranchManager] Checking out branch
```

## Implementation Complete

### Changes Made

**`core/services/worktree/allocation-service.ts`**
- Added `BranchResolution` interface
- Added `resolveBranchName()` method to detect resume vs collision
- Updated `allocate()` to use branch resolution
- `WorktreeAllocation` now returns `branch` (resolved) and `isResume`
- Registers new branches in `settings.taskBranches[taskId]`
- Added logging for branch resolution

**`core/services/worktree/branch-manager.ts`**
- Added `isResume` parameter to `ensureBranch()`
- Resume flow: just checkout existing branch
- New branch flow: checkout merge base → create branch → checkout branch
- Added detailed logging

**`agents/src/orchestration.ts`**
- Uses resolved branch from allocation (handles collisions)
- Logs allocation details including `isResume` status

### Behavior

| Scenario | Detection | Action |
|----------|-----------|--------|
| Same task resuming | `taskBranches[taskId]` exists | Checkout existing branch |
| New task, name available | Branch doesn't exist | Create at merge base |
| Name collision | Branch exists but not for this task | Use `branch-2`, `branch-3`, etc. |

### Test Scenarios

1. **New task**: Create "add-foo-to-readme" → branch created at latest main
2. **Resume task**: Run same task again → existing branch checked out
3. **Collision**: Create new "add-hello-world-to-readme" task → gets `task/add-hello-world-to-readme-2`
