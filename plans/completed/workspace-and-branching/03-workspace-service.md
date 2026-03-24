# 03 - Workspace Service

**Tier:** 2
**Depends on:** 01-types, 02a-tauri-commands
**Parallelizable with:** 04-runner-updates
**Blocking:** 05-agent-service, 07-maintenance

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Used by: 05-agent-service
export interface WorkspaceAllocation {
  worktree: WorktreeState;
  branch: string;
  mergeBase: string;
}

// Used by: 05-agent-service, 06-ui-integration
export interface WorkspaceService {
  // Task lifecycle
  initializeTaskBranch(
    repoName: string,
    taskId: string,
    parentTaskId?: string
  ): Promise<TaskBranchInfo>;

  getTaskBranchInfo(repoName: string, taskId: string): Promise<TaskBranchInfo | null>;

  // Conversation lifecycle
  allocateWorkspace(
    repoName: string,
    taskId: string,
    conversationId: string
  ): Promise<WorkspaceAllocation>;

  releaseWorkspace(repoName: string, conversationId: string): Promise<void>;

  // Maintenance
  releaseStaleWorkspaces(repoName: string): Promise<number>;
  syncWithDisk(repoName: string): Promise<void>;

  // Cleanup (after PR merge)
  deleteTaskBranch(repoName: string, taskId: string): Promise<void>;
}

// Used by: 05-agent-service, 06-ui-integration
export function createWorkspaceService(): WorkspaceService;
```

### Imports (This Plan Depends On)

```typescript
// From 01-types
import type {
  TaskBranchInfo,
  WorktreeClaim,
  WorktreeState,
  RepositorySettings,
} from "@/entities/repositories/types";

// From 02a-tauri-commands (via invoke)
import {
  gitCommands,
  fsCommands,
  conversationCommands,
} from "@/lib/tauri-commands";
```

---

## Concurrency & Locking Strategy

### Problem

Multiple concurrent operations (e.g., two tasks starting simultaneously) could race on:
1. Reading/writing `settings.json`
2. Claiming the same worktree
3. Creating branches with the same name

### Solution: File-Based Locking

Use a lock file per repository to serialize workspace operations:

```typescript
// Lock file: ~/.anvil/repositories/{repo-name}/.lock
// Acquired before any settings read/write
// Released after operation completes

import { invoke } from "@tauri-apps/api/core";

async function withRepoLock<T>(
  repoName: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = await invoke<string>("acquire_repo_lock", { repoName });
  try {
    return await operation();
  } finally {
    await invoke("release_repo_lock", { lockPath });
  }
}
```

### Rust Lock Implementation

Add to `src-tauri/src/filesystem_commands.rs`:

```rust
use std::fs::{File, OpenOptions};
use std::io::Error;
use fs2::FileExt;  // Add fs2 crate for cross-platform file locking

#[tauri::command]
pub async fn acquire_repo_lock(repo_name: String) -> Result<String, String> {
    let repo_dir = get_repo_dir(repo_name).await?;
    let lock_path = format!("{}/.lock", repo_dir);

    // Create lock file if it doesn't exist
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(&lock_path)
        .map_err(|e| format!("Failed to open lock file: {}", e))?;

    // Acquire exclusive lock (blocks until available)
    file.lock_exclusive()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    // Store file handle to keep lock (will be released when file is dropped)
    // In practice, we'd store this in a managed state HashMap<String, File>
    Ok(lock_path)
}

#[tauri::command]
pub async fn release_repo_lock(lock_path: String) -> Result<(), String> {
    // The lock is released when the file handle is dropped
    // This command signals intent; actual release happens via state management
    Ok(())
}
```

**Note:** For production, use Tauri's managed state to hold lock file handles keyed by lock path.

---

## Implementation

### File: `src/lib/workspace-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";
import type {
  TaskBranchInfo,
  WorktreeClaim,
  WorktreeState,
  RepositorySettings,
} from "@/entities/repositories/types";
import { loadSettings, saveSettings } from "./persistence";
import {
  gitCommands,
  fsCommands,
  conversationCommands,
} from "./tauri-commands";

export interface WorkspaceAllocation {
  worktree: WorktreeState;
  branch: string;
  mergeBase: string;
}

export interface WorkspaceService {
  initializeTaskBranch(
    repoName: string,
    taskId: string,
    parentTaskId?: string
  ): Promise<TaskBranchInfo>;

