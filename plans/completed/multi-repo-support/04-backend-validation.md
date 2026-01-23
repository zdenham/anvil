# 04: Backend Validation Commands

## Prerequisites
- `01-add-repository.md` complete (basic multi-repo works)

## Goal
Add Rust commands for repository validation and removal.

## Tasks

### 1. Create repo_commands.rs

**File**: `src-tauri/src/repo_commands.rs` (new file)

```rust
use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
pub struct RepoValidation {
    pub exists: bool,
    pub is_git_repo: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn validate_repository(source_path: String) -> Result<RepoValidation, String> {
    let path = Path::new(&source_path);

    // Check path exists
    if !path.exists() {
        return Ok(RepoValidation {
            exists: false,
            is_git_repo: false,
            error: Some("Path does not exist".to_string()),
        });
    }

    // Check .git folder exists
    let git_path = path.join(".git");
    let is_git = git_path.exists() || path.join("HEAD").exists(); // bare repo

    Ok(RepoValidation {
        exists: true,
        is_git_repo: is_git,
        error: if !is_git {
            Some("Not a git repository".to_string())
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn remove_repository_data(
    repo_slug: String,
    mort_dir: String,
) -> Result<(), String> {
    // Remove ~/.mort/repositories/{repo_slug} folder
    let repo_settings_path = Path::new(&mort_dir)
        .join("repositories")
        .join(&repo_slug);

    if repo_settings_path.exists() {
        std::fs::remove_dir_all(&repo_settings_path)
            .map_err(|e| format!("Failed to remove repository data: {}", e))?;
    }

    Ok(())
}
```

### 2. Register commands in lib.rs

**File**: `src-tauri/src/lib.rs`

```rust
mod repo_commands;

// In invoke_handler:
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    repo_commands::validate_repository,
    repo_commands::remove_repository_data,
])
```

### 3. Add TypeScript bindings

**File**: `src/lib/tauri-commands.ts` or appropriate location

```typescript
import { invoke } from "@tauri-apps/api/core";

interface RepoValidation {
  exists: boolean;
  is_git_repo: boolean;
  error: string | null;
}

export async function validateRepository(sourcePath: string): Promise<RepoValidation> {
  return invoke("validate_repository", { sourcePath });
}

export async function removeRepositoryData(repoSlug: string): Promise<void> {
  const mortDir = await getMortDir(); // however you get this
  return invoke("remove_repository_data", { repoSlug, mortDir });
}
```

### 4. (Optional) Bulk worktree list command

Only implement if frontend aggregation becomes slow:

```rust
#[derive(Serialize)]
pub struct RepoWorktreeInfo {
    pub repo_name: String,
    pub repo_id: String,
    pub worktree_name: String,
    pub worktree_path: String,
    pub last_accessed_at: Option<i64>,
}

#[tauri::command]
pub async fn list_all_worktrees(mort_dir: String) -> Result<Vec<RepoWorktreeInfo>, String> {
    // Iterate ~/.mort/repositories/*/settings.json
    // Aggregate worktrees from all repos
    // Sort by lastAccessedAt descending
}
```

## Success Criteria
- [ ] `validate_repository` command returns path/git status
- [ ] `remove_repository_data` deletes settings folder
- [ ] Commands registered and callable from frontend
- [ ] TypeScript bindings available

## Files Modified
- `src-tauri/src/repo_commands.rs` (new)
- `src-tauri/src/lib.rs` (register commands)
- `src/lib/tauri-commands.ts` or similar (TypeScript bindings)
