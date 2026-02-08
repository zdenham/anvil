# Restore Deleted Tauri Commands

## Background

Commit `2898bd0` ("socket hug") inadvertently deleted several Tauri commands that were being used by the frontend. The following errors appeared at runtime:

```
Command fs_list_dir not found
Command get_clipboard_history not found
Command is_onboarded not found
```

## Phases

- [x] Restore filesystem commands (`fs_list_dir`, `fs_is_git_repo`)
- [x] Restore clipboard commands (`get_clipboard_history`, `get_clipboard_content`)
- [x] Restore lib.rs commands (`get_saved_hotkey`, `get_saved_clipboard_hotkey`, `is_onboarded`)
- [x] Update invoke_handler to register all restored commands
- [x] Verify build succeeds

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Analysis

### Commands Actually Used (verified via grep)

| Command | File | Frontend Usage |
|---------|------|----------------|
| `fs_list_dir` | filesystem.rs | `src/lib/filesystem-client.ts` |
| `fs_is_git_repo` | filesystem.rs | `src/lib/filesystem-client.ts` |
| `get_clipboard_history` | clipboard.rs | `src/components/clipboard/clipboard-manager.tsx` |
| `get_clipboard_content` | clipboard.rs | `src/components/clipboard/clipboard-manager.tsx` |
| `is_onboarded` | lib.rs | `src/lib/hotkey-service.ts` |
| `get_saved_hotkey` | lib.rs | `src/lib/hotkey-service.ts` |
| `get_saved_clipboard_hotkey` | lib.rs | `src/lib/hotkey-service.ts` |

### Commands NOT Used (skipping)

These were deleted but are not called anywhere in the frontend:
- `greet` - Test function
- `unpin_control_panel`
- `snap_control_panel_position`
- `pop_out_control_panel`
- `get_control_panel_window_data`
- `list_control_panel_window_instances`
- `list_repositories`
- `delete_git_branch`
- `list_mort_branches`
- `delete_clipboard_entry`
- `clear_clipboard_history`
- `show_clipboard_manager`

---

## Exact Code to Restore

### filesystem.rs

Add after line 6 (`use crate::shell;`):
```rust
use serde::Serialize;
```

Add struct after imports (before first function):
```rust
/// Directory entry metadata returned by list_dir
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
}
```

Add after `fs_remove_dir_all` function:
```rust
/// Lists directory contents with metadata
#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            is_file: metadata.is_file(),
        });
    }

    Ok(result)
}
```

Add after `copy_dir_recursive` function (before `fs_git_worktree_add`):
```rust
/// Checks if a directory is a git repository
#[tauri::command]
pub fn fs_is_git_repo(path: String) -> bool {
    let git_dir = Path::new(&path).join(".git");
    git_dir.exists()
}
```

### clipboard.rs

Update import on line 9 to:
```rust
use crate::clipboard_db::{self, ClipboardEntryPreview};
```

Add constant after `POLL_INTERVAL_MS`:
```rust
const DEFAULT_RESULT_LIMIT: usize = 100;
```

Add these commands after `initialize` function and before `paste_clipboard_entry`:
```rust
/// Get clipboard history previews, optionally filtered by query
#[tauri::command]
pub fn get_clipboard_history(
    query: Option<String>,
    limit: Option<usize>,
) -> Vec<ClipboardEntryPreview> {
    let limit = limit.unwrap_or(DEFAULT_RESULT_LIMIT);

    let results = match query {
        Some(q) if !q.trim().is_empty() => {
            clipboard_db::search_entries(&q, limit).unwrap_or_default()
        }
        _ => clipboard_db::get_recent_entries(limit).unwrap_or_default(),
    };

    tracing::debug!(count = results.len(), "Returning clipboard history");

    results
}

/// Get full content for a specific entry (for preview panel)
#[tauri::command]
pub fn get_clipboard_content(id: String) -> Option<String> {
    clipboard_db::get_entry_content(&id).ok().flatten()
}
```

### lib.rs

Add after `save_hotkey` function:
```rust
/// Gets the saved spotlight hotkey from config
#[tauri::command]
fn get_saved_hotkey() -> String {
    config::get_spotlight_hotkey()
}
```

Add after `save_clipboard_hotkey` function:
```rust
/// Gets the saved clipboard hotkey from config
#[tauri::command]
fn get_saved_clipboard_hotkey() -> String {
    config::get_clipboard_hotkey()
}

/// Checks if the user has completed onboarding
#[tauri::command]
fn is_onboarded() -> bool {
    config::is_onboarded()
}
```

### invoke_handler updates

Add to invoke_handler:
```rust
get_saved_hotkey,
get_saved_clipboard_hotkey,
is_onboarded,
clipboard::get_clipboard_history,
clipboard::get_clipboard_content,
filesystem::fs_list_dir,
filesystem::fs_is_git_repo,
```

---

## Verification

After implementation, run:
```bash
cd src-tauri && cargo build
```

And verify no errors about missing commands appear in the runtime logs.
