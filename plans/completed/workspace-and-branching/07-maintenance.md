# 07 - Maintenance & Cleanup

**Tier:** 4
**Depends on:** 03-workspace-service, 00a-task-entity
**Parallelizable with:** 06-ui-integration

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Used by: app-lifecycle.ts
export function runMaintenance(): Promise<void>;
export function cleanupOrphanedBranches(repoName: string): Promise<void>;
```

### Imports (This Plan Depends On)

```typescript
// From 03-workspace-service
import { createWorkspaceService } from "@/lib/workspace-service";
import { loadSettings } from "@/lib/persistence";

// From 00a-task-entity
import {
  createTaskService,
  type Task,
  type TaskStatus,
} from "@/entities/tasks/task-service";
```

---

## Implementation

### Part 1: Branch Cleanup After Task Merge

**File:** `src/lib/task-lifecycle.ts`

When a task's PR is approved and merged, clean up the branch:

```typescript
import { createWorkspaceService } from "./workspace-service";
import { createTaskService, type Task } from "@/entities/tasks/task-service";

const workspaceService = createWorkspaceService();
const taskService = createTaskService();

/**
 * Called when a task is marked as completed/merged.
 * Cleans up the associated branch.
 */
export async function finalizeTask(
  repoName: string,
  taskId: string
): Promise<void> {
  try {
    await workspaceService.deleteTaskBranch(repoName, taskId);
  } catch (error) {
    // Log but don't fail - branch may have been manually deleted
    console.warn(`Failed to delete branch for task ${taskId}:`, error);
  }
}

/**
 * Called from approval flow:
 * 1. User approves task completion
 * 2. PR is merged (if applicable)
 * 3. Task status is set to `merged` or `completed`
 * 4. Call this function
 */
export async function onTaskApproved(task: Task): Promise<void> {
  // Update task status using task service
  await taskService.updateTaskStatus(task.id, "completed");

  // Clean up branch
  await finalizeTask(task.repositoryName, task.id);

  // Clean up any subtask branches
  const subtasks = await taskService.getSubtasks(task.id);
  for (const subtask of subtasks) {
    await taskService.updateTaskStatus(subtask.id, "completed");
    await finalizeTask(task.repositoryName, subtask.id);
  }
}
```

---

### Part 2: Git.ts Cleanup

**File:** `agents/src/git.ts`

Remove functions that are now handled by workspace service:

```typescript
// REMOVE these functions (moved to workspace service):

// ❌ getMergeBase() - merge base now comes from settings
// ❌ createTaskBranch() - moved to workspace service via Tauri commands

// KEEP these functions:

// ✓ getDefaultBranch() - still needed for fallback in runner
// ✓ getDiff(cwd, mergeBase) - still used, but mergeBase is a parameter
// ✓ getStatus(cwd) - still used for status checks
// ✓ Other utility functions that take merge base as parameter
```

**Before:**
```typescript
// git.ts with self-contained merge base logic
export function getMergeBase(cwd: string): string {
  try {
    return execFileSync("git", ["merge-base", "HEAD", "main"], {...}).trim();
  } catch {
    return execFileSync("git", ["rev-parse", "HEAD~1"], {...}).trim();
  }
}

export function getDiff(cwd: string): string {
  const mergeBase = getMergeBase(cwd);  // Self-contained
  return execFileSync("git", ["diff", mergeBase, "HEAD"], {...});
}
```

**After:**
```typescript
// git.ts with merge base as parameter
export function getDefaultBranch(cwd: string): string {
  // Keep this - used by runner for fallback
  // ... implementation from 02-git-utilities
}

