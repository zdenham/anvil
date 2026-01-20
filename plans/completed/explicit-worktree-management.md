# Explicit Worktree Management

## Overview

Transition from auto-created worktrees (created implicitly with tasks) to explicitly managed worktrees. Users will create and manage worktrees through a dedicated "Worktrees" tab in the main application, and select which worktree a task operates in via the spotlight.

### Current Behavior
- Worktrees are auto-created when a task is spawned if none are available
- Tasks are automatically associated with worktrees via the allocation service
- Complex pooling/claiming logic tracks which threads use which worktrees
- The `WorktreePoolManager.create()` method is called internally during allocation

### New Behavior
- Users explicitly create worktrees via the Worktrees tab
- When creating a task in spotlight, users select which worktree to use (right arrow cycles through them)
- **Both tasks AND threads** store `worktreePath` and operate in that directory
- Worktrees are ordered by most recently accessed for easy selection
- **No pooling or allocation logic needed** - worktree selection is a simple user choice

---

## ⚠️ CRITICAL: Dead Code Deletion

**This refactor MUST delete all pooling/allocation code.** The old complexity is not just unused—it's actively harmful to maintain. Delete it early and aggressively.

### Files to DELETE (Non-negotiable)

These files will be **completely removed** from the codebase:

| File | Why Delete |
|------|------------|
| `core/services/worktree/worktree-pool-manager.ts` | Pool concept eliminated |
| `core/services/worktree/worktree-pool-manager.test.ts` | Tests for deleted code |
| `core/services/worktree/allocation-service.ts` | Allocation concept eliminated |
| `core/services/worktree/allocation-service.test.ts` | Tests for deleted code |
| `core/services/worktree/branch-manager.ts` | Branch logic moves to simpler places |
| `core/services/worktree/branch-manager.test.ts` | Tests for deleted code |

### Types to DELETE

From `core/types/repositories.ts`:
- `WorktreeClaimSchema` - DELETE entirely
- `WorktreeClaim` type - DELETE entirely
- `RepositoryVersionSchema` - DELETE if unused elsewhere
- From `WorktreeStateSchema`: remove `claim`, `version`, `lastTaskId`, `lastReleasedAt`

### Code to DELETE from Other Files

**`agents/src/runners/task-runner-strategy.ts`**:
- All `WorktreeAllocationService` imports and usage
- All worktree claiming/releasing logic
- Auto-worktree creation fallbacks

**`agents/src/orchestration.ts`**:
- All `WorktreePoolManager` imports and usage
- All `WorktreeAllocationService` imports and usage

**`core/services/repository/settings-service.ts`**:
- Any pooling/claiming helper methods

**`src/entities/repositories/types.ts`**:
- `WorktreeClaim` type if duplicated here

**`src/lib/agent-service.ts`**:
- Error handling for "No available worktrees"
- `no_worktrees_available` error type

**`src/components/spotlight/spotlight.tsx`**:
- `no_worktrees_available` error type and handling

### Estimated Impact

| Category | Count | Lines Removed |
|----------|-------|---------------|
| Files deleted entirely | 6 | ~1,500 |
| Types removed | 3-5 | ~100 |
| Code removed from existing files | ~10 files | ~300 |
| Test code deleted | 3 files | ~800 |
| **Total** | | **~2,700 lines** |

---

## Architecture

### Simplified Model

With explicit worktree management, we eliminate:
- `WorktreePoolManager` - No pool to manage
- `WorktreeAllocationService` - No allocation needed
- `WorktreeClaim` - No claiming/locking between threads
- LRU selection, affinity, concurrent access logic

Instead, we have:
- `WorktreeService` - Simple CRUD for worktrees (create, delete, list, rename)
- Direct `worktreePath` on tasks and threads

### Data Model Changes

**Simplified `WorktreeState`** (in `core/types/repositories.ts`):
```typescript
interface WorktreeState {
  path: string;              // Absolute path to worktree directory
  name: string;              // User-friendly display name
  lastAccessedAt?: number;   // For sorting by recency
  currentBranch?: string;    // Currently checked out branch (informational)
}
```

