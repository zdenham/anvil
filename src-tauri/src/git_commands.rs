use crate::shell;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

// ═══════════════════════════════════════════════════════════════════════════
// Git Grep (file content search)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub file_path: String,
    pub line_number: u32,
    pub line_content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResponse {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
}

/// Search file contents using `git grep`.
/// Returns matches with file path, line number, and line content.
/// Uses fixed-string matching (literal, not regex) for safe user input handling.
#[tauri::command]
pub async fn git_grep(
    repo_path: String,
    query: String,
    max_results: Option<u32>,
    include_patterns: Option<Vec<String>>,
    exclude_patterns: Option<Vec<String>>,
    case_sensitive: Option<bool>,
) -> Result<GrepResponse, String> {
    let max = max_results.unwrap_or(5000) as usize;
    let case_sensitive = case_sensitive.unwrap_or(false);

    let mut args = vec![
        "grep".to_string(),
        "-n".to_string(),
        "--no-color".to_string(),
        "-I".to_string(),
        "-F".to_string(),
    ];

    if !case_sensitive {
        args.push("-i".to_string());
    }

    args.push(query.clone());
    args.push("--".to_string());

    // Include patterns (positional pathspecs)
    if let Some(ref patterns) = include_patterns {
        if !patterns.is_empty() {
            for p in patterns {
                args.push(p.clone());
            }
        } else {
            args.push(".".to_string());
        }
    } else {
        args.push(".".to_string());
    }

    // Default excludes (always applied)
    let default_excludes = vec!["archive", "*.lock", "dist", "build"];
    for exc in &default_excludes {
        args.push(format!(":!{}", exc));
    }

    // User-provided excludes
    if let Some(ref patterns) = exclude_patterns {
        for p in patterns {
            args.push(format!(":!{}", p));
        }
    }

    tracing::debug!(
        repo_path = %repo_path,
        query = %query,
        arg_count = args.len(),
        "Running git grep"
    );

    let output = shell::command("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    // Exit code 1 = no matches (not an error)
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(stderr = %stderr, "git grep returned error");
        return Err(format!("git grep failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let (matches, truncated) = parse_grep_output(&stdout, max);

    tracing::debug!(
        match_count = matches.len(),
        truncated = truncated,
        "git grep complete"
    );

    Ok(GrepResponse { matches, truncated })
}

/// Parse `git grep -n` output lines in the format `<file>:<line>:<content>`.
fn parse_grep_output(stdout: &str, max: usize) -> (Vec<GrepMatch>, bool) {
    let mut matches = Vec::new();
    let mut truncated = false;

    for line in stdout.lines() {
        if matches.len() >= max {
            truncated = true;
            break;
        }

        // Format: file:line_number:content
        // Split on first two colons to handle content that contains colons
        if let Some((file, rest)) = line.split_once(':') {
            if let Some((line_num_str, content)) = rest.split_once(':') {
                if let Ok(line_number) = line_num_str.parse::<u32>() {
                    matches.push(GrepMatch {
                        file_path: file.to_string(),
                        line_number,
                        line_content: content.trim().to_string(),
                    });
                }
            }
        }
    }

    (matches, truncated)
}

// ═══════════════════════════════════════════════════════════════════════════
// Worktree and branch commands
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_bare: bool,
}

/// Fetch from a remote to update refs
#[tauri::command]
pub async fn git_fetch(repo_path: String, remote: Option<String>) -> Result<(), String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let output = shell::command("git")
        .args(["fetch", &remote])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to fetch from {}: {}",
            remote,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
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

/// Checkout a branch in a worktree.
#[tauri::command]
pub async fn git_checkout_branch(worktree_path: String, branch: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["checkout", &branch])
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

/// Checkout a specific commit in detached HEAD mode.
/// This is useful when the branch is already checked out elsewhere (e.g., in the main repo)
#[tauri::command]
pub async fn git_checkout_commit(worktree_path: String, commit: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["checkout", "--detach", &commit])
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

/// List all mort/* branches (standalone, callable from WS server).
pub async fn list_mort_branches(repo_path: &str) -> Result<Vec<String>, String> {
    let output = shell::command("git")
        .args(["branch", "--list", "mort/*"])
        .current_dir(repo_path)
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

/// List all mort/* branches
#[tauri::command]
pub async fn git_list_mort_branches(repo_path: String) -> Result<Vec<String>, String> {
    list_mort_branches(&repo_path).await
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

/// Create a new worktree at a specific commit (detached HEAD)
/// This is used to create worktrees at a remote branch commit.
pub(crate) async fn git_create_worktree_at_commit(
    repo_path: String,
    worktree_path: String,
    commit: String,
) -> Result<(), String> {
    let output = shell::command("git")
        .args(["worktree", "add", "--detach", &worktree_path, &commit])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create worktree at commit {}: {}",
            commit,
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

/// Prune stale worktree entries (worktrees whose directories no longer exist).
/// Internal helper - only used by worktree_sync in worktree_commands.rs.
pub(crate) async fn git_prune_worktrees(repo_path: String) -> Result<(), String> {
    let output = shell::command("git")
        .args(["worktree", "prune"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

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

/// Request for a single file's diff, including operation type
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffRequest {
    pub path: String,
    pub operation: String, // "create", "modify", "delete", "rename"
}

/// Generate a synthetic diff for a newly created (untracked) file.
/// Shows all lines as additions, similar to what git would show for a new file.
fn generate_new_file_diff(repo_path: &str, file_path: &str) -> Result<String, String> {
    let full_path = std::path::Path::new(repo_path).join(file_path);

    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read new file {}: {}", file_path, e))?;

    let lines: Vec<&str> = content.lines().collect();
    let line_count = lines.len().max(1); // At least 1 for empty files

    let mut diff = String::new();
    diff.push_str(&format!("diff --git a/{} b/{}\n", file_path, file_path));
    diff.push_str("new file mode 100644\n");
    diff.push_str("--- /dev/null\n");
    diff.push_str(&format!("+++ b/{}\n", file_path));
    diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));

    for line in lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }

    // Handle files that don't end with newline
    if !content.is_empty() && !content.ends_with('\n') {
        diff.push_str("\\ No newline at end of file\n");
    }

    Ok(diff)
}

/// Generate a git diff for specific files from a base commit
/// Returns the raw diff output which can be parsed by the frontend
///
/// Handles both tracked files (using git diff) and untracked/new files
/// (by generating synthetic diffs).
#[tauri::command]
pub async fn git_diff_files(
    repo_path: String,
    base_commit: String,
    file_paths: Vec<String>,
    file_requests: Option<Vec<FileDiffRequest>>,
) -> Result<String, String> {
    // Collect all paths (support both calling conventions)
    let all_paths: Vec<String> = if let Some(requests) = file_requests {
        requests.into_iter().map(|r| r.path).collect()
    } else {
        file_paths
    };

    if all_paths.is_empty() {
        return Ok(String::new());
    }

    // Ask git which files exist at the base commit
    let ls_output = shell::command("git")
        .args(&["ls-tree", "--name-only", "-r", &base_commit])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to list files at base commit: {}", e))?;

    let tracked_at_base: HashSet<String> = String::from_utf8_lossy(&ls_output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect();

    let (tracked, untracked): (Vec<_>, Vec<_>) = all_paths
        .into_iter()
        .partition(|p| tracked_at_base.contains(p));

    let mut all_diffs = Vec::new();

    // Tracked files: git diff
    if !tracked.is_empty() {
        let mut args = vec!["diff".to_string(), base_commit.clone(), "--".to_string()];
        args.extend(tracked);
        let output = shell::command("git")
            .args(&args)
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to execute git diff: {}", e))?;
        let diff_output = String::from_utf8_lossy(&output.stdout).to_string();
        if !diff_output.is_empty() {
            all_diffs.push(diff_output);
        }
    }

    // Untracked files: synthetic diff
    for path in untracked {
        match generate_new_file_diff(&repo_path, &path) {
            Ok(diff) if !diff.is_empty() => all_diffs.push(diff),
            Err(e) => tracing::warn!("Failed to generate diff for new file {}: {}", path, e),
            _ => {}
        }
    }

    Ok(all_diffs.join("\n"))
}

// ═══════════════════════════════════════════════════════════════════════════
// Worktree-level git commands (Phase 1 of worktree diff viewer)
// ═══════════════════════════════════════════════════════════════════════════

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

/// Get branch commits for the commit list.
/// Returns structured GitCommit objects matching the frontend's GitCommitSchema.
/// Uses --first-parent to show only the "spine" of the branch (excludes merged branch commits).
#[tauri::command]
pub async fn git_get_branch_commits(
    working_directory: String,
    branch_name: String,
    limit: Option<u32>,
) -> Result<Vec<GitCommit>, String> {
    let limit = limit.unwrap_or(50);
    // Use null byte as field separator — won't appear in commit messages
    let format = "%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%ar";
    let output = shell::command("git")
        .args([
            "log",
            "--first-parent",
            &format!("--format={}", format),
            &branch_name,
            "-n",
            &limit.to_string(),
        ])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to get commits for branch {}: {}",
            branch_name,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<GitCommit> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| parse_commit_line(line))
        .collect();

    Ok(commits)
}

/// Parse a single null-byte-delimited commit line into a GitCommit struct.
fn parse_commit_line(line: &str) -> Option<GitCommit> {
    let parts: Vec<&str> = line.split('\0').collect();
    if parts.len() < 7 {
        tracing::warn!("Malformed commit line (expected 7 fields, got {})", parts.len());
        return None;
    }
    Some(GitCommit {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        message: parts[2].to_string(),
        author: parts[3].to_string(),
        author_email: parts[4].to_string(),
        date: parts[5].to_string(),
        relative_date: parts[6].to_string(),
    })
}

/// Get the diff introduced by a single commit.
/// Returns raw unified diff string for parseDiff().
/// Binary files are excluded via post-processing.
#[tauri::command]
pub async fn git_diff_commit(
    working_directory: String,
    commit_hash: String,
) -> Result<String, String> {
    // Try normal diff first (commit^ to commit)
    let output = shell::command("git")
        .args([
            "diff",
            "--no-color",
            "--no-ext-diff",
            &format!("{}^..{}", commit_hash, commit_hash),
        ])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let diff = String::from_utf8_lossy(&output.stdout).to_string();
        return Ok(filter_binary_diffs(&diff));
    }

    // Fallback for root commits (no parent) — use git show
    let output = shell::command("git")
        .args([
            "show",
            "--format=",
            "--no-color",
            "--no-ext-diff",
            &commit_hash,
        ])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to get diff for commit {}: {}",
            commit_hash,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let diff = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(filter_binary_diffs(&diff))
}

/// Get the diff between a base commit and the current working tree.
/// Includes staged, unstaged, and untracked file changes.
/// Binary files are excluded.
#[tauri::command]
pub async fn git_diff_range(
    working_directory: String,
    base_commit: String,
) -> Result<String, String> {
    let mut all_diffs = Vec::new();

    // Get tracked file diffs (base commit to working tree)
    let diff = get_tracked_diff(&working_directory, &[&base_commit, "--no-color", "--no-ext-diff"])?;
    if !diff.is_empty() {
        all_diffs.push(filter_binary_diffs(&diff));
    }

    // Append synthetic diffs for untracked files
    append_untracked_diffs(&working_directory, &mut all_diffs)?;

    Ok(all_diffs.join("\n"))
}

/// Get the diff of uncommitted changes (standalone, callable from WS server).
pub async fn diff_uncommitted(working_directory: &str) -> Result<String, String> {
    let mut all_diffs = Vec::new();

    // Get tracked file diffs (HEAD to working tree)
    let diff = get_tracked_diff(working_directory, &["HEAD", "--no-color", "--no-ext-diff"])?;
    if !diff.is_empty() {
        all_diffs.push(filter_binary_diffs(&diff));
    }

    // Append synthetic diffs for untracked files
    append_untracked_diffs(working_directory, &mut all_diffs)?;

    Ok(all_diffs.join("\n"))
}

/// Get the diff of uncommitted changes (HEAD to working tree).
/// Includes staged, unstaged, and untracked file changes.
/// Binary files are excluded.
#[tauri::command]
pub async fn git_diff_uncommitted(
    working_directory: String,
) -> Result<String, String> {
    diff_uncommitted(&working_directory).await
}

/// Find the merge base between two branches.
/// Returns the commit hash of the common ancestor.
#[tauri::command]
pub async fn git_get_merge_base(
    working_directory: String,
    branch_a: String,
    branch_b: String,
) -> Result<String, String> {
    let output = shell::command("git")
        .args(["merge-base", &branch_a, &branch_b])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to find merge base between {} and {}: {}",
            branch_a,
            branch_b,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get the commit hash that a remote branch points to.
/// Used for GitHub-style fallback when on the default branch.
#[tauri::command]
pub async fn git_get_remote_branch_commit(
    working_directory: String,
    remote: String,
    branch: String,
) -> Result<String, String> {
    let ref_name = format!("{}/{}", remote, branch);
    let output = shell::command("git")
        .args(["rev-parse", &ref_name])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to resolve {}: {}",
            ref_name,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get a file's contents at a specific git ref.
/// Used for viewing historical file versions in commit diffs.
///
/// Note: The frontend sends `ref` as the parameter name, but `ref` is a Rust
/// reserved keyword. We use `git_ref` here and the frontend wrapper sends `gitRef`
/// (Tauri auto-converts camelCase to snake_case → `git_ref`).
/// The existing direct caller in use-file-contents.ts must be updated to use
/// the wrapper or send `gitRef` instead of `ref`.
#[tauri::command]
pub async fn git_show_file(
    cwd: String,
    path: String,
    git_ref: String,
) -> Result<String, String> {
    let rev_path = format!("{}:{}", git_ref, path);
    let output = shell::command("git")
        .args(["show", &rev_path])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to show file {} at ref {}: {}",
            path,
            git_ref,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
// Git file management commands
// ═══════════════════════════════════════════════════════════════════════════

/// Remove a file from git tracking and delete it from the working tree.
/// Uses `git rm --force` to handle both tracked and staged files.
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

// ═══════════════════════════════════════════════════════════════════════════
// Private helpers for diff commands
// ═══════════════════════════════════════════════════════════════════════════

/// Run `git diff` with the given extra args and return the stdout string.
fn get_tracked_diff(working_directory: &str, extra_args: &[&str]) -> Result<String, String> {
    let mut args = vec!["diff"];
    args.extend(extra_args);

    let output = shell::command("git")
        .args(&args)
        .current_dir(working_directory)
        .output()
        .map_err(|e| format!("Failed to execute git diff: {}", e))?;

    // git diff exits 0 on success (even if empty), 1 only on error
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// List untracked files and generate synthetic diffs for each, appending to `diffs`.
fn append_untracked_diffs(working_directory: &str, diffs: &mut Vec<String>) -> Result<(), String> {
    let output = shell::command("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(working_directory)
        .output()
        .map_err(|e| format!("Failed to list untracked files: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to list untracked files: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let untracked_files: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    for file_path in untracked_files {
        // Skip binary files by checking if the file is valid UTF-8
        let full_path = std::path::Path::new(working_directory).join(&file_path);
        if std::fs::read_to_string(&full_path).is_err() {
            tracing::debug!("Skipping binary untracked file: {}", file_path);
            continue;
        }
        match generate_new_file_diff(working_directory, &file_path) {
            Ok(diff) if !diff.is_empty() => diffs.push(diff),
            Err(e) => tracing::warn!("Failed to generate diff for untracked file {}: {}", file_path, e),
            _ => {}
        }
    }

    Ok(())
}

/// Filter out binary file diffs from a unified diff string.
/// Binary diffs show as "Binary files ... differ" or have no actual hunks.
fn filter_binary_diffs(diff: &str) -> String {
    let mut result = String::new();
    let mut current_file_diff = String::new();
    let mut is_binary = false;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            // Flush the previous file diff if it's not binary
            if !current_file_diff.is_empty() && !is_binary {
                result.push_str(&current_file_diff);
            }
            current_file_diff = String::new();
            is_binary = false;
            current_file_diff.push_str(line);
            current_file_diff.push('\n');
        } else if line.starts_with("Binary files ") || line.contains("GIT binary patch") {
            is_binary = true;
        } else {
            current_file_diff.push_str(line);
            current_file_diff.push('\n');
        }
    }

    // Flush the last file diff
    if !current_file_diff.is_empty() && !is_binary {
        result.push_str(&current_file_diff);
    }

    result
}