  getTaskBranchInfo(repoName: string, taskId: string): Promise<TaskBranchInfo | null>;

  allocateWorkspace(
    repoName: string,
    taskId: string,
    conversationId: string
  ): Promise<WorkspaceAllocation>;

  releaseWorkspace(repoName: string, conversationId: string): Promise<void>;

  releaseStaleWorkspaces(repoName: string): Promise<number>;
  syncWithDisk(repoName: string): Promise<void>;
  deleteTaskBranch(repoName: string, taskId: string): Promise<void>;
}

export function createWorkspaceService(): WorkspaceService {
  return {
    async initializeTaskBranch(
      repoName: string,
      taskId: string,
      parentTaskId?: string
    ): Promise<TaskBranchInfo> {
      const settings = await loadSettings(repoName);

      // Return existing if already initialized
      if (settings.taskBranches[taskId]) {
        return settings.taskBranches[taskId];
      }

      // Determine base branch
      const baseBranch = parentTaskId
        ? settings.taskBranches[parentTaskId]?.branch ?? await getDefaultBranch(repoName)
        : await getDefaultBranch(repoName);

      // Get merge base (current commit of base branch)
      const mergeBase = await getMergeBaseCommit(repoName, baseBranch);

      // Create branch in source repo
      const branchName = `anvil/task-${taskId}`;
      await createGitBranch(repoName, branchName, baseBranch);

      // Store in settings
      const branchInfo: TaskBranchInfo = {
        branch: branchName,
        baseBranch,
        mergeBase,
        parentTaskId,
        createdAt: Date.now(),
      };

      settings.taskBranches[taskId] = branchInfo;
      settings.lastUpdated = Date.now();
      await saveSettings(repoName, settings);

      return branchInfo;
    },

    async getTaskBranchInfo(
      repoName: string,
      taskId: string
    ): Promise<TaskBranchInfo | null> {
      const settings = await loadSettings(repoName);
      return settings.taskBranches[taskId] ?? null;
    },

    async allocateWorkspace(
      repoName: string,
      taskId: string,
      conversationId: string
    ): Promise<WorkspaceAllocation> {
      // Use file-based locking to prevent race conditions
      return await withRepoLock(repoName, async () => {
        // Sync and cleanup first
        await this.syncWithDisk(repoName);
        await this.releaseStaleWorkspaces(repoName);

        const settings = await loadSettings(repoName);

        // Ensure task has a branch
        let branchInfo = settings.taskBranches[taskId];
        if (!branchInfo) {
          branchInfo = await this.initializeTaskBranch(repoName, taskId);
          // Reload settings after branch creation
          const updatedSettings = await loadSettings(repoName);
          Object.assign(settings, updatedSettings);
        }

        // Find available worktree or create new one
        let worktree = settings.worktrees.find(w => !w.claim);
        if (!worktree) {
          worktree = await createWorktree(repoName, settings);
          settings.worktrees.push(worktree);
        }

        // Checkout task's branch (force to discard uncommitted changes)
        await gitCommands.checkoutBranch(worktree.path, branchInfo.branch);

        // Set claim
        worktree.claim = {
          conversationId,
          taskId,
          claimedAt: Date.now(),
        };
        worktree.currentBranch = branchInfo.branch;

        settings.lastUpdated = Date.now();
        await saveSettings(repoName, settings);

        return {
          worktree,
          branch: branchInfo.branch,
          mergeBase: branchInfo.mergeBase,
        };
      });
    },

    async releaseWorkspace(
      repoName: string,
      conversationId: string
    ): Promise<void> {
      const settings = await loadSettings(repoName);

      const worktree = settings.worktrees.find(
        w => w.claim?.conversationId === conversationId
      );

      if (worktree) {
        worktree.claim = null;
        settings.lastUpdated = Date.now();
        await saveSettings(repoName, settings);
      }
    },

    async releaseStaleWorkspaces(repoName: string): Promise<number> {
      const settings = await loadSettings(repoName);
      let released = 0;

      for (const worktree of settings.worktrees) {
        if (worktree.claim && await isClaimStale(worktree.claim)) {
          worktree.claim = null;
          released++;
        }
      }

      if (released > 0) {
        settings.lastUpdated = Date.now();
        await saveSettings(repoName, settings);
      }

      return released;
    },

    async syncWithDisk(repoName: string): Promise<void> {
      const settings = await loadSettings(repoName);

      // Remove entries for worktrees that no longer exist on disk
      const validWorktrees: WorktreeState[] = [];
      for (const worktree of settings.worktrees) {
        if (await pathExists(worktree.path)) {
          validWorktrees.push(worktree);
        }
      }

      if (validWorktrees.length !== settings.worktrees.length) {
        settings.worktrees = validWorktrees;
        settings.lastUpdated = Date.now();
        await saveSettings(repoName, settings);
      }
    },

    async deleteTaskBranch(repoName: string, taskId: string): Promise<void> {
      const settings = await loadSettings(repoName);
      const branchInfo = settings.taskBranches[taskId];

      if (!branchInfo) return;

      // Ensure no active claims on this task
      const activeClaim = settings.worktrees.find(
        w => w.claim?.taskId === taskId
      );
      if (activeClaim) {
        throw new Error(`Cannot delete branch: task ${taskId} has active conversation`);
      }

      // Delete the git branch
      await deleteGitBranch(repoName, branchInfo.branch);

      // Remove from settings
      delete settings.taskBranches[taskId];
      settings.lastUpdated = Date.now();
      await saveSettings(repoName, settings);
    },
  };
}