Remove from `WorktreeState`:
- `claim` - No longer needed
- `version` - Vestigial from numbered worktrees
- `lastTaskId` - No longer needed for affinity

**Task Metadata** - Add explicit worktree reference:
```typescript
interface TaskMetadata {
  // ... existing fields
  worktreePath?: string;     // Explicit worktree path (set at task creation)
}
```

**Thread Metadata** - Add explicit worktree reference:
```typescript
interface ThreadMetadata {
  // ... existing fields
  worktreePath?: string;     // Worktree this thread operates in
}
```

### Key Flows

**1. Worktree Creation (New)**
```
User: Clicks "New Worktree" in Worktrees tab
  → Opens name dialog
  → Calls worktreeService.create(repoName, name)
  → Creates git worktree on disk
  → Adds to RepositorySettings.worktrees
  → UI refreshes worktree list
```

**2. Task Creation with Worktree Selection (Modified)**
```
User: Types prompt in spotlight, presses right arrow
  → Cycles through worktrees (sorted by lastAccessedAt desc)
  → Selected worktree shown in spotlight UI
  → On Enter/Cmd+Enter:
    → Task is created with worktreePath set
    → Thread is created with worktreePath set
    → Agent spawns with --cwd pointing to worktree
    → worktreeService.touch() updates lastAccessedAt
```

**3. Worktree Deletion (New)**
```
User: Clicks delete on worktree in Worktrees tab
  → Checks if any active tasks use this worktree
  → If in use: Shows error "Worktree in use by task X"
  → If free: Confirms deletion
  → Removes git worktree from disk
  → Removes from RepositorySettings.worktrees
```

---

## Implementation Plan

### Phase 1: Data Model Updates

**File**: `core/types/repositories.ts`

1. Simplify `WorktreeStateSchema` (remove claim, version, lastTaskId):
```typescript
export const WorktreeStateSchema = z.object({
  path: z.string(),
  name: z.string(),
  lastAccessedAt: z.number().optional(),
  currentBranch: z.string().nullable().optional(),
});
```

2. Remove `WorktreeClaimSchema` entirely - no longer needed.

3. Add migration to handle existing worktrees:
```typescript
function migrateWorktreeState(data: unknown): unknown {
  if (data && typeof data === 'object') {
    const { claim, version, lastTaskId, lastReleasedAt, ...rest } = data as Record<string, unknown>;
    return {
      ...rest,
      lastAccessedAt: lastReleasedAt ?? Date.now(),
      name: rest.name ?? `worktree-${rest.path?.toString().split('/').pop() ?? 'unknown'}`,
    };
  }
  return data;
}
```

**File**: `core/types/tasks.ts`

4. Add `worktreePath` to task metadata schema.

**File**: `core/types/threads.ts`

5. Add `worktreePath` to thread metadata schema.

### Phase 2: WorktreeService (Core)

**New File**: `core/services/worktree/worktree-service.ts`

Simple CRUD service replacing the complex allocation/pool managers:

```typescript
import type { GitAdapter, PathLock, Logger } from '@core/adapters/types';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { WorktreeState } from '@core/types/repositories.js';

/**
 * Simple worktree CRUD service.
 * No pooling, no allocation, no claiming - just create/delete/list.
 */
export class WorktreeService {
  constructor(
    private mortDir: string,
    private settingsService: RepositorySettingsService,
    private git: GitAdapter,
    private pathLock: PathLock,
    private logger: Logger
  ) {}

  /**
   * Create a new named worktree.
   */
  create(repoName: string, name: string): WorktreeState {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);

      // Validate name uniqueness
      if (settings.worktrees.some(w => w.name === name)) {
        throw new Error(`Worktree "${name}" already exists`);
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Name can only contain letters, numbers, dashes, and underscores');
      }

      const worktreePath = `${this.mortDir}/repositories/${repoName}/${name}`;
      this.git.createWorktree(settings.sourcePath, worktreePath);

      const worktree: WorktreeState = {
        path: worktreePath,
        name,
        lastAccessedAt: Date.now(),
        currentBranch: null,
      };

      settings.worktrees.push(worktree);
      this.settingsService.save(repoName, settings);
      return worktree;
    });
  }

  /**
   * Delete a worktree by name.
   */
  delete(repoName: string, name: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const index = settings.worktrees.findIndex(w => w.name === name);

      if (index === -1) {
        throw new Error(`Worktree "${name}" not found`);
      }

      const worktree = settings.worktrees[index];
      this.git.removeWorktree(worktree.path);
      settings.worktrees.splice(index, 1);
      this.settingsService.save(repoName, settings);
    });
  }

  /**
   * Rename a worktree (metadata only, not the directory).
   */
  rename(repoName: string, oldName: string, newName: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.name === oldName);

      if (!worktree) {
        throw new Error(`Worktree "${oldName}" not found`);
      }
      if (settings.worktrees.some(w => w.name === newName)) {
        throw new Error(`Worktree "${newName}" already exists`);
      }

      worktree.name = newName;
      this.settingsService.save(repoName, settings);
    });
  }

  /**
   * List all worktrees, sorted by most recently accessed.
   */
  list(repoName: string): WorktreeState[] {
    const settings = this.settingsService.load(repoName);
    return [...settings.worktrees].sort(
      (a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0)
    );
  }

  /**
   * Get a worktree by path.
   */
  getByPath(repoName: string, path: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return settings.worktrees.find(w => w.path === path) ?? null;
  }

  /**
   * Update lastAccessedAt timestamp.
   */
  touch(repoName: string, worktreePath: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.path === worktreePath);
      if (worktree) {
        worktree.lastAccessedAt = Date.now();
        this.settingsService.save(repoName, settings);
      }
    });
  }

  /**
   * Check if any active tasks are using this worktree.
   * Used before deletion to prevent removing in-use worktrees.
   */
  isInUse(repoName: string, worktreePath: string, taskService: { getAll(): { worktreePath?: string; status: string }[] }): boolean {
    const tasks = taskService.getAll();
    return tasks.some(t =>
      t.worktreePath === worktreePath &&
      ['in-progress', 'running', 'pending'].includes(t.status)
    );
  }

  private withLock<T>(repoName: string, fn: () => T): T {
    const lockPath = `${this.mortDir}/repositories/${repoName}/.lock`;
    this.pathLock.acquire(lockPath);
    try {
      return fn();
    } finally {
      this.pathLock.release(lockPath);
    }
  }
}
```

### Phase 3: Main Window - Worktrees Tab

**File**: `src/components/main-window/main-window-layout.tsx`

1. Add "worktrees" to `TabId` type:
```typescript
export type TabId = "tasks" | "worktrees" | "logs" | "settings";
```

2. Add conditional rendering for WorktreesPage:
```typescript
{activeTab === "worktrees" && <WorktreesPage />}
```

**File**: `src/components/main-window/sidebar.tsx`

3. Add worktrees to nav items:
```typescript
const navItems: NavItem[] = [
  { id: "tasks", label: "Tasks" },
  { id: "worktrees", label: "Worktrees" },  // NEW
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];
```

**New File**: `src/components/main-window/worktrees-page.tsx`

