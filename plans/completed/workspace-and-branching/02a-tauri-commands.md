# 02a - Tauri Commands (Git & Filesystem)

**Tier:** 1.5 (Depends on 02-git-utilities concepts)
**Parallelizable with:** 01-types, 00a-task-entity
**Blocking:** 03-workspace-service, 05-agent-service

---

## Rationale

Multiple plans reference Tauri commands that bridge the frontend TypeScript code with backend Rust/Node operations. This plan consolidates all git and filesystem-related Tauri commands in one place.

---

## Contracts

### Exports (Other Plans Depend On)

All commands are exposed via Tauri's `invoke()` API:

```typescript
// Git operations - used by: 03-workspace-service
invoke("get_default_branch", { repoPath: string }): Promise<string>
invoke("get_branch_commit", { repoPath: string, branch: string }): Promise<string>
invoke("create_git_branch", { repoPath: string, branchName: string, baseBranch: string }): Promise<void>
invoke("checkout_branch", { worktreePath: string, branch: string }): Promise<void>
invoke("delete_git_branch", { repoPath: string, branch: string }): Promise<void>
invoke("branch_exists", { repoPath: string, branch: string }): Promise<boolean>
invoke("list_anvil_branches", { repoPath: string }): Promise<string[]>

// Worktree operations - used by: 03-workspace-service
invoke("create_worktree", { repoPath: string, worktreePath: string, branch: string }): Promise<void>
invoke("remove_worktree", { repoPath: string, worktreePath: string }): Promise<void>
invoke("list_worktrees", { repoPath: string }): Promise<WorktreeInfo[]>

// Filesystem operations - used by: 03-workspace-service
invoke("path_exists", { path: string }): Promise<boolean>
invoke("read_file", { path: string }): Promise<string>
invoke("write_file", { path: string, content: string }): Promise<void>
invoke("get_repo_dir", { repoName: string }): Promise<string>
invoke("get_repo_source_path", { repoName: string }): Promise<string>

// Process operations - used by: 05-agent-service
invoke("spawn_agent_process", { args: string[], conversationId: string }): Promise<void>
invoke("terminate_agent_process", { conversationId: string }): Promise<void>
invoke("get_runner_path"): Promise<string>

// Conversation operations - used by: 03-workspace-service
invoke("get_conversation_status", { conversationId: string }): Promise<ConversationStatus | null>
```

### Imports (This Plan Depends On)

- Concepts from 02-git-utilities (default branch detection algorithm)

---

## Implementation

### File: `src-tauri/src/git_commands.rs`

```rust
use std::process::Command;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_bare: bool,
}

/// Detect the repository's default branch.
/// Mirrors the logic from agents/src/git.ts getDefaultBranch()
#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> Result<String, String> {
    let path = Path::new(&repo_path);

    // Strategy 1: Check remote origin's HEAD
    if let Ok(output) = Command::new("git")
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
    if let Ok(output) = Command::new("git")
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
        let result = Command::new("git")
            .args(["show-ref", "--verify", "--quiet", &format!("refs/heads/{}", candidate)])
            .current_dir(path)
            .output();

        if let Ok(output) = result {
            if output.status.success() {
                return Ok(candidate.to_string());
            }
        }
    }

    // Strategy 4: Current branch as fallback
    if let Ok(output) = Command::new("git")
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
pub async fn get_branch_commit(repo_path: String, branch: String) -> Result<String, String> {
    let output = Command::new("git")
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
pub async fn create_git_branch(
    repo_path: String,
    branch_name: String,
    base_branch: String,
) -> Result<(), String> {
    // First check if branch already exists
    let check = Command::new("git")
        .args(["show-ref", "--verify", "--quiet", &format!("refs/heads/{}", branch_name)])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if check.status.success() {
        return Err(format!("Branch '{}' already exists", branch_name));
    }

    // Create the branch
    let output = Command::new("git")
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
pub async fn checkout_branch(worktree_path: String, branch: String) -> Result<(), String> {
    let output = Command::new("git")
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

/// Delete a git branch (force delete)
#[tauri::command]
pub async fn delete_git_branch(repo_path: String, branch: String) -> Result<(), String> {
    let output = Command::new("git")
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
pub async fn branch_exists(repo_path: String, branch: String) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["show-ref", "--verify", "--quiet", &format!("refs/heads/{}", branch)])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

/// List all anvil/* branches
#[tauri::command]
pub async fn list_anvil_branches(repo_path: String) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(["branch", "--list", "anvil/*"])
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

/// Create a new worktree
#[tauri::command]
pub async fn create_worktree(
    repo_path: String,
    worktree_path: String,
    branch: String,
) -> Result<(), String> {
    // Create worktree with detached HEAD first, then checkout branch
    // This avoids issues with branch already being checked out elsewhere
    let output = Command::new("git")
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

    // Now checkout the branch in the worktree
    checkout_branch(worktree_path, branch).await?;

    Ok(())
}

/// Remove a worktree
#[tauri::command]
pub async fn remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to remove worktree: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// List all worktrees
#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let output = Command::new("git")
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
            let branch = line.strip_prefix("branch refs/heads/").unwrap_or(
                line.strip_prefix("branch ").unwrap()
            );
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
```