// Helper functions

/**
 * File-based locking to prevent concurrent workspace operations.
 */
async function withRepoLock<T>(
  repoName: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockId = await invoke<string>("acquire_repo_lock", { repoName });
  try {
    return await operation();
  } finally {
    await invoke("release_repo_lock", { lockId });
  }
}

/**
 * Get default branch for a repository.
 */
async function getDefaultBranch(repoName: string): Promise<string> {
  const repoPath = await fsCommands.getRepoSourcePath(repoName);
  return await gitCommands.getDefaultBranch(repoPath);
}

/**
 * Get the commit hash of a branch (used as merge base).
 */
async function getMergeBaseCommit(repoName: string, branch: string): Promise<string> {
  const repoPath = await fsCommands.getRepoSourcePath(repoName);
  return await gitCommands.getBranchCommit(repoPath, branch);
}

/**
 * Create a git branch in the source repository.
 */
async function createGitBranch(
  repoName: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  const repoPath = await fsCommands.getRepoSourcePath(repoName);

  // Check if branch already exists (handle collision)
  const exists = await gitCommands.branchExists(repoPath, branchName);
  if (exists) {
    throw new Error(`Branch '${branchName}' already exists. Task ID collision?`);
  }

  await gitCommands.createGitBranch(repoPath, branchName, baseBranch);
}

/**
 * Create a new worktree in the repository's worktree pool.
 */
async function createWorktree(
  repoName: string,
  settings: RepositorySettings
): Promise<WorktreeState> {
  const repoPath = await fsCommands.getRepoSourcePath(repoName);
  const repoDir = await fsCommands.getRepoDir(repoName);

  // Generate worktree path: ~/.anvil/repositories/{repo}/worktree-{n}
  const version = settings.worktrees.length + 1;
  const worktreePath = `${repoDir}/worktree-${version}`;

  // Get default branch for initial checkout
  const defaultBranch = await getDefaultBranch(repoName);

  // Create worktree with detached HEAD, then checkout default branch
  await gitCommands.createWorktree(repoPath, worktreePath, defaultBranch);

  return {
    path: worktreePath,
    version,
    currentBranch: defaultBranch,
    claim: null,
  };
}

/**
 * Delete a git branch from the source repository.
 */
async function deleteGitBranch(repoName: string, branch: string): Promise<void> {
  const repoPath = await fsCommands.getRepoSourcePath(repoName);
  await gitCommands.deleteGitBranch(repoPath, branch);
}

/**
 * Check if a worktree claim is stale (should be released).
 */
async function isClaimStale(claim: WorktreeClaim): Promise<boolean> {
  // Check age (24 hours)
  const ageMs = Date.now() - claim.claimedAt;
  if (ageMs > 24 * 60 * 60 * 1000) return true;

  // Check conversation status via Tauri command
  const status = await conversationCommands.getConversationStatus(claim.conversationId);
  if (status === "completed" || status === "error") {
    return true;
  }

  return false;
}
```

---

### File: `src/lib/persistence.ts`

Add settings file helpers:

```typescript
import type { RepositorySettings } from "@/entities/repositories/types";
import { invoke } from "@tauri-apps/api/core";

const SETTINGS_FILE = "settings.json";

