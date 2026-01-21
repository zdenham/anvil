# Worktree Management Bugs Investigation (Revised)

## Executive Summary

Investigation of reported issues with the explicit worktree management feature, plus cleanup of dead code from the old pool-based architecture.

**Issues:**
1. **Default worktree not set to "main"** - The system doesn't recognize the source repository as a worktree
2. **Repository dropdown empty in Worktrees page** - Slug mismatch between frontend and Rust backend
3. **Dead code from pool-based architecture** - Old `claim`/`lastTaskId`/`lastReleasedAt` fields and cleanup code

**Key Context Changes:**
- The `-{n}` worktree bootstrapping has been removed - worktrees are now created on demand
- The system should support **existing worktrees** that already exist on disk (e.g., created via `git worktree add`)

---

## Issue 0 (New): Reconcile WorktreeState Shapes

### Problem Statement
The transition from pool-based to explicit worktree management left two different `WorktreeState` shapes in the codebase:

**Old Shape (Pool Manager - now deleted):**
```typescript
WorktreeState {
  path: string;
  name: string;
  lastAccessedAt?: number;
  currentBranch?: string;
  // DEPRECATED pool-era fields:
  claim?: { taskId: string; threadIds: string[]; claimedAt: number } | null;
  lastTaskId?: string;      // Task that last used this worktree
  lastReleasedAt?: number;  // When worktree was released
}
```

**New Shape (Explicit Management):**
```typescript
WorktreeState {
  path: string;
  name: string;
  lastAccessedAt?: number;
  currentBranch?: string | null;
}
```

### Current State
- **TypeScript types are correct** - `core/types/repositories.ts` has the simplified schema
- **Rust struct is correct** - `src-tauri/src/worktree_commands.rs` matches
- **Migration exists** - `settings-service.ts:migrateWorktreeState()` strips deprecated fields
- **Dead cleanup code remains** - Rust still has `clear_all_worktree_claims()` for non-existent claims

### Dead Code to Remove

| Location | Dead Code | Why It's Dead |
|----------|-----------|---------------|
| `src-tauri/src/mort_commands.rs:287-366` | `clear_all_worktree_claims()` function | Claims don't exist in new schema |
| `src-tauri/src/lib.rs:856` | Call to `clear_all_worktree_claims()` | Function does nothing useful |
| `src-tauri/src/lib.rs:764` | Comment "stale claim detection" | No more claims to detect |

### Proposed Fix

**Step 1: Remove dead Rust code**
1. Delete `clear_all_worktree_claims()` function from `mort_commands.rs`
2. Remove the call to it from `lib.rs` startup
3. Update comments to remove claim references

**Step 2: Verify migration handles legacy data**
The existing `migrateWorktreeState()` in `settings-service.ts` already strips deprecated fields. This is correct and should remain for backwards compatibility with any old settings.json files.

---

## Issue 1: Source Repository Should Be Listed as "main" Worktree

### Problem Statement
When a repository is connected, the source repository itself (e.g., `/Users/zac/Documents/juice/mort/mortician`) should appear as the "main" worktree. Currently, the worktrees list is empty until the user manually creates worktrees.

### Current Behavior
- `createFromFolder()` sets `worktrees: []` in settings.json
- Only explicitly created worktrees appear in the list
- The source repository is tracked via `sourcePath` but not as a worktree

### Expected Behavior
1. The source repository should be automatically registered as "main" worktree
2. Existing git worktrees (created via `git worktree add`) should be discovered and listed

### Proposed Fix

**Part A: Register source repo as "main" worktree**

In `src/entities/repositories/service.ts:createFromFolder()`, add the source path as the first worktree:

```typescript
// In createFromFolder(), after determining sourcePath:
const worktrees: WorktreeState[] = [{
  path: sourcePath,
  name: 'main',
  lastAccessedAt: now,
  currentBranch: null, // Could optionally detect current branch via git
}];

const settings: RepositorySettings = {
  // ...existing fields...
  worktrees,  // Instead of []
};
```

**Part B: Discover existing git worktrees**

Add a function to detect worktrees that already exist on disk:

```typescript
async function discoverExistingWorktrees(sourcePath: string): Promise<WorktreeState[]> {
  // Call `git worktree list --porcelain` to find existing worktrees
  // Parse output and return WorktreeState array
}
```

