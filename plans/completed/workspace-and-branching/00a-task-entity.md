# 00a - Task Entity & Persistence

**Tier:** 1 (No dependencies)
**Parallelizable with:** 01-types, 02-git-utilities
**Blocking:** 03-workspace-service, 05-agent-service, 06-ui-integration, 07-maintenance

---

## Rationale

Tasks are referenced throughout all workspace and branching plans but were never formally defined. This plan establishes the Task entity, its storage, and CRUD operations.

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Used by: 03-workspace-service, 05-agent-service, 06-ui-integration, 07-maintenance
export interface Task {
  id: string;
  title: string;
  repositoryName: string;
  parentTaskId?: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | "pending"      // Created but no work started
  | "in_progress"  // Agent actively working
  | "paused"       // Work paused, can resume
  | "completed"    // Work done, awaiting review
  | "merged"       // PR merged, ready for cleanup
  | "cancelled";   // Abandoned

// Used by: 05-agent-service, 06-ui-integration
export function generateTaskId(): string;

// Used by: 06-ui-integration, 07-maintenance
export interface TaskService {
  createTask(options: CreateTaskOptions): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  getSubtasks(parentTaskId: string): Promise<Task[]>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  listTasks(repositoryName?: string): Promise<Task[]>;
}

export function createTaskService(): TaskService;
```

### Imports (This Plan Depends On)

None - this is a foundation plan.

---

## Implementation

### File: `src/entities/tasks/types.ts`

```typescript
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "paused"
  | "completed"
  | "merged"
  | "cancelled";

export interface Task {
  /** Unique task identifier */
  id: string;

  /** Human-readable task title (often derived from prompt) */
  title: string;

  /** Repository this task operates on */
  repositoryName: string;

  /** Parent task ID for subtasks */
  parentTaskId?: string;

  /** Current task status */
  status: TaskStatus;

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;
}

export interface CreateTaskOptions {
  title: string;
  repositoryName: string;
  parentTaskId?: string;
}
```

### File: `src/entities/tasks/task-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { Task, TaskStatus, CreateTaskOptions } from "./types";

export interface TaskService {
  createTask(options: CreateTaskOptions): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  getSubtasks(parentTaskId: string): Promise<Task[]>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  listTasks(repositoryName?: string): Promise<Task[]>;
}

/**
 * Generate a unique task ID.
 * Format: task-{timestamp}-{random}
 */
export function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `task-${timestamp}-${random}`;
}

export function createTaskService(): TaskService {
  return {
    async createTask(options: CreateTaskOptions): Promise<Task> {
      const task: Task = {
        id: generateTaskId(),
        title: options.title,
        repositoryName: options.repositoryName,
        parentTaskId: options.parentTaskId,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await invoke("save_task", { task });
      return task;
    },

    async getTask(taskId: string): Promise<Task | null> {
      try {
        return await invoke<Task>("get_task", { taskId });
      } catch {
        return null;
      }
    },

    async getSubtasks(parentTaskId: string): Promise<Task[]> {
      return await invoke<Task[]>("get_subtasks", { parentTaskId });
    },

    async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
      await invoke("update_task_status", { taskId, status, updatedAt: Date.now() });
    },

    async deleteTask(taskId: string): Promise<void> {
      await invoke("delete_task", { taskId });
    },

    async listTasks(repositoryName?: string): Promise<Task[]> {
      return await invoke<Task[]>("list_tasks", { repositoryName });
    },
  };
}
```

---

## Storage

Tasks are stored in `~/.mort/tasks/` as individual JSON files:

```
~/.mort/tasks/
├── task-abc123.json
├── task-def456.json
└── task-sub-789.json
```

Each file contains a single Task object:

```json
{
  "id": "task-abc123",
  "title": "Add user authentication",
  "repositoryName": "my-app",
  "status": "in_progress",
  "createdAt": 1703100000000,
  "updatedAt": 1703184000000
}
```

### Why Individual Files?

- Simple atomic writes (no need to lock a shared file)
- Easy to enumerate and filter
- Scales better than a single JSON file for many tasks
- Easy to manually inspect/debug

---

## Tauri Commands

Add to `src-tauri/src/tasks.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub repository_name: String,
    pub parent_task_id: Option<String>,
    pub status: String,
    pub created_at: u64,
    pub updated_at: u64,
}

fn get_tasks_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let tasks_dir = home.join(".mort").join("tasks");
    fs::create_dir_all(&tasks_dir).map_err(|e| e.to_string())?;
    Ok(tasks_dir)
}

fn get_task_path(task_id: &str) -> Result<PathBuf, String> {
    let tasks_dir = get_tasks_dir()?;
    Ok(tasks_dir.join(format!("{}.json", task_id)))
}

#[tauri::command]
pub async fn save_task(task: Task) -> Result<(), String> {
    let path = get_task_path(&task.id)?;
    let content = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_task(task_id: String) -> Result<Task, String> {
    let path = get_task_path(&task_id)?;
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_subtasks(parent_task_id: String) -> Result<Vec<Task>, String> {
    let tasks_dir = get_tasks_dir()?;
    let mut subtasks = Vec::new();

    for entry in fs::read_dir(tasks_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "json") {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            if let Ok(task) = serde_json::from_str::<Task>(&content) {
                if task.parent_task_id.as_ref() == Some(&parent_task_id) {
                    subtasks.push(task);
                }
            }
        }
    }

    Ok(subtasks)
}

#[tauri::command]
pub async fn update_task_status(
    task_id: String,
    status: String,
    updated_at: u64,
) -> Result<(), String> {
    let path = get_task_path(&task_id)?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut task: Task = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    task.status = status;
    task.updated_at = updated_at;

    let updated_content = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
    fs::write(path, updated_content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_task(task_id: String) -> Result<(), String> {
    let path = get_task_path(&task_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_tasks(repository_name: Option<String>) -> Result<Vec<Task>, String> {
    let tasks_dir = get_tasks_dir()?;
    let mut tasks = Vec::new();

    for entry in fs::read_dir(tasks_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "json") {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            if let Ok(task) = serde_json::from_str::<Task>(&content) {
                if repository_name.is_none()
                    || task.repository_name == *repository_name.as_ref().unwrap()
                {
                    tasks.push(task);
                }
            }
        }
    }

    // Sort by creation time, newest first
    tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(tasks)
}
```

---

## Register Commands

In `src-tauri/src/main.rs`:

```rust
mod tasks;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // ... existing commands
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

## Verification

- [ ] Task types exported from `src/entities/tasks/types.ts`
- [ ] TaskService implemented in `src/entities/tasks/task-service.ts`
- [ ] `generateTaskId()` produces unique IDs
- [ ] All Tauri commands implemented and registered
- [ ] Tasks persist across app restarts
- [ ] Subtask queries return correct results
- [ ] Status updates are atomic