```typescript
import { useState, useCallback } from "react";
import { Plus, Trash2, GitBranch, RefreshCw } from "lucide-react";
import { worktreeService } from "@/entities/worktrees/service";
import type { WorktreeState } from "@core/types/repositories";

export function WorktreesPage() {
  const [worktrees, setWorktrees] = useState<WorktreeState[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadWorktrees = useCallback(async () => {
    if (!selectedRepo) return;
    try {
      const list = await worktreeService.list(selectedRepo);
      setWorktrees(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worktrees");
    }
  }, [selectedRepo]);

  const handleCreate = async () => {
    if (!selectedRepo || !newWorktreeName.trim()) return;
    try {
      await worktreeService.create(selectedRepo, newWorktreeName.trim());
      setNewWorktreeName("");
      setShowCreateDialog(false);
      await loadWorktrees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create worktree");
    }
  };

  const handleDelete = async (name: string) => {
    if (!selectedRepo) return;
    try {
      await worktreeService.delete(selectedRepo, name);
      await loadWorktrees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete worktree");
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-900">
      <header className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-4">
        <h1 className="text-lg font-medium text-surface-100 font-mono">Worktrees</h1>

        {/* Repository selector */}
        <RepoSelector value={selectedRepo} onChange={setSelectedRepo} />

        <div className="flex-1" />

        {/* Create button */}
        <button
          onClick={() => setShowCreateDialog(true)}
          disabled={!selectedRepo}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent-600 text-white rounded hover:bg-accent-500 disabled:opacity-50"
        >
          <Plus size={14} />
          New Worktree
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400">
            {error}
          </div>
        )}

        {worktrees.length === 0 ? (
          <div className="text-center text-surface-400 py-8">
            {selectedRepo
              ? "No worktrees yet. Create one to get started."
              : "Select a repository to view worktrees."}
          </div>
        ) : (
          <div className="space-y-2">
            {worktrees.map((wt) => (
              <WorktreeRow
                key={wt.path}
                worktree={wt}
                onDelete={() => handleDelete(wt.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateWorktreeDialog
          onSubmit={handleCreate}
          onCancel={() => setShowCreateDialog(false)}
          name={newWorktreeName}
          onNameChange={setNewWorktreeName}
        />
      )}
    </div>
  );
}

function WorktreeRow({
  worktree,
  isInUse,
  onDelete
}: {
  worktree: WorktreeState;
  isInUse: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-surface-800/50 rounded-lg">
      <GitBranch size={16} className="text-surface-400" />

      <div className="flex-1 min-w-0">
        <div className="font-medium text-surface-100">{worktree.name}</div>
        <div className="text-sm text-surface-400 truncate">{worktree.path}</div>
        {worktree.currentBranch && (
          <div className="text-xs text-surface-500">Branch: {worktree.currentBranch}</div>
        )}
      </div>

      {isInUse ? (
        <span className="text-xs px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded">
          In use
        </span>
      ) : (
        <button
          onClick={onDelete}
          className="p-1.5 text-surface-400 hover:text-red-400 hover:bg-surface-700 rounded"
          title="Delete worktree"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
```

### Phase 4: Spotlight - Worktree Selection

**File**: `src/components/spotlight/types.ts`

1. Extend `TaskResult` to include selected worktree:
```typescript
export interface TaskResult {
  query: string;
  selectedWorktree?: {
    path: string;
    name: string;
  };
}
```

**File**: `src/components/spotlight/spotlight.tsx`

2. Add worktree cycling state:
```typescript
const [selectedWorktreeIndex, setSelectedWorktreeIndex] = useState<number>(0);
const [availableWorktrees, setAvailableWorktrees] = useState<WorktreeState[]>([]);

// Load available worktrees when spotlight opens
useEffect(() => {
  const loadWorktrees = async () => {
    const repo = controllerRef.current.getDefaultRepository();
    if (repo) {
      const worktrees = await worktreeService.getAvailable(repo.name);
      setAvailableWorktrees(worktrees);
    }
  };
  loadWorktrees();
}, []);
```

3. Add right arrow handler for worktree cycling:
```typescript
case "ArrowRight":
  if (results[selectedIndex]?.type === "task" && availableWorktrees.length > 0) {
    e.preventDefault();
    setSelectedWorktreeIndex((prev) =>
      (prev + 1) % availableWorktrees.length
    );
  }
  break;
```

4. Update task result to include selected worktree:
```typescript
// In search() or when building task result
if (result.type === "task" && availableWorktrees.length > 0) {
  result.data.selectedWorktree = {
    path: availableWorktrees[selectedWorktreeIndex].path,
    name: availableWorktrees[selectedWorktreeIndex].name,
  };
}
```

**File**: `src/components/spotlight/results-tray.tsx`

5. Display selected worktree in task result:
```typescript
if (result.type === "task") {
  return {
    icon: <MortLogo size={7} />,
    title: "Create task",
    subtitle: result.data.selectedWorktree
      ? `Worktree: ${result.data.selectedWorktree.name} (→ to change)`
      : "No worktrees available - create one first",
  };
}
```

### Phase 5: Task Creation with Explicit Worktree

**File**: `src/components/spotlight/spotlight.tsx`

