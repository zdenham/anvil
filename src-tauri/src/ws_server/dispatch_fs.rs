//! Filesystem command dispatch for the WebSocket server.
//!
//! Handles all `fs_*` commands plus filesystem-related commands from other modules.

use super::dispatch_helpers::extract_arg;
use super::WsState;

/// Dispatch a filesystem command, returning the JSON result.
pub async fn dispatch(
    cmd: &str,
    args: serde_json::Value,
    _state: &WsState,
) -> Result<serde_json::Value, String> {
    match cmd {
        "fs_read_file" => {
            let path: String = extract_arg(&args, "path")?;
            let result = crate::filesystem::read_file(&path)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_exists" => {
            let path: String = extract_arg(&args, "path")?;
            let result = crate::filesystem::exists(&path);
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_list_dir" => {
            let path: String = extract_arg(&args, "path")?;
            let result = crate::filesystem::list_dir(&path)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_write_file" => {
            let path: String = extract_arg(&args, "path")?;
            let contents: String = extract_arg(&args, "contents")?;
            crate::filesystem::fs_write_file(path, contents)?;
            Ok(serde_json::Value::Null)
        }
        "fs_mkdir" => {
            let path: String = extract_arg(&args, "path")?;
            crate::filesystem::fs_mkdir(path)?;
            Ok(serde_json::Value::Null)
        }
        "fs_remove" => {
            let path: String = extract_arg(&args, "path")?;
            crate::filesystem::fs_remove(path)?;
            Ok(serde_json::Value::Null)
        }
        "fs_remove_dir_all" => {
            let path: String = extract_arg(&args, "path")?;
            crate::filesystem::fs_remove_dir_all(path)?;
            Ok(serde_json::Value::Null)
        }
        "fs_move" => {
            let from: String = extract_arg(&args, "from")?;
            let to: String = extract_arg(&args, "to")?;
            crate::filesystem::fs_move(from, to)?;
            Ok(serde_json::Value::Null)
        }
        "fs_copy_file" => {
            let from: String = extract_arg(&args, "from")?;
            let to: String = extract_arg(&args, "to")?;
            crate::filesystem::fs_copy_file(from, to)?;
            Ok(serde_json::Value::Null)
        }
        "fs_copy_directory" => {
            let from: String = extract_arg(&args, "from")?;
            let to: String = extract_arg(&args, "to")?;
            crate::filesystem::fs_copy_directory(from, to)?;
            Ok(serde_json::Value::Null)
        }
        "fs_is_git_repo" => {
            let path: String = extract_arg(&args, "path")?;
            let result = crate::filesystem::fs_is_git_repo(path);
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_git_worktree_add" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            crate::filesystem::fs_git_worktree_add(repo_path, worktree_path)?;
            Ok(serde_json::Value::Null)
        }
        "fs_git_worktree_remove" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            crate::filesystem::fs_git_worktree_remove(repo_path, worktree_path)?;
            Ok(serde_json::Value::Null)
        }
        "fs_grep" => {
            let dir: String = extract_arg(&args, "dir")?;
            let pattern: String = extract_arg(&args, "pattern")?;
            let file_glob: String = extract_arg(&args, "fileGlob")?;
            let result = crate::filesystem::grep(&dir, &pattern, &file_glob)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_bulk_read" => {
            let paths: Vec<String> = serde_json::from_value(
                args.get("paths").cloned().ok_or("Missing 'paths'")?
            ).map_err(|e| format!("Invalid paths: {}", e))?;
            let result = crate::filesystem::bulk_read(&paths);
            Ok(serde_json::to_value(result).unwrap())
        }
        // Mort filesystem commands
        "fs_get_repo_dir" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let result = crate::mort_commands::fs_get_repo_dir(repo_name).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_get_repo_source_path" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let result = crate::mort_commands::fs_get_repo_source_path(repo_name).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_get_home_dir" => {
            let result = crate::mort_commands::fs_get_home_dir().await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "fs_list_dir_names" => {
            let path: String = extract_arg(&args, "path")?;
            let result = crate::mort_commands::fs_list_dir_names(path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        _ => Err(format!("unknown fs command: {}", cmd)),
    }
}
