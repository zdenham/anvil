# Plan: Skip Worktree/Branch Renaming on Main Worktree

## Goal

Prevent the agent runner from renaming the worktree and creating/checking out a new branch when operating on the main worktree (the original repository directory).

---

## Background

### Current Behavior

When a new thread is created, the agent runner (`simple-runner-strategy.ts`) initiates worktree naming via `initiateWorktreeNaming()`. This:

1. Generates a name from the prompt using Claude Haiku
2. Creates a new git branch with that name
3. Checks out that branch
4. Updates the worktree metadata with `isRenamed: true` and the new `currentBranch`

### The Problem

This behavior is inappropriate for the **main worktree** because:
- The main worktree is the user's original repository directory
- Renaming it or switching branches could disrupt the user's workflow
- The main worktree should stay on whatever branch the user had checked out

### How Main Worktree Is Identified

The main worktree can be identified by comparing the worktree's path with the repository's `sourcePath`:
- In Rust (`worktree_commands.rs:323-328`): `git_wt.path == source_path`
- The `sourcePath` is stored in repository settings and represents the original repository directory

---

## Implementation

### Step 1: Add `isMainWorktree` Helper Function

Add a new helper function in `simple-runner-strategy.ts` that determines if a worktree is the main worktree by comparing paths.

**Location:** `agents/src/runners/simple-runner-strategy.ts` (after line 104)

```typescript
/**
 * Check if a worktree is the main worktree (sourcePath == worktree path).
 * The main worktree is the original repository directory and should not be renamed.
 *
 * @returns true if this is the main worktree, false otherwise (including on any errors)
 */
function isMainWorktree(mortDir: string, repoId: string, worktreeId: string): boolean {
  try {
    const reposDir = join(mortDir, "repositories");
    if (!existsSync(reposDir)) {
      return false;
    }

    // Scan all repository directories to find the one with matching repoId
    const repoDirs = readdirSync(reposDir).filter(name => {
      const stat = statSync(join(reposDir, name));
      return stat.isDirectory();
    });

    for (const repoDir of repoDirs) {
      const settingsPath = join(reposDir, repoDir, "settings.json");
      if (!existsSync(settingsPath)) {
        continue;
      }

      try {
        const content = readFileSync(settingsPath, "utf-8");
        const parsed = RepositorySettingsSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          continue;
        }

        const settings = parsed.data;
        if (settings.id !== repoId) {
          continue;
        }

        // Found the right repository, now find the worktree
        const worktree = settings.worktrees.find(w => w.id === worktreeId);
        if (worktree) {
          // Compare worktree path with repository sourcePath
          // Normalize paths for comparison (resolve symlinks, trailing slashes)
          const normalizedWorktreePath = worktree.path.replace(/\/$/, '');
          const normalizedSourcePath = settings.sourcePath.replace(/\/$/, '');
          return normalizedWorktreePath === normalizedSourcePath;
        }

        return false;
      } catch {
        continue;
      }
    }

    return false;
  } catch (err) {
    emitLog("WARN", `[worktree_rename] Failed to check isMainWorktree: ${err}`);
    return false;
  }
}
```

### Step 2: Update `setup()` to Skip Renaming for Main Worktree

Modify the worktree naming check in the `setup()` method to also skip if this is the main worktree.

**Location:** `agents/src/runners/simple-runner-strategy.ts` (lines 354-362)

**Current code:**
```typescript
const alreadyRenamed = isWorktreeRenamed(mortDir, repoId, worktreeId);
if (!alreadyRenamed) {
  emitLog("INFO", `[worktree_rename] New thread created, worktree not yet renamed - initiating worktree naming for worktreeId=${worktreeId}`);
  this.initiateWorktreeNaming(worktreeId, repoId, prompt, mortDir);
} else {
  emitLog("INFO", `[worktree_rename] Skipping worktree naming - worktree already renamed (worktreeId=${worktreeId})`);
}
```

**Updated code:**
```typescript
const alreadyRenamed = isWorktreeRenamed(mortDir, repoId, worktreeId);
const mainWorktree = isMainWorktree(mortDir, repoId, worktreeId);

if (mainWorktree) {
  emitLog("INFO", `[worktree_rename] Skipping worktree naming - this is the main worktree (worktreeId=${worktreeId})`);
} else if (!alreadyRenamed) {
  emitLog("INFO", `[worktree_rename] New thread created, worktree not yet renamed - initiating worktree naming for worktreeId=${worktreeId}`);
  this.initiateWorktreeNaming(worktreeId, repoId, prompt, mortDir);
} else {
  emitLog("INFO", `[worktree_rename] Skipping worktree naming - worktree already renamed (worktreeId=${worktreeId})`);
}
```

---

## Alternative Approach: Use `cwd` Directly

An alternative is to compare `cwd` (the working directory passed to the agent) with `sourcePath` directly, avoiding the need to look up the worktree by ID.

This is simpler but requires passing `cwd` to the check:

```typescript
function isMainWorktree(mortDir: string, repoId: string, cwd: string): boolean {
  // ... similar repo lookup logic ...
  const normalizedCwd = cwd.replace(/\/$/, '');
  const normalizedSourcePath = settings.sourcePath.replace(/\/$/, '');
  return normalizedCwd === normalizedSourcePath;
}
```

**Pros:** Simpler, doesn't require worktree lookup
**Cons:** Slightly different semantics (checks cwd vs worktree.path)

Given that `cwd` is the worktree path, this approach is equivalent and potentially cleaner. The choice is a matter of preference.

---

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/runners/simple-runner-strategy.ts` | Add `isMainWorktree()` helper, update `setup()` to skip renaming for main worktree |

---

## Testing Checklist

1. [ ] Create a new thread on the main worktree
   - Verify log shows "Skipping worktree naming - this is the main worktree"
   - Verify no branch creation occurs
   - Verify worktree metadata is not modified
2. [ ] Create a new thread on a non-main worktree
   - Verify worktree naming proceeds as normal
   - Verify branch is created and checked out
3. [ ] Resume a thread on the main worktree
   - Verify no renaming is attempted (already handles resume case)
4. [ ] Check that the main worktree's `isRenamed` stays `false` or absent

---

## Edge Cases

1. **Symlinked paths**: The path comparison should handle cases where `cwd` or `sourcePath` might be symlinked. Consider using `fs.realpathSync()` for normalization if issues arise.

2. **Trailing slashes**: Both paths should be normalized to remove trailing slashes before comparison.

3. **Case sensitivity**: On macOS (case-insensitive filesystem), paths might differ in case. For now, assume exact match is sufficient since both come from the same source.