1. Modify `createTask` to use selected worktree:
```typescript
async createTask(content: string, repo: Repository, worktreePath?: string): Promise<void> {
  // ... existing validation ...

  const draftTask = await taskService.createDraft({
    prompt: content,
    repositoryName: selectedRepo.name,
    worktreePath,  // NEW: Pass explicit worktree path
  });

  // Update worktree lastAccessedAt
  if (worktreePath) {
    await worktreeService.touch(repo.name, worktreePath);
  }

  // ... rest of existing flow ...
}
```

**File**: `src/lib/agent-service.ts`

2. Modify `spawnAgentWithOrchestration` to accept explicit worktree:
```typescript
export interface SpawnAgentWithOrchestrationOptions {
  // ... existing fields ...
  worktreePath?: string;  // Explicit worktree path - always pass --cwd
}
```

3. Update the spawn to always use explicit cwd (no allocation):
```typescript
// In spawnAgentWithOrchestration
const commandArgs = [
  runnerPath,
  "--agent", options.agentType,
  "--task-slug", options.taskSlug,
  "--thread-id", options.threadId,
  "--prompt", options.prompt,
  "--mort-dir", mortDir,
  "--cwd", options.worktreePath,  // Always explicit
];
```

**File**: `agents/src/runners/` (Node orchestration)

4. Remove worktree allocation logic from runners - they just use the provided cwd.

---

## Phase 6: Frontend Worktree Entity/Service

**New File**: `src/entities/worktrees/service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { WorktreeState } from "@core/types/repositories";

class WorktreeServiceClient {
  async list(repoName: string): Promise<WorktreeState[]> {
    return invoke("worktree_list", { repoName });
  }

  async create(repoName: string, name: string): Promise<WorktreeState> {
    return invoke("worktree_create", { repoName, name });
  }

  async delete(repoName: string, name: string): Promise<void> {
    return invoke("worktree_delete", { repoName, name });
  }

  async rename(repoName: string, oldName: string, newName: string): Promise<void> {
    return invoke("worktree_rename", { repoName, oldName, newName });
  }

  async touch(repoName: string, worktreePath: string): Promise<void> {
    return invoke("worktree_touch", { repoName, worktreePath });
  }

  /**
   * Check if worktree is in use by any active task.
   * This is handled on the frontend since tasks are managed in TypeScript.
   */
  async isInUse(repoName: string, worktreePath: string, taskService: { getAll(): { worktreePath?: string; status: string }[] }): Promise<boolean> {
    const tasks = taskService.getAll();
    return tasks.some(t =>
      t.worktreePath === worktreePath &&
      ['in-progress', 'running', 'pending'].includes(t.status)
    );
  }
}

export const worktreeService = new WorktreeServiceClient();
```

**File**: `src-tauri/src/worktree_commands.rs` (NEW)

Higher-level worktree management commands that:
1. Manage `settings.json` worktree metadata (names, timestamps)
2. Call existing git primitives from `git_commands.rs`
3. Handle validation, locking, and error cases

**What already exists in `git_commands.rs` (low-level primitives):**
- `git_create_worktree(repo_path, worktree_path, _branch)` - Creates git worktree with detached HEAD
- `git_remove_worktree(repo_path, worktree_path)` - Removes git worktree with force
- `git_list_worktrees(repo_path)` - Lists git worktrees (returns `WorktreeInfo`)

**What needs to be added** - Settings-aware wrappers that coordinate git operations with metadata:

