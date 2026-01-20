# Sub-Plan 2: Tauri Commands and Frontend Service

## Prerequisites
- **Sub-Plan 0 (Dead Code Deletion)** must be complete

## Parallel Execution
Can run **in parallel with Sub-Plan 1** (Data Model/Core Service) after Sub-Plan 0 completes.

## Overview
Create Tauri commands for worktree CRUD operations and the frontend service client that calls them.

---

## Part A: Tauri Commands

### New File: `src-tauri/src/worktree_commands.rs`

Higher-level worktree management commands that:
1. Manage `settings.json` worktree metadata (names, timestamps)
2. Call existing git primitives from `git_commands.rs`
3. Handle validation, locking, and error cases

**Existing primitives in `git_commands.rs` (DO NOT MODIFY):**
- `git_create_worktree(repo_path, worktree_path, _branch)` - Creates git worktree with detached HEAD
- `git_remove_worktree(repo_path, worktree_path)` - Removes git worktree with force
- `git_list_worktrees(repo_path)` - Lists git worktrees

```rust
use crate::git_commands;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub path: String,
    pub name: String,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
}

/// List worktrees from settings, sorted by lastAccessedAt (most recent first).
#[tauri::command]
pub async fn worktree_list(repo_name: String) -> Result<Vec<WorktreeState>, String> {
    let settings = load_settings(&repo_name)?;
    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    worktrees.sort_by(|a, b| {
        b.last_accessed_at
            .unwrap_or(0)
            .cmp(&a.last_accessed_at.unwrap_or(0))
    });
    Ok(worktrees)
}

/// Create a new named worktree.
#[tauri::command]
pub async fn worktree_create(repo_name: String, name: String) -> Result<WorktreeState, String> {
    // Validate name format
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Name can only contain letters, numbers, dashes, and underscores".into());
    }

    let mut settings = load_settings(&repo_name)?;

    // Check for duplicate names
    let worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    if worktrees.iter().any(|w| w.name == name) {
        return Err(format!("Worktree \"{}\" already exists", name));
    }

    // Get source path
    let source_path = settings
        .get("sourcePath")
        .and_then(|v| v.as_str())
        .ok_or("Repository has no sourcePath")?
        .to_string();

    // Build worktree path
    let worktree_path = paths::repositories_dir()
        .join(&repo_name)
        .join(&name)
        .to_string_lossy()
        .to_string();

    // Call existing git primitive
    git_commands::git_create_worktree(source_path, worktree_path.clone(), String::new()).await?;

    // Create worktree state
    let worktree = WorktreeState {
        path: worktree_path,
        name,
        last_accessed_at: Some(now_millis()),
        current_branch: None,
    };

    // Update settings
    let mut arr = worktrees;
    arr.push(worktree.clone());
    settings["worktrees"] = serde_json::to_value(&arr).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;

    Ok(worktree)
}

/// Delete a worktree by name.
#[tauri::command]
pub async fn worktree_delete(repo_name: String, name: String) -> Result<(), String> {
    let mut settings = load_settings(&repo_name)?;

    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let index = worktrees
        .iter()
        .position(|w| w.name == name)
        .ok_or(format!("Worktree \"{}\" not found", name))?;

    let worktree_path = worktrees[index].path.clone();

    let source_path = settings
        .get("sourcePath")
        .and_then(|v| v.as_str())
        .ok_or("Repository has no sourcePath")?
        .to_string();

    // Call existing git primitive
    git_commands::git_remove_worktree(source_path, worktree_path).await?;

    // Update settings
    worktrees.remove(index);
    settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;

    Ok(())
}

/// Rename a worktree (metadata only - path stays the same).
#[tauri::command]
pub async fn worktree_rename(
    repo_name: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    // Validate new name format
    if !new_name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Name can only contain letters, numbers, dashes, and underscores".into());
    }

    let mut settings = load_settings(&repo_name)?;

    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Check new name doesn't exist
    if worktrees.iter().any(|w| w.name == new_name) {
        return Err(format!("Worktree \"{}\" already exists", new_name));
    }

    // Find and rename
    let worktree = worktrees
        .iter_mut()
        .find(|w| w.name == old_name)
        .ok_or(format!("Worktree \"{}\" not found", old_name))?;

    worktree.name = new_name;

    // Update settings
    settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;

    Ok(())
}

/// Update lastAccessedAt timestamp for a worktree.
#[tauri::command]
pub async fn worktree_touch(repo_name: String, worktree_path: String) -> Result<(), String> {
    let mut settings = load_settings(&repo_name)?;

    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    if let Some(worktree) = worktrees.iter_mut().find(|w| w.path == worktree_path) {
        worktree.last_accessed_at = Some(now_millis());
        settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
        save_settings(&repo_name, &settings)?;
    }

    Ok(())
}

// Helper functions

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn load_settings(repo_name: &str) -> Result<serde_json::Value, String> {
    let settings_path = paths::repositories_dir()
        .join(repo_name)
        .join("settings.json");

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

fn save_settings(repo_name: &str, settings: &serde_json::Value) -> Result<(), String> {
    let settings_path = paths::repositories_dir()
        .join(repo_name)
        .join("settings.json");

    let content =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&settings_path, content).map_err(|e| format!("Failed to write settings: {}", e))
}
```

---

## Part B: Register Commands

### File: `src-tauri/src/lib.rs`

Add module declaration and register commands:

```rust
mod worktree_commands;

// In run() function, add to invoke_handler:
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    worktree_commands::worktree_list,
    worktree_commands::worktree_create,
    worktree_commands::worktree_delete,
    worktree_commands::worktree_rename,
    worktree_commands::worktree_touch,
])
```

---

## Part C: Frontend Service Client

### New File: `src/entities/worktrees/service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { WorktreeState } from "@core/types/repositories";

class WorktreeServiceClient {
  /**
   * List all worktrees for a repository, sorted by most recently accessed.
   */
  async list(repoName: string): Promise<WorktreeState[]> {
    return invoke("worktree_list", { repoName });
  }

  /**
   * Create a new named worktree.
   */
  async create(repoName: string, name: string): Promise<WorktreeState> {
    return invoke("worktree_create", { repoName, name });
  }

  /**
   * Delete a worktree by name.
   */
  async delete(repoName: string, name: string): Promise<void> {
    return invoke("worktree_delete", { repoName, name });
  }

  /**
   * Rename a worktree (metadata only, path stays the same).
   */
  async rename(repoName: string, oldName: string, newName: string): Promise<void> {
    return invoke("worktree_rename", { repoName, oldName, newName });
  }

  /**
   * Update lastAccessedAt timestamp (called when task uses worktree).
   */
  async touch(repoName: string, worktreePath: string): Promise<void> {
    return invoke("worktree_touch", { repoName, worktreePath });
  }
}

export const worktreeService = new WorktreeServiceClient();
```

### New File: `src/entities/worktrees/index.ts`

```typescript
export { worktreeService } from "./service";
```

---

## Verification Steps

1. Create `src-tauri/src/worktree_commands.rs`
2. Register commands in `src-tauri/src/lib.rs`
3. Build Rust: `cargo build` (in src-tauri directory)
4. Create `src/entities/worktrees/service.ts`
5. Create `src/entities/worktrees/index.ts`
6. TypeScript compile: `pnpm tsc --noEmit`

## Success Criteria
- All 5 Tauri commands implemented and registered
- Rust compiles without errors
- Frontend service client has matching methods
- TypeScript compiles without errors