export function getDiff(cwd: string, mergeBase: string): string {
  // Merge base is now passed in, not calculated
  return execFileSync("git", ["diff", mergeBase, "HEAD"], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function getStatus(cwd: string): GitStatus {
  // Keep as-is
}
```

---

### Part 3: Periodic Maintenance

**File:** `src/lib/maintenance.ts`

Background maintenance tasks with proper imports:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { createWorkspaceService } from "./workspace-service";
import { loadSettings } from "./persistence";
import { createTaskService } from "@/entities/tasks/task-service";

const workspaceService = createWorkspaceService();
const taskService = createTaskService();

/**
 * Run periodic maintenance on all repositories.
 * Call this on app startup and periodically.
 */
export async function runMaintenance(): Promise<void> {
  // Get list of repository names from the repositories directory
  const repos = await invoke<string[]>("list_repositories");

  for (const repoName of repos) {
    try {
      // Sync worktree entries with what exists on disk
      await workspaceService.syncWithDisk(repoName);

      // Release any stale claims
      const released = await workspaceService.releaseStaleWorkspaces(repoName);
      if (released > 0) {
        console.log(`Released ${released} stale workspace claims for ${repoName}`);
      }
    } catch (error) {
      console.error(`Maintenance failed for ${repoName}:`, error);
    }
  }
}

/**
 * Clean up orphaned branches that no longer have associated tasks.
 */
export async function cleanupOrphanedBranches(repoName: string): Promise<void> {
  const settings = await loadSettings(repoName);
  const taskIds = Object.keys(settings.taskBranches);

  for (const taskId of taskIds) {
    const task = await taskService.getTask(taskId);

    // If task doesn't exist or is completed, clean up branch
    if (!task || task.status === "completed" || task.status === "merged") {
      await workspaceService.deleteTaskBranch(repoName, taskId);
    }
  }
}
```

#### Tauri Command for Repository List

Add to `src-tauri/src/filesystem_commands.rs`:

```rust
#[tauri::command]
pub async fn list_repositories() -> Result<Vec<String>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let repos_dir = home.join(".anvil").join("repositories");

    if !repos_dir.exists() {
        return Ok(Vec::new());
    }

    let mut repos = Vec::new();
    for entry in std::fs::read_dir(repos_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_or(false, |t| t.is_dir()) {
            if let Some(name) = entry.file_name().to_str() {
                repos.push(name.to_string());
            }
        }
    }

    Ok(repos)
}
```

---

### Part 4: Startup Hooks

**File:** `src/lib/app-lifecycle.ts`

```typescript
import { runMaintenance } from "./maintenance";
import { getAgentService } from "./agent-service";

let maintenanceIntervalId: number | null = null;

export async function onAppStart(): Promise<void> {
  // Initialize agent service (restores state, sets up event listeners)
  const agentService = getAgentService();
  await agentService.initialize();

  // Run maintenance on startup
  await runMaintenance();

  // Set up periodic maintenance (every hour)
  // Note: In Tauri/Electron apps, setInterval can be unreliable during
  // app backgrounding. For critical maintenance, consider using:
  // 1. Tauri's app lifecycle events (focus/blur) to trigger maintenance
  // 2. Or running maintenance on each task start/stop
  maintenanceIntervalId = window.setInterval(() => {
    runMaintenance().catch(console.error);
  }, 60 * 60 * 1000);
}

export async function onAppStop(): Promise<void> {
  // Clean up maintenance interval
  if (maintenanceIntervalId !== null) {
    window.clearInterval(maintenanceIntervalId);
    maintenanceIntervalId = null;
  }

  // Dispose agent service
  const agentService = getAgentService();
  agentService.dispose();
}
```

#### Alternative: Event-Based Maintenance

For more reliable maintenance, trigger on app focus events:

```typescript
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";

let lastMaintenanceTime = 0;
const MAINTENANCE_COOLDOWN = 60 * 60 * 1000; // 1 hour

export async function setupEventBasedMaintenance(): Promise<void> {
  // Run maintenance when app gains focus (if cooldown passed)
  await appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      const now = Date.now();
      if (now - lastMaintenanceTime > MAINTENANCE_COOLDOWN) {
        lastMaintenanceTime = now;
        runMaintenance().catch(console.error);
      }
    }
  });
}
```

---

## Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Task deleted but branch exists | `cleanupOrphanedBranches` removes it |
| Branch deleted but entry exists | `syncWithDisk` detects, next allocation recreates |
| Worktree deleted externally | `syncWithDisk` removes orphaned entry |
| App crashes mid-conversation | Stale detection releases claim on restart |
| Multiple subtasks merged | Parent branch cleanup includes subtask cleanup |

---

## Tauri Commands for Cleanup

Add to `src-tauri/src/filesystem.rs`:

```rust
#[tauri::command]
pub async fn delete_git_branch(
    repo_name: String,
    branch: String,
) -> Result<(), String> {
    let repo_path = get_repo_source_path(&repo_name)?;

    // Force delete the branch
    Command::new("git")
        .args(&["branch", "-D", &branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn list_anvil_branches(repo_name: String) -> Result<Vec<String>, String> {
    let repo_path = get_repo_source_path(&repo_name)?;

    let output = Command::new("git")
        .args(&["branch", "--list", "anvil/*"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    let branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().trim_start_matches("* ").to_string())
        .collect();

    Ok(branches)
}
```

---

## Verification

- [ ] Branch deleted when task is approved/merged
- [ ] Subtask branches cleaned up with parent
- [ ] getMergeBase removed from git.ts
- [ ] getDiff takes mergeBase as parameter
- [ ] Periodic maintenance runs on startup
- [ ] Orphaned branches can be cleaned up
- [ ] Stale claims released on app restart
- [ ] All imports properly resolved (TaskService, loadSettings, etc.)
- [ ] `list_repositories` Tauri command registered
- [ ] Maintenance interval cleaned up on app stop
- [ ] Event-based maintenance triggers on app focus (optional)
