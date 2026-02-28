use crate::git_commands;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: Option<u64>,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
    #[serde(default)]
    pub is_renamed: bool,
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

    // Build worktree path using slug for directory name
    let slug = slugify(&repo_name);
    let worktree_path = paths::repositories_dir()
        .join(&slug)
        .join(&name)
        .to_string_lossy()
        .to_string();

    // Fetch latest from origin and get remote default branch commit
    let remote_commit = match fetch_remote_commit(&source_path).await {
        Ok(commit) => {
            tracing::info!(
                repo_name = %repo_name,
                commit = %&commit[..8.min(commit.len())],
                "Using remote commit for worktree"
            );
            Some(commit)
        }
        Err(e) => {
            tracing::warn!(
                repo_name = %repo_name,
                error = %e,
                "Failed to fetch remote commit, falling back to local HEAD"
            );
            None
        }
    };

    // Create worktree - at remote commit if available, otherwise detached at HEAD
    if let Some(commit) = &remote_commit {
        git_commands::git_create_worktree_at_commit(
            source_path.clone(),
            worktree_path.clone(),
            commit.clone(),
        )
        .await?;
    } else {
        git_commands::git_create_worktree(source_path, worktree_path.clone(), String::new())
            .await?;
    }

    // Create worktree state
    let now = now_millis();
    let worktree = WorktreeState {
        id: Uuid::new_v4().to_string(),
        path: worktree_path,
        name,
        created_at: Some(now),
        last_accessed_at: Some(now),
        current_branch: None,
        is_renamed: false,
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
    tracing::info!(repo_name = %repo_name, worktree_name = %name, "Starting worktree deletion");

    let mut settings = load_settings(&repo_name)?;

    let mut worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let index = worktrees
        .iter()
        .position(|w| w.name == name)
        .ok_or_else(|| {
            tracing::error!(repo_name = %repo_name, worktree_name = %name, "Worktree not found in settings");
            format!("Worktree \"{}\" not found", name)
        })?;

    let worktree_path = worktrees[index].path.clone();
    tracing::info!(repo_name = %repo_name, worktree_name = %name, worktree_path = %worktree_path, "Found worktree to delete");

    let source_path = settings
        .get("sourcePath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            tracing::error!(repo_name = %repo_name, "Repository has no sourcePath");
            "Repository has no sourcePath".to_string()
        })?
        .to_string();

    // Call existing git primitive
    git_commands::git_remove_worktree(source_path, worktree_path.clone()).await.map_err(|e| {
        tracing::error!(repo_name = %repo_name, worktree_path = %worktree_path, error = %e, "Git worktree remove failed");
        e
    })?;

    tracing::info!(repo_name = %repo_name, worktree_path = %worktree_path, "Git worktree remove succeeded");

    // Update settings
    worktrees.remove(index);
    settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;

    Ok(())
}

/// Rename a worktree (metadata and branch name - path stays the same).
/// The worktree_id_or_name parameter can be either:
/// - A worktree UUID (for auto-rename from agent)
/// - A worktree name (for manual rename from context menu)
#[tauri::command]
pub async fn worktree_rename(
    repo_name: String,
    old_name: String, // Actually worktree_id_or_name - kept as old_name for API compatibility
    new_name: String,
) -> Result<(), String> {
    let worktree_id_or_name = old_name; // Rename for clarity

    tracing::info!(
        repo_name = %repo_name,
        worktree_id_or_name = %worktree_id_or_name,
        new_name = %new_name,
        "[worktree_rename] Starting rename operation"
    );

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

    // Find the worktree - try by ID first, then by name
    let worktree_index = worktrees
        .iter()
        .position(|w| w.id == worktree_id_or_name)
        .or_else(|| worktrees.iter().position(|w| w.name == worktree_id_or_name))
        .ok_or_else(|| {
            tracing::error!(
                worktree_id_or_name = %worktree_id_or_name,
                "[worktree_rename] Worktree not found by ID or name"
            );
            format!("Worktree \"{}\" not found", worktree_id_or_name)
        })?;

    let worktree = &worktrees[worktree_index];
    tracing::info!(
        worktree_id = %worktree.id,
        worktree_name = %worktree.name,
        "[worktree_rename] Found worktree"
    );

    // Skip if already renamed to this name
    if worktree.name == new_name {
        tracing::info!("[worktree_rename] Worktree already has this name, skipping");
        return Ok(());
    }

    // Check new name doesn't already exist (excluding current worktree)
    if worktrees
        .iter()
        .any(|w| w.name == new_name && w.id != worktrees[worktree_index].id)
    {
        return Err(format!("Worktree \"{}\" already exists", new_name));
    }

    let old_branch_name = worktrees[worktree_index].name.clone();
    let worktree_path = worktrees[worktree_index].path.clone();

    // Update metadata
    worktrees[worktree_index].name = new_name.clone();
    worktrees[worktree_index].is_renamed = true;

    settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;

    tracing::info!(
        old_name = %old_branch_name,
        new_name = %new_name,
        "[worktree_rename] Updated settings.json"
    );

    // Rename the git branch
    rename_branch(&worktree_path, &old_branch_name, &new_name)?;

    tracing::info!("[worktree_rename] Rename operation completed successfully");
    Ok(())
}

