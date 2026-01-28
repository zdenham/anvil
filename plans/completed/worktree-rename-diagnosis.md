# Worktree Renaming Diagnosis

## Problem Statement

Worktree renaming is not working - the `settings.json` metadata is not being updated, and the git branch is not being renamed, even though the agent process is generating names and emitting events.

## Desired Behavior

When the agent generates a descriptive name for a worktree:
1. **Update `settings.json`** - Set the `name` field to the new display name
2. **Rename the git branch** - Change the branch name to match the new display name
3. **Update sidebar display** - Show the new name in the left panel

The directory path should **NOT** change - only metadata and branch name.

## Related Plans

- **`plans/worktree-is-renamed-flag.md`** (Implemented) - Adds the `isRenamed` flag to prevent re-renaming on subsequent thread runs

## Root Cause Analysis

### Issue 1: `worktreeId` vs `worktreeName` Parameter Mismatch (Critical)

In `src/entities/worktrees/listeners.ts`:
```typescript
await worktreeService.rename(repoId, worktreeId, name);
```

The `worktreeId` being passed is the **worktree UUID** from the agent event, but `worktree_rename` expects the current **worktree name** as `old_name`:

```rust
// worktree_commands.rs
let worktree = worktrees
    .iter_mut()
    .find(|w| w.name == old_name)  // <-- Looking for name match, not ID
    .ok_or(format!("Worktree \"{}\" not found", old_name))?;
```

**This means the rename fails silently** because the lookup by `old_name` won't find a worktree with `name == worktreeId` (a UUID).

### Issue 2: No Branch Rename

The current `worktree_rename` command only updates the `name` field in `settings.json`. It does not rename the git branch. When a worktree is created with branch `red-fox` and renamed to `auth-fix`, the branch should also be renamed to `auth-fix`.

## Diagnosis Summary

| Component | Status | Issue |
|-----------|--------|-------|
| Name generation | Working | Names generated correctly via Haiku |
| Event emission | Working | `worktree:name:generated` emitted properly |
| Event reception | Working | Frontend listener receives events |
| Tauri IPC call | **Failing** | `worktreeId` vs `name` mismatch - lookup fails |
| Rust rename | Incomplete | Only updates `name`, doesn't rename branch |
| `settings.json` | **Not Updated** | Due to lookup failure |

## Proposed Fix

### Step 1: Fix the Rust `worktree_rename` to lookup by ID

Update `src-tauri/src/worktree_commands.rs` to find worktree by ID (not just name):

```rust
/// Rename a worktree (metadata and branch name only - path stays the same).
#[tauri::command]
pub async fn worktree_rename(
    repo_name: String,
    worktree_id: String,  // This is the worktree UUID
    new_name: String,
) -> Result<(), String> {
    // Validate new name format
    if !new_name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Name can only contain letters, numbers, dashes, and underscores".into());
    }

    let mut settings = load_settings(&repo_name)?;

    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Check new name doesn't already exist
    if worktrees.iter().any(|w| w.name == new_name && w.id != worktree_id) {
        return Err(format!("Worktree \"{}\" already exists", new_name));
    }

    // Find the worktree by ID
    let worktree = worktrees
        .iter_mut()
        .find(|w| w.id == worktree_id)
        .ok_or(format!("Worktree with ID \"{}\" not found", worktree_id))?;

    // Skip if already renamed to this name
    if worktree.name == new_name {
        return Ok(());
    }

    let old_branch_name = worktree.name.clone();
    let worktree_path = worktree.path.clone();

    // Update metadata
    worktree.name = new_name.clone();
    worktree.is_renamed = true;  // See plans/worktree-is-renamed-flag.md

    settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;

    // Rename the git branch
    rename_branch(&worktree_path, &old_branch_name, &new_name)?;

    Ok(())
}

/// Rename a git branch in the worktree
fn rename_branch(worktree_path: &str, old_name: &str, new_name: &str) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["branch", "-m", old_name, new_name])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        // Log but don't fail - branch might already have different name
        eprintln!(
            "Warning: Failed to rename branch: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}
```

### Step 2: Add logging for debugging

Add logging to the Rust backend to trace rename operations:

```rust
println!("[worktree_rename] Looking for worktree with ID: {}", worktree_id);
println!("[worktree_rename] Found worktree: {:?}", worktree.name);
println!("[worktree_rename] Renaming to: {}", new_name);
```

## Files to Modify

| File | Change |
|------|--------|
| `src-tauri/src/worktree_commands.rs` | Fix lookup to use ID, add branch rename |

## Testing Plan

1. Create a new worktree with random name (e.g., "red-fox")
2. Start a thread with a descriptive prompt (e.g., "fix the auth bug")
3. Verify agent logs show name generation (e.g., "auth-fix")
4. Check `settings.json`:
   - `name` field updated to "auth-fix"
   - `isRenamed` set to `true`
   - `path` unchanged (still contains "red-fox")
5. Verify git branch renamed: `git branch` in worktree shows "auth-fix"
6. Verify sidebar shows "auth-fix" as the display name