```rust
use crate::git_commands;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub path: String,
    pub name: String,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
}

/// List worktrees from settings, sorted by lastAccessedAt (most recent first).
#[tauri::command]
pub async fn worktree_list(repo_name: String) -> Result<Vec<WorktreeState>, String> {
    let settings = load_settings(&repo_name)?;
    let mut worktrees: Vec<WorktreeState> = settings.get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    worktrees.sort_by(|a, b| b.last_accessed_at.unwrap_or(0).cmp(&a.last_accessed_at.unwrap_or(0)));
    Ok(worktrees)
}

/// Create a new named worktree.
#[tauri::command]
pub async fn worktree_create(repo_name: String, name: String) -> Result<WorktreeState, String> {
    if !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Name can only contain letters, numbers, dashes, and underscores".into());
    }
    let mut settings = load_settings(&repo_name)?;
    let worktrees: Vec<WorktreeState> = settings.get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    if worktrees.iter().any(|w| w.name == name) {
        return Err(format!("Worktree \"{}\" already exists", name));
    }
    let source_path = settings.get("sourcePath").and_then(|v| v.as_str())
        .ok_or("Repository has no sourcePath")?.to_string();
    let worktree_path = paths::repositories_dir().join(&repo_name).join(&name).to_string_lossy().to_string();

    // Call existing git primitive
    git_commands::git_create_worktree(source_path, worktree_path.clone(), String::new()).await?;

    let worktree = WorktreeState {
        path: worktree_path, name, last_accessed_at: Some(now_millis()), current_branch: None,
    };
    let mut arr = worktrees; arr.push(worktree.clone());
    settings["worktrees"] = serde_json::to_value(&arr).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;
    Ok(worktree)
}

/// Delete a worktree by name.
#[tauri::command]
pub async fn worktree_delete(repo_name: String, name: String) -> Result<(), String> {
    let mut settings = load_settings(&repo_name)?;
    let mut worktrees: Vec<WorktreeState> = settings.get("worktrees")
        .and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let index = worktrees.iter().position(|w| w.name == name)
        .ok_or(format!("Worktree \"{}\" not found", name))?;
    let worktree_path = worktrees[index].path.clone();
    let source_path = settings.get("sourcePath").and_then(|v| v.as_str())
        .ok_or("Repository has no sourcePath")?.to_string();

    // Call existing git primitive
    git_commands::git_remove_worktree(source_path, worktree_path).await?;

    worktrees.remove(index);
    settings["worktrees"] = serde_json::to_value(&worktrees).map_err(|e| e.to_string())?;
    save_settings(&repo_name, &settings)?;
    Ok(())
}

/// Rename a worktree (metadata only - path stays the same).
#[tauri::command]
pub async fn worktree_rename(repo_name: String, old_name: String, new_name: String) -> Result<(), String> {
    // ... validation & settings update only, no git command needed
}

/// Update lastAccessedAt timestamp for a worktree.
#[tauri::command]
pub async fn worktree_touch(repo_name: String, worktree_path: String) -> Result<(), String> {
    // ... update timestamp in settings only
}

// Helpers (follow pattern from mort_commands.rs)
fn now_millis() -> u64 { /* SystemTime -> millis */ }
fn load_settings(repo_name: &str) -> Result<serde_json::Value, String> { /* read settings.json */ }
fn save_settings(repo_name: &str, settings: &serde_json::Value) -> Result<(), String> { /* write settings.json */ }
```

**Register in `src-tauri/src/lib.rs`:**
```rust
mod worktree_commands;

// Add to invoke_handler:
worktree_commands::worktree_list,
worktree_commands::worktree_create,
worktree_commands::worktree_delete,
worktree_commands::worktree_rename,
worktree_commands::worktree_touch,
```

**Note on `is_worktree_in_use`:** This requires knowledge of task state. Since tasks are managed in TypeScript (taskService), this check should happen on the frontend before calling `worktree_delete`. The frontend service can query active tasks and check their `worktreePath` field.

---

## Testing Strategy

### Phase T1: Unit Tests for WorktreeManagementService

**New File**: `core/services/worktree/worktree-management-service.test.ts`

Test cases:
1. **Create worktree**
   - Creates git worktree on disk
   - Adds to settings with correct name
   - Sets lastAccessedAt timestamp
   - Rejects duplicate names
   - Rejects invalid characters in name

2. **Delete worktree**
   - Removes git worktree
   - Removes from settings
   - Fails if worktree is claimed
   - Fails if worktree not found

3. **Rename worktree**
   - Updates name in settings
   - Rejects duplicate names
   - Works for unclaimed worktrees

4. **List worktrees**
   - Returns all worktrees
   - Sorted by lastAccessedAt desc

5. **Get available worktrees**
   - Excludes claimed worktrees
   - Sorted by lastAccessedAt desc