export async function loadSettings(repoName: string): Promise<RepositorySettings> {
  const settingsPath = await getSettingsPath(repoName);

  try {
    const content = await invoke<string>("read_file", { path: settingsPath });
    return JSON.parse(content) as RepositorySettings;
  } catch {
    // Try migrating from metadata.json
    return await migrateFromMetadata(repoName);
  }
}

export async function saveSettings(
  repoName: string,
  settings: RepositorySettings
): Promise<void> {
  const settingsPath = await getSettingsPath(repoName);
  await invoke("write_file", {
    path: settingsPath,
    content: JSON.stringify(settings, null, 2),
  });
}

async function getSettingsPath(repoName: string): Promise<string> {
  const repoDir = await invoke<string>("get_repo_dir", { repoName });
  return `${repoDir}/${SETTINGS_FILE}`;
}

async function migrateFromMetadata(repoName: string): Promise<RepositorySettings> {
  // Read old metadata.json and convert to new format
  const repoDir = await invoke<string>("get_repo_dir", { repoName });
  const metadataPath = `${repoDir}/metadata.json`;

  try {
    const content = await invoke<string>("read_file", { path: metadataPath });
    const metadata = JSON.parse(content);

    // Discover existing worktrees from disk
    const existingWorktrees = await discoverExistingWorktrees(repoDir);

    // Convert to new format
    const settings: RepositorySettings = {
      schemaVersion: 1,
      name: metadata.name,
      originalUrl: metadata.originalUrl ?? null,
      sourcePath: metadata.sourcePath,
      useWorktrees: metadata.useWorktrees ?? true,
      createdAt: metadata.createdAt ?? Date.now(),
      worktrees: existingWorktrees,
      taskBranches: {},  // No way to recover merge bases from old format
      lastUpdated: Date.now(),
    };

    // Save new format
    await saveSettings(repoName, settings);

    return settings;
  } catch {
    throw new Error(`Repository ${repoName} not found`);
  }
}

/**
 * Discover existing worktrees on disk during migration.
 */
async function discoverExistingWorktrees(repoDir: string): Promise<WorktreeState[]> {
  const worktrees: WorktreeState[] = [];

  // Look for worktree-* directories
  for (let i = 1; i <= 10; i++) {
    const worktreePath = `${repoDir}/worktree-${i}`;
    const exists = await invoke<boolean>("path_exists", { path: worktreePath });

    if (exists) {
      worktrees.push({
        path: worktreePath,
        version: i,
        currentBranch: null,  // Unknown, will be detected on next use
        claim: null,          // No active claims after migration
      });
    }
  }

  return worktrees;
}
```

---

## Stale Claim Detection

A claim is stale when:
- The `claimedAt` is older than 24 hours, OR
- The associated conversation has status `completed` or `error`

Stale detection runs during `allocateWorkspace()` as a cleanup mechanism. This handles:
- App crashes that didn't release claims
- Conversations that completed but didn't call `releaseWorkspace()`
- Abandoned conversations

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Process crash mid-conversation | Stale detection releases claim on next allocation |
| Concurrent allocation | File-based locking via `withRepoLock()` serializes operations |
| Worktree deleted externally | `syncWithDisk()` removes orphaned entries |
| Branch deleted externally | Detect on allocation, recreate from default branch |
| Branch name collision | `createGitBranch()` checks existence first and throws |
| Uncommitted changes in worktree | `git checkout --force` discards them |
| Migration from old format | `discoverExistingWorktrees()` preserves existing worktrees |

---

## Tauri Commands Required

All required Tauri commands are defined in [02a-tauri-commands](./02a-tauri-commands.md):

- `acquire_repo_lock` / `release_repo_lock` - File-based locking
- `get_default_branch` - Detect repository's default branch
- `get_branch_commit` - Get commit hash of a branch
- `create_git_branch` - Create a new branch
- `branch_exists` - Check if branch exists
- `create_worktree` - Create git worktree
- `checkout_branch` - Checkout branch in worktree
- `delete_git_branch` - Delete a branch
- `path_exists` - Check if path exists on disk
- `get_conversation_status` - Check conversation status for stale detection

---

## Verification

- [ ] Service creates task branches correctly
- [ ] Branch collision is detected and throws
- [ ] Worktree allocation works with pool
- [ ] Worktree creation includes initial checkout
- [ ] File-based locking prevents concurrent race conditions
- [ ] Stale claims are released
- [ ] Sync removes orphaned worktrees
- [ ] Branch deletion works after task completion
- [ ] Migration preserves existing worktrees
- [ ] Conversation status lookup works for stale detection