/// Rename a git branch in the worktree
fn rename_branch(worktree_path: &str, old_name: &str, new_name: &str) -> Result<(), String> {
    tracing::info!(
        worktree_path = %worktree_path,
        old_name = %old_name,
        new_name = %new_name,
        "[worktree_rename] Renaming git branch"
    );

    let output = std::process::Command::new("git")
        .args(["branch", "-m", old_name, new_name])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        // Log but don't fail - branch might already have different name or be checked out
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            stderr = %stderr,
            "[worktree_rename] Failed to rename branch (non-fatal)"
        );
    } else {
        tracing::info!("[worktree_rename] Git branch renamed successfully");
    }

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

/// Sync worktrees from git: discover existing worktrees and merge with settings.
/// - Adds worktrees that exist in git but not in settings
/// - Removes worktrees from settings that no longer exist on disk
/// - Preserves names and metadata for known worktrees
#[tauri::command]
pub async fn worktree_sync(repo_name: String) -> Result<Vec<WorktreeState>, String> {
    let mut settings = load_settings(&repo_name)?;

    let source_path = settings
        .get("sourcePath")
        .and_then(|v| v.as_str())
        .ok_or("Repository has no sourcePath")?
        .to_string();

    // Prune stale worktree entries from git (directories that no longer exist)
    git_commands::git_prune_worktrees(source_path.clone()).await?;

    // Get worktrees from git
    let git_worktrees = git_commands::git_list_worktrees(source_path.clone()).await?;

    // Get existing worktrees from settings
    let mut existing_worktrees: Vec<WorktreeState> = settings
        .get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Build a set of paths we know about
    let existing_paths: std::collections::HashSet<String> = existing_worktrees
        .iter()
        .map(|w| w.path.clone())
        .collect();

    // Build a set of paths that actually exist in git
    let git_paths: std::collections::HashSet<String> = git_worktrees
        .iter()
        .map(|w| w.path.clone())
        .collect();

    // Add worktrees that exist in git but not in settings
    let now = now_millis();
    for git_wt in &git_worktrees {
        if git_wt.is_bare {
            continue; // Skip bare repositories
        }
        if !existing_paths.contains(&git_wt.path) {
            // Generate a name from the path
            let name = std::path::Path::new(&git_wt.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("worktree-{}", existing_worktrees.len() + 1));

            // Special case: if this is the source path, name it "main"
            let final_name = if git_wt.path == source_path {
                "main".to_string()
            } else {
                name
            };

            existing_worktrees.push(WorktreeState {
                id: Uuid::new_v4().to_string(),
                path: git_wt.path.clone(),
                name: final_name,
                created_at: Some(now),
                last_accessed_at: Some(now),
                current_branch: git_wt.branch.clone(),
                is_renamed: false,
            });
        }
    }

    // Remove worktrees from settings that no longer exist on disk
    existing_worktrees.retain(|w| git_paths.contains(&w.path));

    // Update current branch for all worktrees from git
    for worktree in &mut existing_worktrees {
        if let Some(git_wt) = git_worktrees.iter().find(|g| g.path == worktree.path) {
            worktree.current_branch = git_wt.branch.clone();
        }
    }

    // Save updated settings
    settings["worktrees"] = serde_json::to_value(&existing_worktrees).map_err(|e| e.to_string())?;
    settings["lastUpdated"] = serde_json::json!(now);
    save_settings(&repo_name, &settings)?;

    // Sort by createdAt descending (most recent first)
    // Fall back to lastAccessedAt for worktrees that don't have createdAt yet
    existing_worktrees.sort_by(|a, b| {
        let a_time = a.created_at.or(a.last_accessed_at).unwrap_or(0);
        let b_time = b.created_at.or(b.last_accessed_at).unwrap_or(0);
        b_time.cmp(&a_time)
    });

    Ok(existing_worktrees)
}

// Helper functions

/// Fetch from origin and get the commit of the remote default branch.
async fn fetch_remote_commit(source_path: &str) -> Result<String, String> {
    // Fetch latest from origin
    git_commands::git_fetch(source_path.to_string(), Some("origin".to_string())).await?;

    // Get the default branch name
    let default_branch = git_commands::git_get_default_branch(source_path.to_string()).await?;

    // Get the commit of origin/<default-branch>
    let remote_ref = format!("origin/{}", default_branch);
    git_commands::git_get_branch_commit(source_path.to_string(), remote_ref).await
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Convert a repository name to a slug (lowercase, hyphens for non-alphanumeric).
/// Matches the frontend slugify() function in service.ts.
fn slugify(name: &str) -> String {
    let mut result = String::new();
    let mut last_was_hyphen = true; // Start true to trim leading hyphens

    for c in name.to_lowercase().chars() {
        if c.is_alphanumeric() {
            result.push(c);
            last_was_hyphen = false;
        } else if !last_was_hyphen {
            result.push('-');
            last_was_hyphen = true;
        }
    }

    // Trim trailing hyphens
    result.trim_end_matches('-').to_string()
}

fn load_settings(repo_name: &str) -> Result<serde_json::Value, String> {
    let slug = slugify(repo_name);
    let settings_path = paths::repositories_dir()
        .join(&slug)
        .join("settings.json");

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings for '{}' (slug: '{}'): {}", repo_name, slug, e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

fn save_settings(repo_name: &str, settings: &serde_json::Value) -> Result<(), String> {
    let slug = slugify(repo_name);
    let settings_path = paths::repositories_dir()
        .join(&slug)
        .join("settings.json");

    let content =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&settings_path, content).map_err(|e| format!("Failed to write settings: {}", e))
}