6. **Touch (update lastAccessedAt)**
   - Updates timestamp
   - Handles missing worktree gracefully

### Phase T2: Integration Tests for Name Conflict Edge Cases

**New File**: `core/services/worktree/worktree-management-service.integration.test.ts`

Test scenarios requiring real git operations:

1. **Name conflict detection**
   - Create worktree "feature-1"
   - Attempt to create "feature-1" again → Error
   - Attempt to create "FEATURE-1" (case variation) → Error (if filesystem is case-insensitive)

2. **Path collision with orphaned directories**
   - Manually create directory at worktree path
   - Attempt to create worktree with that name → Appropriate error

3. **Concurrent creation**
   - Two processes attempt to create same-named worktree
   - Lock mechanism ensures only one succeeds

4. **Delete with active git operations**
   - Start a long-running git operation in worktree
   - Attempt to delete → Handle gracefully

### Phase T3: Programmatic Testing Utilities

**New File**: `core/services/worktree/test-utils.ts`

```typescript
/**
 * Test fixture for worktree tests.
 * Creates isolated test environment with mock git repo.
 */
export async function createWorktreeTestFixture() {
  const tempDir = await fs.mkdtemp('worktree-test-');

  // Initialize git repo
  await execSync('git init', { cwd: tempDir });
  await execSync('git commit --allow-empty -m "Initial"', { cwd: tempDir });

  // Create mock settings
  const mortDir = path.join(tempDir, '.mort');
  const repoDir = path.join(mortDir, 'repositories', 'test-repo');
  await fs.mkdir(repoDir, { recursive: true });

  return {
    tempDir,
    mortDir,
    repoName: 'test-repo',
    sourcePath: tempDir,
    cleanup: async () => fs.rm(tempDir, { recursive: true }),
  };
}

/**
 * Assert worktree exists with expected properties.
 */
export function assertWorktreeState(
  worktree: WorktreeState,
  expected: Partial<WorktreeState>
): void {
  if (expected.name !== undefined) {
    expect(worktree.name).toBe(expected.name);
  }
  if (expected.path !== undefined) {
    expect(worktree.path).toBe(expected.path);
  }
  if (expected.lastAccessedAt !== undefined) {
    expect(worktree.lastAccessedAt).toBe(expected.lastAccessedAt);
  }
}

/**
 * Simulate concurrent worktree operations.
 */
export async function simulateConcurrentCreate(
  service: WorktreeManagementService,
  repoName: string,
  name: string,
  count: number
): Promise<{ successes: number; failures: string[] }> {
  const promises = Array(count).fill(null).map(() =>
    service.create(repoName, name)
      .then(() => ({ success: true }))
      .catch((e) => ({ success: false, error: e.message }))
  );

  const results = await Promise.all(promises);
  return {
    successes: results.filter(r => r.success).length,
    failures: results.filter(r => !r.success).map(r => r.error),
  };
}
```

---

## Migration Path

### Data Migration

For existing worktrees without names:

```typescript
// In settings migration:
function migrateWorktreeNames(settings: RepositorySettings): void {
  settings.worktrees.forEach((wt, index) => {
    if (!wt.name) {
      // Generate name from path or use default
      wt.name = `worktree-${index + 1}`;
    }
    // Rename lastReleasedAt to lastAccessedAt
    if (wt.lastReleasedAt !== undefined && wt.lastAccessedAt === undefined) {
      wt.lastAccessedAt = wt.lastReleasedAt;
      delete wt.lastReleasedAt;
    }
  });
}
```

### UI Migration

1. Show migration notice in Worktrees tab if unnamed worktrees exist
2. Allow users to rename migrated worktrees

---

## Implementation Order

**Dead code deletion happens FIRST, not last.** This ensures we don't accidentally build on top of deprecated abstractions.

### Phase 0: Delete Dead Code (DO THIS FIRST)

1. **Delete files entirely:**
   ```bash
   rm core/services/worktree/worktree-pool-manager.ts
   rm core/services/worktree/worktree-pool-manager.test.ts
   rm core/services/worktree/allocation-service.ts
   rm core/services/worktree/allocation-service.test.ts
   rm core/services/worktree/branch-manager.ts
   rm core/services/worktree/branch-manager.test.ts
   ```