### File: `src-tauri/src/filesystem_commands.rs`

```rust
use std::fs;
use std::path::PathBuf;

/// Check if a path exists
#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

/// Read a file's contents
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Write content to a file (creates parent directories if needed)
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

/// Get the anvil repository directory for a repo
#[tauri::command]
pub async fn get_repo_dir(repo_name: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let repo_dir = home.join(".anvil").join("repositories").join(&repo_name);
    Ok(repo_dir.to_string_lossy().to_string())
}

/// Get the source path for a repository (where the actual git repo is)
#[tauri::command]
pub async fn get_repo_source_path(repo_name: String) -> Result<String, String> {
    let repo_dir = get_repo_dir(repo_name).await?;
    let settings_path = PathBuf::from(&repo_dir).join("settings.json");

    // Try to read from settings.json
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        let settings: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(source_path) = settings.get("sourcePath").and_then(|v| v.as_str()) {
            return Ok(source_path.to_string());
        }
    }

    // Fallback to metadata.json for migration
    let metadata_path = PathBuf::from(&repo_dir).join("metadata.json");
    if metadata_path.exists() {
        let content = fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
        let metadata: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(source_path) = metadata.get("sourcePath").and_then(|v| v.as_str()) {
            return Ok(source_path.to_string());
        }
    }

    Err(format!("Repository '{}' not found", repo_name))
}
```

### File: `src-tauri/src/process_commands.rs`

```rust
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

pub struct ProcessManager {
    processes: Mutex<HashMap<String, Child>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        ProcessManager {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

/// Get the path to the runner script
#[tauri::command]
pub async fn get_runner_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    // In development, use the local path
    // In production, use the bundled path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("agents")
        .join("dist")
        .join("runner.js");

    if resource_path.exists() {
        return Ok(resource_path.to_string_lossy().to_string());
    }

    // Fallback for development
    let dev_path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("agents")
        .join("dist")
        .join("runner.js");

    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err("Runner script not found".to_string())
}

/// Spawn an agent process
#[tauri::command]
pub async fn spawn_agent_process(
    args: Vec<String>,
    conversation_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    let child = Command::new("node")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;

    let mut processes = process_manager.processes.lock().map_err(|e| e.to_string())?;
    processes.insert(conversation_id, child);

    Ok(())
}

/// Terminate an agent process
#[tauri::command]
pub async fn terminate_agent_process(
    conversation_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    let mut processes = process_manager.processes.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = processes.remove(&conversation_id) {
        child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
    }

    Ok(())
}

/// Check if a process is still running
#[tauri::command]
pub async fn is_process_running(
    conversation_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<bool, String> {
    let mut processes = process_manager.processes.lock().map_err(|e| e.to_string())?;

    if let Some(child) = processes.get_mut(&conversation_id) {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, remove from map
                processes.remove(&conversation_id);
                Ok(false)
            }
            Ok(None) => Ok(true),  // Still running
            Err(e) => Err(e.to_string()),
        }
    } else {
        Ok(false)
    }
}
```

### File: `src-tauri/src/conversation_commands.rs`

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ConversationStatus {
    Running,
    Completed,
    Error,
    Paused,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMetadata {
    pub id: String,
    pub task_id: String,
    pub status: ConversationStatus,
    // ... other fields as needed
}

fn get_conversations_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join(".anvil").join("conversations"))
}

/// Get the status of a conversation
#[tauri::command]
pub async fn get_conversation_status(
    conversation_id: String,
) -> Result<Option<ConversationStatus>, String> {
    let conversations_dir = get_conversations_dir()?;
    let conv_path = conversations_dir.join(&conversation_id).join("metadata.json");

    if !conv_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&conv_path).map_err(|e| e.to_string())?;
    let metadata: ConversationMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(metadata.status))
}

/// Get full conversation metadata
#[tauri::command]
pub async fn get_conversation(
    conversation_id: String,
) -> Result<Option<ConversationMetadata>, String> {
    let conversations_dir = get_conversations_dir()?;
    let conv_path = conversations_dir.join(&conversation_id).join("metadata.json");

    if !conv_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&conv_path).map_err(|e| e.to_string())?;
    let metadata: ConversationMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(Some(metadata))
}
```

---

## Register All Commands

### File: `src-tauri/src/main.rs`

```rust
mod git_commands;
mod filesystem_commands;
mod process_commands;
mod conversation_commands;
mod tasks;