The Rust side already has `git_worktree_list` in `git_commands.rs` that could be leveraged.

---

## Issue 2: Repository Dropdown Not Working in Worktrees Page

### Problem Statement
The repository dropdown in the Worktrees page shows repositories, but selecting one fails to load worktrees due to a path mismatch.

### Root Cause Analysis

**The flow:**
1. Frontend gets repository names from store: `Object.keys(repositoriesMap)` → e.g., `"mortician"`
2. Frontend calls `worktreeService.list("mortician")`
3. Tauri command `worktree_list` uses `repo_name` directly as path: `paths::repositories_dir().join(repo_name)`
4. This looks for `~/.mort/repositories/mortician/settings.json`

**The problem:**
- The repository **name** (display name) may differ from the **slug** (directory name)
- Example: A repo named "My Project" has slug "my-project"
- The frontend passes the name, but Rust expects the slug

**Current workaround for "mortician":**
- Name and slug are the same, so it works by coincidence
- But for any repo with spaces/special characters, it will fail

### Proposed Fix

**Option A: Pass slug from frontend (Recommended)**

The repository already stores `sourcePath`. We should derive and store the slug:

1. Add `slug` field to Repository type or compute it from name
2. Pass slug (not name) to Tauri commands

```typescript
// In worktrees-page.tsx:
const repo = repositoriesMap[selectedRepoName];
const slug = slugify(repo.name);  // Or use stored slug
await worktreeService.list(slug);
```

**Option B: Slugify in Rust**

Add a `slugify` function in Rust that matches the frontend logic:

```rust
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn load_settings(repo_name: &str) -> Result<serde_json::Value, String> {
    let slug = slugify(repo_name);
    let settings_path = paths::repositories_dir().join(&slug).join("settings.json");
    // ...
}
```

---

## Issue 3 (New): Supporting Existing Git Worktrees

### Problem Statement
Users may have existing git worktrees created outside of Mort (via `git worktree add`). These should be discoverable and manageable.

### Proposed Solution

Add a "Sync from Git" feature that:
1. Runs `git worktree list --porcelain` on the source repository
2. Compares with worktrees in settings.json
3. Adds any missing worktrees to the list
4. Optionally removes entries for worktrees that no longer exist

**Implementation:**

```typescript
// New Tauri command: worktree_sync
#[tauri::command]
pub async fn worktree_sync(repo_name: String) -> Result<Vec<WorktreeState>, String> {
    let settings = load_settings(&repo_name)?;
    let source_path = settings.get("sourcePath").and_then(|v| v.as_str()).ok_or("No sourcePath")?;

    // Get worktrees from git
    let git_worktrees = git_commands::git_worktree_list(source_path.to_string()).await?;

    // Merge with existing settings, preserving names for known paths
    // ...
}
```

---

## Summary of Required Changes

| File | Change | Priority |
|------|--------|----------|
| `src-tauri/src/mort_commands.rs` | Remove dead `clear_all_worktree_claims()` function | High |
| `src-tauri/src/lib.rs` | Remove call to `clear_all_worktree_claims()` and stale comments | High |
| `src/entities/repositories/service.ts` | Add "main" worktree for source repo in `createFromFolder()` | High |
| `src-tauri/src/worktree_commands.rs` | Slugify repo_name before path lookup | High |
| `src-tauri/src/worktree_commands.rs` | Add `worktree_sync` command to discover existing worktrees | Medium |
| `src/entities/worktrees/service.ts` | Add `sync()` method | Medium |
| `src/components/main-window/worktrees-page.tsx` | Add "Sync from Git" button | Medium |

---

## Recommended Implementation Order

1. **Remove dead claim code first** - Delete `clear_all_worktree_claims()` and related code
2. **Fix the slug issue** - Add slugification in Rust commands so existing repos work
3. **Add "main" worktree** - Modify `createFromFolder()` to include source repo as main worktree
4. **Add worktree sync** - Implement discovery of existing git worktrees
5. **Add migration for existing repos** - One-time migration to add "main" worktree to repos that don't have it

---

## Testing Verification

After fixes, verify:
1. Worktrees page dropdown shows repositories
2. Selecting a repo shows the list of worktrees (including "main")
3. New repositories automatically have a "main" worktree pointing to source path
4. Existing git worktrees can be discovered and listed
5. Repos with special characters in names work correctly (e.g., "My Project" → "my-project")
