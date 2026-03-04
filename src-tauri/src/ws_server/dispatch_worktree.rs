//! Worktree command dispatch for the WebSocket server.
//!
//! Handles all `worktree_*` commands.

use super::dispatch_helpers::extract_arg;

/// Dispatch a worktree command, returning the JSON result.
pub async fn dispatch(
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match cmd {
        "worktree_create" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let name: String = extract_arg(&args, "name")?;
            let result = crate::worktree_commands::worktree_create(repo_name, name).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "worktree_delete" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let name: String = extract_arg(&args, "name")?;
            crate::worktree_commands::worktree_delete(repo_name, name).await?;
            Ok(serde_json::Value::Null)
        }
        "worktree_rename" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let old_name: String = extract_arg(&args, "oldName")?;
            let new_name: String = extract_arg(&args, "newName")?;
            crate::worktree_commands::worktree_rename(repo_name, old_name, new_name)
                .await?;
            Ok(serde_json::Value::Null)
        }
        "worktree_touch" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            crate::worktree_commands::worktree_touch(repo_name, worktree_path).await?;
            Ok(serde_json::Value::Null)
        }
        "worktree_sync" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let result = crate::worktree_commands::worktree_sync(repo_name).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        _ => Err(format!("unknown worktree command: {}", cmd)),
    }
}