use process_commands::ProcessManager;

fn main() {
    tauri::Builder::default()
        .manage(ProcessManager::new())
        .invoke_handler(tauri::generate_handler![
            // Git commands
            git_commands::get_default_branch,
            git_commands::get_branch_commit,
            git_commands::create_git_branch,
            git_commands::checkout_branch,
            git_commands::delete_git_branch,
            git_commands::branch_exists,
            git_commands::list_anvil_branches,
            git_commands::create_worktree,
            git_commands::remove_worktree,
            git_commands::list_worktrees,

            // Filesystem commands
            filesystem_commands::path_exists,
            filesystem_commands::read_file,
            filesystem_commands::write_file,
            filesystem_commands::get_repo_dir,
            filesystem_commands::get_repo_source_path,

            // Process commands
            process_commands::get_runner_path,
            process_commands::spawn_agent_process,
            process_commands::terminate_agent_process,
            process_commands::is_process_running,

            // Conversation commands
            conversation_commands::get_conversation_status,
            conversation_commands::get_conversation,

            // Task commands (from 00a-task-entity)
            tasks::save_task,
            tasks::get_task,
            tasks::get_subtasks,
            tasks::update_task_status,
            tasks::delete_task,
            tasks::list_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## TypeScript Type Definitions

### File: `src/lib/tauri-commands.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

// Re-export invoke with proper typing for convenience
export { invoke };

// Type definitions for Tauri command responses
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isBare: boolean;
}

export type ConversationStatus = "running" | "completed" | "error" | "paused";

export interface ConversationMetadata {
  id: string;
  taskId: string;
  status: ConversationStatus;
}

// Typed wrappers (optional, for better DX)
export const gitCommands = {
  getDefaultBranch: (repoPath: string) =>
    invoke<string>("get_default_branch", { repoPath }),

  getBranchCommit: (repoPath: string, branch: string) =>
    invoke<string>("get_branch_commit", { repoPath, branch }),

  createGitBranch: (repoPath: string, branchName: string, baseBranch: string) =>
    invoke<void>("create_git_branch", { repoPath, branchName, baseBranch }),

  checkoutBranch: (worktreePath: string, branch: string) =>
    invoke<void>("checkout_branch", { worktreePath, branch }),

  deleteGitBranch: (repoPath: string, branch: string) =>
    invoke<void>("delete_git_branch", { repoPath, branch }),

  branchExists: (repoPath: string, branch: string) =>
    invoke<boolean>("branch_exists", { repoPath, branch }),

  listAnvilBranches: (repoPath: string) =>
    invoke<string[]>("list_anvil_branches", { repoPath }),

  createWorktree: (repoPath: string, worktreePath: string, branch: string) =>
    invoke<void>("create_worktree", { repoPath, worktreePath, branch }),

  removeWorktree: (repoPath: string, worktreePath: string) =>
    invoke<void>("remove_worktree", { repoPath, worktreePath }),

  listWorktrees: (repoPath: string) =>
    invoke<WorktreeInfo[]>("list_worktrees", { repoPath }),
};

export const fsCommands = {
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),

  readFile: (path: string) => invoke<string>("read_file", { path }),

  writeFile: (path: string, content: string) =>
    invoke<void>("write_file", { path, content }),

  getRepoDir: (repoName: string) => invoke<string>("get_repo_dir", { repoName }),

  getRepoSourcePath: (repoName: string) =>
    invoke<string>("get_repo_source_path", { repoName }),
};

export const processCommands = {
  getRunnerPath: () => invoke<string>("get_runner_path"),

  spawnAgentProcess: (args: string[], conversationId: string) =>
    invoke<void>("spawn_agent_process", { args, conversationId }),

  terminateAgentProcess: (conversationId: string) =>
    invoke<void>("terminate_agent_process", { conversationId }),

  isProcessRunning: (conversationId: string) =>
    invoke<boolean>("is_process_running", { conversationId }),
};

export const conversationCommands = {
  getConversationStatus: (conversationId: string) =>
    invoke<ConversationStatus | null>("get_conversation_status", { conversationId }),

  getConversation: (conversationId: string) =>
    invoke<ConversationMetadata | null>("get_conversation", { conversationId }),
};
```

---

## Verification

- [ ] All git commands implemented in `git_commands.rs`
- [ ] All filesystem commands implemented in `filesystem_commands.rs`
- [ ] Process manager with spawn/terminate implemented
- [ ] Conversation status lookup implemented
- [ ] All commands registered in `main.rs`
- [ ] TypeScript types exported for frontend use
- [ ] Branch collision detection works (create fails if exists)
- [ ] Worktree creation handles detached HEAD properly