2. **Remove types from `core/types/repositories.ts`:**
   - Delete `WorktreeClaimSchema` and `WorktreeClaim` type
   - Simplify `WorktreeStateSchema` (remove claim, version, lastTaskId)

3. **Fix all import/compilation errors** - this will reveal every place that depended on the old system

4. **Gut `agents/src/runners/task-runner-strategy.ts`** - remove all allocation logic

5. **Gut `agents/src/orchestration.ts`** - remove pool/allocation references

6. **Run tests** - many will fail; delete tests for deleted code, fix others

### Phase 1: Data Model Updates
- Add `worktreePath` to task and thread metadata schemas
- Add migration for existing worktrees (generate names, convert timestamps)

### Phase 2: WorktreeService (Core)
- Create simple CRUD service (no pooling, no allocation)

### Phase 3: Worktrees Tab UI
- Add tab to main window
- Build worktree list and create/delete UI

### Phase 4: Spotlight Worktree Selection
- Add worktree cycling with arrow keys
- Display selected worktree in results

### Phase 5: Task Creation with Explicit Worktree
- Pass worktreePath through task creation flow
- Update agent spawn to use explicit cwd

### Phase 6: Frontend Service + Tauri Commands
- Create frontend worktree service client
- Add Tauri commands for worktree CRUD

### Phase 7: Testing
- Unit tests for WorktreeService
- Integration tests for edge cases

---

## File Changes Summary

### Files to DELETE (Phase 0 - Do First)

**Delete these files immediately. No review needed—they are dead code.**

```bash
# Core worktree services (entire directory gets gutted)
rm core/services/worktree/worktree-pool-manager.ts      # ~400 lines
rm core/services/worktree/worktree-pool-manager.test.ts # ~300 lines
rm core/services/worktree/allocation-service.ts         # ~350 lines
rm core/services/worktree/allocation-service.test.ts    # ~250 lines
rm core/services/worktree/branch-manager.ts             # ~200 lines
rm core/services/worktree/branch-manager.test.ts        # ~150 lines
```

**Total: 6 files, ~1,650 lines deleted**

### Modified Files (Phase 0 - Gut These)

These files need significant code removal:

| File | What to Remove |
|------|----------------|
| `core/types/repositories.ts` | `WorktreeClaimSchema`, `WorktreeClaim`, fields from `WorktreeStateSchema` |
| `agents/src/runners/task-runner-strategy.ts` | All `WorktreeAllocationService` usage, claiming logic |
| `agents/src/orchestration.ts` | All pool/allocation imports and usage |
| `core/services/repository/settings-service.ts` | Pooling helper methods |
| `src/entities/repositories/types.ts` | `WorktreeClaim` type |
| `src/lib/agent-service.ts` | `no_worktrees_available` error handling |
| `src/components/spotlight/spotlight.tsx` | `no_worktrees_available` error type |

### New Files (Phase 2+)

- `core/services/worktree/worktree-service.ts` - Simple CRUD service (~150 lines)
- `core/services/worktree/worktree-service.test.ts` - Unit tests
- `src/components/main-window/worktrees-page.tsx` - Worktrees tab UI
- `src/entities/worktrees/service.ts` - Frontend service client
- `src-tauri/src/commands/worktree.rs` - Tauri commands

### Modified Files (Phase 1+)

- `core/types/repositories.ts` - Add simplified `WorktreeStateSchema`
- `core/types/tasks.ts` - Add `worktreePath`
- `core/types/threads.ts` - Add `worktreePath`
- `src/components/main-window/main-window-layout.tsx` - Add worktrees tab
- `src/components/main-window/sidebar.tsx` - Add worktrees nav item
- `src/components/spotlight/spotlight.tsx` - Worktree selection state and cycling
- `src/components/spotlight/types.ts` - Extend TaskResult with selectedWorktree
- `src/components/spotlight/results-tray.tsx` - Display selected worktree
- `src/lib/agent-service.ts` - Accept explicit worktreePath
