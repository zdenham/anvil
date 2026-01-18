use crate::shell;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_bare: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub relative_date: String,
}

/// Detect the repository's default branch.
/// Mirrors the logic from agents/src/git.ts getDefaultBranch()
#[tauri::command]
pub async fn git_get_default_branch(repo_path: String) -> Result<String, String> {
    let path = Path::new(&repo_path);

    // Strategy 1: Check remote origin's HEAD
    if let Ok(output) = shell::command("git")
        .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
        .current_dir(path)
        .output()
    {
        if output.status.success() {
            let ref_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(branch) = ref_str.strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }
    }

    // Strategy 2: Check git config init.defaultBranch
    if let Ok(output) = shell::command("git")
        .args(["config", "--get", "init.defaultBranch"])
        .current_dir(path)
        .output()
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch.is_empty() {
                return Ok(branch);
            }
        }
    }

    // Strategy 3: Check common branch names
    for candidate in &["main", "master", "develop", "trunk"] {
        let result = shell::command("git")
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{}", candidate),
            ])
            .current_dir(path)
            .output();

        if let Ok(output) = result {
            if output.status.success() {
                return Ok(candidate.to_string());
            }
        }
    }

    // Strategy 4: Current branch as fallback
    if let Ok(output) = shell::command("git")
        .args(["branch", "--show-current"])
        .current_dir(path)
        .output()
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch.is_empty() {
                return Ok(branch);
            }
        }
    }

    // Strategy 5: Ultimate fallback
    Ok("main".to_string())
}

