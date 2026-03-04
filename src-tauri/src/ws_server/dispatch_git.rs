//! Git command dispatch for the WebSocket server.
//!
//! Handles all `git_*` commands.

use super::dispatch_helpers::{extract_arg, extract_opt_arg};

/// Dispatch a git command, returning the JSON result.
pub async fn dispatch(
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match cmd {
        "git_list_mort_branches" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let result = crate::git_commands::list_mort_branches(&repo_path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_diff_uncommitted" => {
            let working_directory: String = extract_arg(&args, "workingDirectory")?;
            let result = crate::git_commands::diff_uncommitted(&working_directory).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_fetch" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let remote: Option<String> = extract_opt_arg(&args, "remote");
            crate::git_commands::git_fetch(repo_path, remote).await?;
            Ok(serde_json::Value::Null)
        }
        "git_get_default_branch" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let result = crate::git_commands::git_get_default_branch(repo_path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_get_branch_commit" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let branch: String = extract_arg(&args, "branch")?;
            let result =
                crate::git_commands::git_get_branch_commit(repo_path, branch).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_create_branch" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let branch_name: String = extract_arg(&args, "branchName")?;
            let base_branch: String = extract_arg(&args, "baseBranch")?;
            crate::git_commands::git_create_branch(repo_path, branch_name, base_branch)
                .await?;
            Ok(serde_json::Value::Null)
        }
        "git_checkout_branch" => {
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            let branch: String = extract_arg(&args, "branch")?;
            crate::git_commands::git_checkout_branch(worktree_path, branch).await?;
            Ok(serde_json::Value::Null)
        }
        "git_checkout_commit" => {
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            let commit: String = extract_arg(&args, "commit")?;
            crate::git_commands::git_checkout_commit(worktree_path, commit).await?;
            Ok(serde_json::Value::Null)
        }
        "git_delete_branch" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let branch: String = extract_arg(&args, "branch")?;
            crate::git_commands::git_delete_branch(repo_path, branch).await?;
            Ok(serde_json::Value::Null)
        }
        "git_branch_exists" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let branch: String = extract_arg(&args, "branch")?;
            let result =
                crate::git_commands::git_branch_exists(repo_path, branch).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        _ => dispatch_part2(cmd, args).await,
    }
}

/// Second half of git dispatch (split to keep functions under 50 lines).
async fn dispatch_part2(
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match cmd {
        "git_create_worktree" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            let branch: String = extract_arg(&args, "branch")?;
            crate::git_commands::git_create_worktree(repo_path, worktree_path, branch)
                .await?;
            Ok(serde_json::Value::Null)
        }
        "git_remove_worktree" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let worktree_path: String = extract_arg(&args, "worktreePath")?;
            crate::git_commands::git_remove_worktree(repo_path, worktree_path).await?;
            Ok(serde_json::Value::Null)
        }
        "git_list_worktrees" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let result = crate::git_commands::git_list_worktrees(repo_path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_ls_files" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let result = crate::git_commands::git_ls_files(repo_path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_ls_files_untracked" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let result = crate::git_commands::git_ls_files_untracked(repo_path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_get_head_commit" => {
            let repo_path: String = extract_arg(&args, "repoPath")?;
            let result = crate::git_commands::git_get_head_commit(repo_path).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_diff_files" => dispatch_diff_files(args).await,
        "git_get_branch_commits" => dispatch_branch_commits(args).await,
        "git_diff_commit" => dispatch_diff_commit(args).await,
        "git_diff_range" => dispatch_diff_range(args).await,
        _ => dispatch_part3(cmd, args).await,
    }
}

async fn dispatch_diff_files(
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let repo_path: String = extract_arg(&args, "repoPath")?;
    let base_commit: String = extract_arg(&args, "baseCommit")?;
    let file_paths: Vec<String> = extract_opt_arg(&args, "filePaths").unwrap_or_default();
    let file_requests: Option<Vec<crate::git_commands::FileDiffRequest>> =
        extract_opt_arg(&args, "fileRequests");
    let result = crate::git_commands::git_diff_files(
        repo_path,
        base_commit,
        file_paths,
        file_requests,
    )
    .await?;
    Ok(serde_json::to_value(result).unwrap())
}

async fn dispatch_branch_commits(
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let working_directory: String = extract_arg(&args, "workingDirectory")?;
    let branch_name: String = extract_arg(&args, "branchName")?;
    let limit: Option<u32> = extract_opt_arg(&args, "limit");
    let result = crate::git_commands::git_get_branch_commits(
        working_directory,
        branch_name,
        limit,
    )
    .await?;
    Ok(serde_json::to_value(result).unwrap())
}

async fn dispatch_diff_commit(
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let working_directory: String = extract_arg(&args, "workingDirectory")?;
    let commit_hash: String = extract_arg(&args, "commitHash")?;
    let result =
        crate::git_commands::git_diff_commit(working_directory, commit_hash).await?;
    Ok(serde_json::to_value(result).unwrap())
}

async fn dispatch_diff_range(
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let working_directory: String = extract_arg(&args, "workingDirectory")?;
    let base_commit: String = extract_arg(&args, "baseCommit")?;
    let result =
        crate::git_commands::git_diff_range(working_directory, base_commit).await?;
    Ok(serde_json::to_value(result).unwrap())
}

/// Third part of git dispatch for remaining commands.
async fn dispatch_part3(
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match cmd {
        "git_get_merge_base" => {
            let working_directory: String = extract_arg(&args, "workingDirectory")?;
            let branch_a: String = extract_arg(&args, "branchA")?;
            let branch_b: String = extract_arg(&args, "branchB")?;
            let result = crate::git_commands::git_get_merge_base(
                working_directory,
                branch_a,
                branch_b,
            )
            .await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_get_remote_branch_commit" => {
            let working_directory: String = extract_arg(&args, "workingDirectory")?;
            let remote: String = extract_arg(&args, "remote")?;
            let branch: String = extract_arg(&args, "branch")?;
            let result = crate::git_commands::git_get_remote_branch_commit(
                working_directory,
                remote,
                branch,
            )
            .await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_show_file" => {
            let cwd: String = extract_arg(&args, "cwd")?;
            let path: String = extract_arg(&args, "path")?;
            let git_ref: String = extract_arg(&args, "gitRef")?;
            let result =
                crate::git_commands::git_show_file(cwd, path, git_ref).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "git_grep" => dispatch_grep(args).await,
        "git_rm" => {
            let working_directory: String = extract_arg(&args, "workingDirectory")?;
            let file_path: String = extract_arg(&args, "filePath")?;
            crate::git_commands::git_rm(working_directory, file_path).await?;
            Ok(serde_json::Value::Null)
        }
        _ => Err(format!("unknown git command: {}", cmd)),
    }
}

async fn dispatch_grep(
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let repo_path: String = extract_arg(&args, "repoPath")?;
    let query: String = extract_arg(&args, "query")?;
    let max_results: Option<u32> = extract_opt_arg(&args, "maxResults");
    let include_patterns: Option<Vec<String>> =
        extract_opt_arg(&args, "includePatterns");
    let exclude_patterns: Option<Vec<String>> =
        extract_opt_arg(&args, "excludePatterns");
    let case_sensitive: Option<bool> = extract_opt_arg(&args, "caseSensitive");
    let result = crate::git_commands::git_grep(
        repo_path,
        query,
        max_results,
        include_patterns,
        exclude_patterns,
        case_sensitive,
    )
    .await?;
    Ok(serde_json::to_value(result).unwrap())
}
