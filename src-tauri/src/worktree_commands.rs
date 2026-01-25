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
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
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

    // Call existing git primitive
    git_commands::git_create_worktree(source_path, worktree_path.clone(), String::new()).await?;

    // Create worktree state
    let worktree = WorktreeState {
        id: Uuid::new_v4().to_string(),
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
    tracing::info!(repo_name = %repo_name, worktree_name = %name, "Starting worktree deletion");

    let mut settings = load_settings(&repo_name)?;
    tracing::debug!(repo_name = %repo_name, "Loaded settings for worktree deletion");

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

    tracing::info!(repo_name = %repo_name, source_path = %source_path, worktree_path = %worktree_path, "Calling git worktree remove");

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

    tracing::info!(repo_name = %repo_name, worktree_name = %name, "Worktree deletion completed successfully");

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
                last_accessed_at: Some(0), // Not accessed through our tool yet
                current_branch: git_wt.branch.clone(),
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

    // Sort by lastAccessedAt (most recent first) before returning
    existing_worktrees.sort_by(|a, b| {
        b.last_accessed_at
            .unwrap_or(0)
            .cmp(&a.last_accessed_at.unwrap_or(0))
    });

    Ok(existing_worktrees)
}

// Helper functions

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
