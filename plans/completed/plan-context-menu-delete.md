# Plan Context Menu: Delete & Git Untrack

Add a right-click context menu to plan items in the tree menu with two options:
1. **Delete** — deletes the plan markdown file from disk and removes plan metadata
2. **Delete + Remove from git** — runs `git rm` on the file (removes from git tracking AND deletes it) and removes plan metadata

## Phases

- [x] Add `git_rm` Tauri command (Rust backend)
- [x] Add `deletePlanFile` and `deletePlanFileAndUntrack` methods to `planService`
- [x] Add context menu to `PlanItem` component
- [x] Wire up context menu actions with confirmation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `git_rm` Tauri command

**File:** `src-tauri/src/git_commands.rs`

Add a new Tauri command that runs `git rm <file>` in a given repo/worktree directory. This removes the file from git tracking and deletes it from the working tree.

```rust
#[tauri::command]
pub async fn git_rm(working_directory: String, file_path: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["rm", "--force", &file_path])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to git rm {}: {}",
            file_path,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}
```

**File:** `src-tauri/src/lib.rs`

Register `git_rm` in the Tauri command handler list.

## Phase 2: Add plan deletion methods to `planService`

**File:** `src/entities/plans/service.ts`

Add two new public methods:

### `deletePlanFile(planId: string)`
1. Resolve the plan's absolute path via `resolvePlanPath(plan)`
2. Delete the markdown file from disk using `FilesystemClient.remove()`
3. If the plan is a folder (has child plans in subdirectory), also delete child markdown files and their metadata
4. Delete plan metadata via existing `this.delete(id)` (removes `~/.anvil/plans/{id}`)

### `deletePlanFileAndUntrack(planId: string)`
1. Resolve the plan's absolute path and worktree path
2. Call `git_rm` Tauri command with the worktree path and the plan's `relativePath`
3. Delete plan metadata via existing `this.delete(id)`

Both methods should:
- Use optimistic updates (remove from store immediately, rollback on failure)
- Handle the case where the file doesn't exist on disk (already deleted)
- Clean up child plans if the deleted plan is a folder parent
- Emit appropriate events for cross-window sync

## Phase 3: Add context menu to `PlanItem`

**File:** `src/components/tree-menu/plan-item.tsx`

1. Import `useContextMenu` from `@/components/ui/context-menu`
2. Add `onContextMenu={menu.open}` to the existing plan item `<div>`
3. Create a `PlanContextMenu` component rendered alongside the item:
   - **Delete** option (Trash2 icon) — calls `planService.deletePlanFile(item.id)`
   - **Delete + remove from git** option (GitBranch or similar icon) — calls `planService.deletePlanFileAndUntrack(item.id)`
   - Optionally include the existing **Archive** action as well for discoverability

## Phase 4: Confirmation UX

Both delete actions are destructive and should require confirmation. Two approaches that fit existing patterns:

**Option A: Inline confirmation** (matches the existing archive button pattern)
- First click shows "confirm delete?" text, second click executes

**Option B: Context menu with danger styling**
- Show the menu items with a red/danger color class
- Add a confirmation step: clicking "Delete" replaces the menu with "Are you sure?" + confirm/cancel

Recommend **Option B** since the context menu is already open — replace menu content with a confirmation view on first click, execute on confirm. This avoids closing and reopening UI.

## Key Files

| File | Change |
|------|--------|
| `src-tauri/src/git_commands.rs` | Add `git_rm` command |
| `src-tauri/src/lib.rs` | Register `git_rm` in handler list |
| `src/entities/plans/service.ts` | Add `deletePlanFile` + `deletePlanFileAndUntrack` |
| `src/components/tree-menu/plan-item.tsx` | Add context menu with delete options |
| `src/components/ui/context-menu.tsx` | Possibly add a `ContextMenuItemDanger` variant for red styling |

## Edge Cases

- **Plan file already deleted from disk** — `deletePlanFile` should still clean up metadata (no-op on file removal, proceed with metadata delete)
- **File not tracked by git** — `git rm` will fail; `deletePlanFileAndUntrack` should fall back to regular file deletion + show a toast/warning
- **Folder plans with children** — deleting a parent should cascade-delete children (same pattern as `archiveWithDescendants`)
- **Plan is currently selected/open in content pane** — after deletion, the content pane should clear or navigate away