/// Get the commit hash of a branch
#[tauri::command]
pub async fn git_get_branch_commit(repo_path: String, branch: String) -> Result<String, String> {
    let output = shell::command("git")
        .args(["rev-parse", &branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to get commit for branch {}: {}",
            branch,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Create a new git branch from a base branch
#[tauri::command]
pub async fn git_create_branch(
    repo_path: String,
    branch_name: String,
    base_branch: String,
) -> Result<(), String> {
    // First check if branch already exists
    let check = shell::command("git")
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{}", branch_name),
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if check.status.success() {
        return Err(format!("Branch '{}' already exists", branch_name));
    }

    // Create the branch
    let output = shell::command("git")
        .args(["branch", &branch_name, &base_branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Checkout a branch in a worktree (with force to discard uncommitted changes)
#[tauri::command]
pub async fn git_checkout_branch(worktree_path: String, branch: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["checkout", "--force", &branch])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to checkout branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Checkout a specific commit in detached HEAD mode (with force to discard uncommitted changes)
/// This is useful when the branch is already checked out elsewhere (e.g., in the main repo)
#[tauri::command]
pub async fn git_checkout_commit(worktree_path: String, commit: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["checkout", "--force", "--detach", &commit])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to checkout commit: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Delete a git branch (force delete)
#[tauri::command]
pub async fn git_delete_branch(repo_path: String, branch: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["branch", "-D", &branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't error if branch doesn't exist
        if !stderr.contains("not found") {
            return Err(format!("Failed to delete branch: {}", stderr));
        }
    }

    Ok(())
}

/// Check if a branch exists
#[tauri::command]
pub async fn git_branch_exists(repo_path: String, branch: String) -> Result<bool, String> {
    let output = shell::command("git")
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{}", branch),
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

/// List all mort/* branches
#[tauri::command]
pub async fn git_list_mort_branches(repo_path: String) -> Result<Vec<String>, String> {
    let output = shell::command("git")
        .args(["branch", "--list", "mort/*"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().trim_start_matches("* ").to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(branches)
}

/// Create a new worktree with detached HEAD
/// The caller should checkout the appropriate branch/commit after creation
#[tauri::command]
pub async fn git_create_worktree(
    repo_path: String,
    worktree_path: String,
    _branch: String, // Kept for API compatibility but not used
) -> Result<(), String> {
    // Create worktree with detached HEAD
    // The caller will checkout the appropriate branch/commit
    let output = shell::command("git")
        .args(["worktree", "add", "--detach", &worktree_path])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create worktree: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Remove a worktree
#[tauri::command]
pub async fn git_remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    tracing::info!(repo_path = %repo_path, worktree_path = %worktree_path, "Executing git worktree remove --force");

    let output = shell::command("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| {
            tracing::error!(repo_path = %repo_path, worktree_path = %worktree_path, error = %e, "Failed to execute git worktree remove command");
            e.to_string()
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(repo_path = %repo_path, worktree_path = %worktree_path, stderr = %stderr, "Git worktree remove command failed");
        return Err(format!(
            "Failed to remove worktree: {}",
            stderr
        ));
    }

    tracing::info!(repo_path = %repo_path, worktree_path = %worktree_path, "Git worktree remove command succeeded");
    Ok(())
}

/// List all worktrees
#[tauri::command]
pub async fn git_list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let output = shell::command("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;
    let mut is_bare = false;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            // Save previous worktree if exists
            if let Some(path) = current_path.take() {
                worktrees.push(WorktreeInfo {
                    path,
                    branch: current_branch.take(),
                    is_bare,
                });
                is_bare = false;
            }
            current_path = Some(line.strip_prefix("worktree ").unwrap().to_string());
        } else if line.starts_with("branch ") {
            let branch = line
                .strip_prefix("branch refs/heads/")
                .unwrap_or(line.strip_prefix("branch ").unwrap());
            current_branch = Some(branch.to_string());
        } else if line == "bare" {
            is_bare = true;
        }
    }

    // Don't forget the last worktree
    if let Some(path) = current_path {
        worktrees.push(WorktreeInfo {
            path,
            branch: current_branch,
            is_bare,
        });
    }

    Ok(worktrees)
}

/// List all tracked files in the repository using git ls-files
/// Returns relative paths from the repository root
#[tauri::command]
pub async fn git_ls_files(repo_path: String) -> Result<Vec<String>, String> {
    let output = shell::command("git")
        .args(["ls-files"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let files: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    Ok(files)
}

/// List all untracked files in the repository using git ls-files --others --exclude-standard
/// Returns relative paths from the repository root, respecting .gitignore and git excludes
#[tauri::command]
pub async fn git_ls_files_untracked(repo_path: String) -> Result<Vec<String>, String> {
    let output = shell::command("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let files: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    Ok(files)
}

/// Get the current HEAD commit hash
#[tauri::command]
pub async fn git_get_head_commit(repo_path: String) -> Result<String, String> {
    let output = shell::command("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to get HEAD commit: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Generate a git diff for specific files from a base commit
/// Returns the raw diff output which can be parsed by the frontend
#[tauri::command]
pub async fn git_diff_files(
    repo_path: String,
    base_commit: String,
    file_paths: Vec<String>,
) -> Result<String, String> {
    if file_paths.is_empty() {
        return Ok(String::new());
    }

    // Build the git diff command:
    // git diff <base_commit> -- <file1> <file2> ...
    let mut args = vec!["diff".to_string(), base_commit.clone(), "--".to_string()];
    args.extend(file_paths);

    let output = shell::command("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git diff: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to generate diff: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Get commits for a branch, comparing against the default branch
#[tauri::command]
pub async fn git_get_branch_commits(
    working_directory: String,
    branch_name: String,
    limit: usize,
) -> Result<Vec<GitCommit>, String> {
    // Get the default branch to find the merge base
    let default_branch = git_get_default_branch(working_directory.clone()).await?;

    // Find the merge base between the branch and default branch
    let merge_base_output = shell::command("git")
        .args(["merge-base", &default_branch, &branch_name])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| format!("Failed to execute git merge-base: {}", e))?;

    // Build the git log command
    // If we found a merge base, show commits since then; otherwise show all commits on branch
    let range = if merge_base_output.status.success() {
        let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
            .trim()
            .to_string();
        format!("{}..{}", merge_base, branch_name)
    } else {
        branch_name.clone()
    };

    let output = shell::command("git")
        .args([
            "log",
            &range,
            &format!("-{}", limit),
            "--format=%H|%h|%s|%an|%ae|%aI|%ar",
        ])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| format!("Failed to execute git log: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<GitCommit> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(7, '|').collect();
            if parts.len() == 7 {
                Some(GitCommit {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    author_email: parts[4].to_string(),
                    date: parts[5].to_string(),
                    relative_date: parts[6].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}
