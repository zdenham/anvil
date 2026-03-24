# Shared CLI Architecture & Storage Format

> **Last Updated**: 2025-12-24 - Fixed ID vs slug confusion, added missing utilities, expanded CLI

## Goal

Create a shared TypeScript architecture where:
1. Agent CLI and UI share the same persistence logic via abstract class
2. CLI writes directly to disk, outputs JSON to stdout
3. Agent streams tool results to app (already in place)
4. App parses tool results and refreshes state accordingly
5. Tasks use folder-based storage format with `metadata.json` + `content.md`

## Current Problems

1. **Duplicate implementations**: Rust CLI and TypeScript UI both write to `.anvil/tasks/`
2. **No code sharing**: Task creation logic duplicated in Rust and TypeScript
3. **Storage format inconsistency**: Flat JSON files vs folder-based structure
4. **Kanban visibility**: Tasks with "draft" status excluded from kanban board

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent (Node.js)                          │
│                                                                 │
│  ┌─────────────┐    ┌─────────────────────────────────────────┐ │
│  │ route skill │───▶│  CLI Tool (TypeScript)                  │ │
│  │ (anvil tasks │    │  - Uses AnvilPersistence (Node adapter)  │ │
│  │  create)    │    │  - Writes to ~/.anvil/tasks/             │ │
│  └─────────────┘    │  - Outputs JSON to stdout               │ │
│                     └──────────────────┬──────────────────────┘ │
│                                        │                        │
│                                        ▼                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  PostToolUse Hook                                           ││
│  │  - Captures tool result (JSON output from CLI)              ││
│  │  - Emits to stdout stream → App                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                    stdout (JSON lines)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri App                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Agent Stream Handler                                       ││
│  │  - Parses tool results                                      ││
│  │  - Detects anvil CLI calls (tasks.create, etc.)              ││
│  │  - Triggers store refresh                                   ││
│  └──────────────────────────┬──────────────────────────────────┘│
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Services (using AnvilPersistence - Tauri adapter)           ││
│  │  - taskService.refreshTask(id) fetches single task from disk││
│  │  - Store upserts/removes task, UI re-renders                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage Format: Folder Structure

Tasks stored as folders with separate metadata and content:

```
.anvil/tasks/
├── fix-login-bug/
│   ├── metadata.json    # TaskMetadata object
│   └── content.md       # Task description/notes (optional)
├── add-dark-mode/
│   ├── metadata.json
│   └── content.md
└── add-dark-mode-1/     # Slug conflict resolution
    └── metadata.json
```

**Benefits**:
- Clear separation of metadata and content
- Human-readable directory names (slug-based)
- Better for large task content (separate markdown files)
- Easier manual inspection/editing of tasks

---

## Utility Functions

```typescript
// core/slug.ts
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")    // Remove non-word chars
    .replace(/\s+/g, "-")         // Replace spaces with hyphens
    .replace(/-+/g, "-")          // Collapse multiple hyphens
    .substring(0, 50);            // Limit length
}

export function resolveSlugConflict(baseSlug: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let counter = 1;
  let slug = `${baseSlug}-${counter}`;
  while (existingSlugs.has(slug)) {
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
  return slug;
}
```

---

## Abstract Persistence Class

```typescript
// core/persistence.ts
import { slugify, resolveSlugConflict } from "./slug.js";

export abstract class AnvilPersistence {
  protected abstract anvilDir: string;

  // Core I/O operations
  abstract read<T>(path: string): Promise<T | null>;
  abstract write(path: string, data: unknown): Promise<void>;
  abstract delete(path: string): Promise<void>;
  abstract list(dir: string): Promise<string[]>;
  abstract listDirs(dir: string): Promise<string[]>;
  abstract exists(path: string): Promise<boolean>;
  abstract mkdir(path: string): Promise<void>;
  abstract rmdir(path: string): Promise<void>;
  abstract writeText(path: string, content: string): Promise<void>;
  abstract readText(path: string): Promise<string | null>;

  // ─────────────────────────────────────────────────────────────
  // Shared task operations (same logic, different I/O)
  // ─────────────────────────────────────────────────────────────

  async createTask(input: CreateTaskInput): Promise<TaskMetadata> {
    const existingSlugs = await this.listTaskSlugs();
    const slug = resolveSlugConflict(slugify(input.title), existingSlugs);
    const now = Date.now();

    const task: TaskMetadata = {
      id: crypto.randomUUID(),
      slug,
      title: input.title,
      description: input.description,
      branchName: `task/${slug}`,
      type: input.type ?? "work",
      status: input.status ?? "draft",
      subtasks: [],
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId ?? null,
      threadIds: [],
      tags: input.tags ?? [],
      sortOrder: now,
      repositoryName: input.repositoryName,
    };

    // Create task directory
    await this.mkdir(`tasks/${slug}`);

    // Write metadata.json
    await this.write(`tasks/${slug}/metadata.json`, task);

    // Write content.md if provided
    if (input.content) {
      await this.writeText(`tasks/${slug}/content.md`, input.content);
    }

    return task;
  }

  async listTasks(): Promise<TaskMetadata[]> {
    const dirs = await this.listDirs("tasks");
    const tasks: TaskMetadata[] = [];

    for (const dir of dirs) {
      const task = await this.read<TaskMetadata>(`tasks/${dir}/metadata.json`);
      if (task) tasks.push(task);
    }

    return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async findTaskBySlug(slug: string): Promise<TaskMetadata | null> {
    return this.read<TaskMetadata>(`tasks/${slug}/metadata.json`);
  }

  async getTaskContent(slug: string): Promise<string | null> {
    return this.readText(`tasks/${slug}/content.md`);
  }

  async updateTask(slug: string, updates: Partial<Omit<TaskMetadata, "id" | "slug" | "createdAt">>): Promise<TaskMetadata> {
    const task = await this.findTaskBySlug(slug);
    if (!task) throw new Error(`Task not found: ${slug}`);

    const updated: TaskMetadata = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.write(`tasks/${slug}/metadata.json`, updated);
    return updated;
  }

  async deleteTask(slug: string): Promise<void> {
    const exists = await this.exists(`tasks/${slug}`);
    if (!exists) throw new Error(`Task not found: ${slug}`);

    // Delete content.md if it exists
    await this.delete(`tasks/${slug}/content.md`);
    // Delete metadata.json
    await this.delete(`tasks/${slug}/metadata.json`);
    // Remove the directory
    await this.rmdir(`tasks/${slug}`);
  }

  async findTaskById(id: string): Promise<TaskMetadata | null> {
    // Must scan all tasks since storage is organized by slug, not id
    const tasks = await this.listTasks();
    return tasks.find(t => t.id === id) ?? null;
  }

  async associateThread(taskSlug: string, threadId: string): Promise<TaskMetadata> {
    const task = await this.findTaskBySlug(taskSlug);
    if (!task) throw new Error(`Task not found: ${taskSlug}`);

    if (!task.threadIds.includes(threadId)) {
      task.threadIds.push(threadId);
      task.updatedAt = Date.now();
      await this.write(`tasks/${task.slug}/metadata.json`, task);
    }

    return task;
  }

  private async listTaskSlugs(): Promise<Set<string>> {
    const dirs = await this.listDirs("tasks");
    return new Set(dirs);
  }
}
```

---

## Platform Implementations

### Node.js (for Agent CLI)

```typescript
// agents/src/lib/persistence-node.ts
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export class NodePersistence extends AnvilPersistence {
  // Default location - can be overridden via constructor or env var
  // Uses ~/Documents/.anvil to match Tauri app's document directory
  protected anvilDir: string;

  constructor(anvilDir?: string) {
    super();
    this.anvilDir = anvilDir ?? process.env.ANVIL_DIR ?? join(homedir(), "Documents", ".anvil");
  }

  async read<T>(path: string): Promise<T | null> {
    const fullPath = join(this.anvilDir, path);
    if (!existsSync(fullPath)) return null;
    return JSON.parse(readFileSync(fullPath, "utf-8"));
  }

  async write(path: string, data: unknown): Promise<void> {
    const fullPath = join(this.anvilDir, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(data, null, 2));
  }

  async delete(path: string): Promise<void> {
    const fullPath = join(this.anvilDir, path);
    if (existsSync(fullPath)) unlinkSync(fullPath);
  }

  async list(dir: string): Promise<string[]> {
    const fullPath = join(this.anvilDir, dir);
    if (!existsSync(fullPath)) return [];
    return readdirSync(fullPath);
  }

  async listDirs(dir: string): Promise<string[]> {
    const fullPath = join(this.anvilDir, dir);
    if (!existsSync(fullPath)) return [];
    return readdirSync(fullPath).filter(name => {
      const stat = statSync(join(fullPath, name));
      return stat.isDirectory();
    });
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(join(this.anvilDir, path));
  }

  async mkdir(path: string): Promise<void> {
    mkdirSync(join(this.anvilDir, path), { recursive: true });
  }

  async rmdir(path: string): Promise<void> {
    const fullPath = join(this.anvilDir, path);
    if (existsSync(fullPath)) rmSync(fullPath, { recursive: true });
  }

  async writeText(path: string, content: string): Promise<void> {
    const fullPath = join(this.anvilDir, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }

  async readText(path: string): Promise<string | null> {
    const fullPath = join(this.anvilDir, path);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
  }
}
```

### Tauri (for UI)

```typescript
// src/lib/persistence-tauri.ts
import { FilesystemClient } from "./filesystem-client";

export class TauriPersistence extends AnvilPersistence {
  protected anvilDir: string;
  private fs = new FilesystemClient();

  constructor(anvilDir: string) {
    super();
    this.anvilDir = anvilDir;
  }

  async read<T>(path: string): Promise<T | null> {
    const fullPath = this.fs.joinPath(this.anvilDir, path);
    if (!(await this.fs.exists(fullPath))) return null;
    return this.fs.readJsonFile<T>(fullPath);
  }

  async write(path: string, data: unknown): Promise<void> {
    const fullPath = this.fs.joinPath(this.anvilDir, path);
    await this.fs.writeJsonFile(fullPath, data);
  }

  // ... implement remaining methods
}
```

---

## CLI Implementation

```typescript
// agents/src/cli/anvil.ts
#!/usr/bin/env node
import { NodePersistence } from "../lib/persistence-node.js";

const persistence = new NodePersistence();
const args = process.argv.slice(2);

// ─────────────────────────────────────────────────────────────
// Argument parsing helpers
// ─────────────────────────────────────────────────────────────

function getArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function requireArg(args: string[], flag: string, name: string): string {
  const value = getArg(args, flag);
  if (!value) {
    throw new Error(`Missing required argument: ${flag} <${name}>`);
  }
  return value;
}

const VALID_TASK_TYPES = ["work", "investigate", "bug", "feature"] as const;
type TaskType = (typeof VALID_TASK_TYPES)[number];

function parseTaskType(value: string | undefined): TaskType | undefined {
  if (!value) return undefined;
  if (!VALID_TASK_TYPES.includes(value as TaskType)) {
    throw new Error(`Invalid task type: ${value}. Valid types: ${VALID_TASK_TYPES.join(", ")}`);
  }
  return value as TaskType;
}

const VALID_STATUSES = ["draft", "backlog", "todo", "in-progress", "done"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];

function parseTaskStatus(value: string | undefined): TaskStatus | undefined {
  if (!value) return undefined;
  if (!VALID_STATUSES.includes(value as TaskStatus)) {
    throw new Error(`Invalid status: ${value}. Valid statuses: ${VALID_STATUSES.join(", ")}`);
  }
  return value as TaskStatus;
}

// ─────────────────────────────────────────────────────────────
// Main CLI
// ─────────────────────────────────────────────────────────────

async function main() {
  const [command, subcommand, ...rest] = args;

  if (command === "tasks") {
    switch (subcommand) {
      case "list": {
        const tasks = await persistence.listTasks();
        console.log(JSON.stringify(tasks));
        break;
      }

      case "create": {
        const title = requireArg(rest, "--title", "title");
        const type = parseTaskType(getArg(rest, "--type"));
        const status = parseTaskStatus(getArg(rest, "--status"));
        const description = getArg(rest, "--description");

        const task = await persistence.createTask({ title, type, status, description });
        // Output slug for app-side refresh (slug is the storage key)
        console.log(JSON.stringify({
          slug: task.slug,
          taskId: task.id,
          branchName: task.branchName,
        }));
        break;
      }

      case "update": {
        const slug = requireArg(rest, "--slug", "slug");
        const updates: Record<string, unknown> = {};

        const title = getArg(rest, "--title");
        if (title) updates.title = title;

        const status = parseTaskStatus(getArg(rest, "--status"));
        if (status) updates.status = status;

        const description = getArg(rest, "--description");
        if (description) updates.description = description;

        const task = await persistence.updateTask(slug, updates);
        console.log(JSON.stringify({ slug: task.slug, taskId: task.id }));
        break;
      }

      case "delete": {
        const slug = requireArg(rest, "--slug", "slug");
        await persistence.deleteTask(slug);
        console.log(JSON.stringify({ deleted: true, slug }));
        break;
      }

      case "associate": {
        const taskSlug = requireArg(rest, "--task", "task-slug");
        const threadId = requireArg(rest, "--thread", "thread-id");
        const updated = await persistence.associateThread(taskSlug, threadId);
        console.log(JSON.stringify({ slug: updated.slug, taskId: updated.id }));
        break;
      }

      default:
        throw new Error(`Unknown subcommand: tasks ${subcommand}`);
    }
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

main().catch(e => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
```

---

## App-Side: Detecting CLI Mutations

```typescript
// src/lib/agent-service.ts (in stdout handler)
function detectAnvilCliResult(output: string) {
  try {
    const result = JSON.parse(output);

    // Handle delete operation (task already removed from disk)
    if (result.deleted && result.slug) {
      taskService.store.removeTaskBySlug(result.slug);
      return;
    }

    // CLI outputs slug (storage key), not taskId
    if (result.slug) {
      // Targeted refresh - fetch just this task from disk
      taskService.refreshTask(result.slug);
    } else if (result.slugs && Array.isArray(result.slugs)) {
      // Bulk operation - refresh each task
      for (const slug of result.slugs) {
        taskService.refreshTask(slug);
      }
    }
  } catch {
    // Not JSON, ignore
  }
}
```

### taskService.refreshTask Implementation

```typescript
// src/entities/tasks/service.ts
// NOTE: Uses slug (not taskId) since tasks are stored by slug
async refreshTask(slug: string): Promise<void> {
  const task = await this.persistence.findTaskBySlug(slug);
  if (task) {
    // Upsert into store - handles both create and update
    this.store.upsertTask(task);
  } else {
    // Task folder was deleted - remove from store by slug
    this.store.removeTaskBySlug(slug);
  }
}
```

---

## Kanban Visibility Fix

### Problem
Tasks created via spotlight have `status: "draft"`, but the kanban only shows: `["backlog", "todo", "in-progress", "done"]`

### Solution
Add "draft" to KANBAN_STATUSES:

```typescript
// src/hooks/use-task-board.ts
const KANBAN_STATUSES: KanbanStatus[] = ["draft", "backlog", "todo", "in-progress", "done"];
```

Update the UI to show a "Draft" column in `src/components/tasks/task-board-kanban.tsx`.

---

## Migration: Flat JSON → Folder Format

One-time migration for existing tasks:

```typescript
async migrateTasksToFolderFormat(): Promise<void> {
  const files = await this.list("tasks");

  for (const file of files) {
    if (file.endsWith(".json")) {
      const task = await this.read<TaskMetadata>(`tasks/${file}`);
      if (task) {
        // Create new folder structure
        await this.mkdir(`tasks/${task.slug}`);
        await this.write(`tasks/${task.slug}/metadata.json`, task);

        // Check for corresponding .md file
        const mdFile = file.replace(".json", ".md");
        const content = await this.readText(`tasks/${mdFile}`);
        if (content) {
          await this.writeText(`tasks/${task.slug}/content.md`, content);
          await this.delete(`tasks/${mdFile}`);
        }

        // Remove old flat file
        await this.delete(`tasks/${file}`);
      }
    }
  }
}
```

---

## File Structure

```
agents/
  src/
    core/                      # Shared persistence layer
      persistence.ts           # Abstract AnvilPersistence class
      types.ts                 # TaskMetadata, CreateTaskInput, etc.
      slug.ts                  # slugify, resolveSlugConflict
    cli/
      anvil.ts                  # CLI entry point
    lib/
      persistence-node.ts      # NodePersistence implementation (extends core)

src/
  lib/
    persistence-tauri.ts       # TauriPersistence implementation (extends core)
  entities/
    tasks/
      service.ts               # Uses TauriPersistence internally
```

> **Note**: The `core/` directory lives inside `agents/` for now. If needed later, it can be extracted to a separate shared package.

---

## Implementation Steps

### Phase 1: Fix Kanban Visibility (Immediate)
1. Add "draft" to `KANBAN_STATUSES` in `src/hooks/use-task-board.ts`
2. Ensure `KanbanStatus` type includes "draft" in `src/entities/tasks/types.ts`
3. Add draft column to kanban UI in `src/components/tasks/task-board-kanban.tsx`

### Phase 2: Create Abstract Persistence Layer
1. Create `core/persistence.ts` with abstract class
2. Create `core/types.ts` with shared types
3. Create `core/slug.ts` with slugify utilities

### Phase 3: Implement Node.js Persistence
1. Create `agents/src/lib/persistence-node.ts`
2. Implement all abstract methods with Node.js fs

### Phase 4: Create TypeScript CLI
1. Create `agents/src/cli/anvil.ts`
2. Implement tasks subcommands
3. Add bin entry to `agents/package.json`
4. Build and test

### Phase 5: Update App Detection
1. Add detection logic in agent stream handler
2. Implement `taskService.refreshTask(id)`
3. Add `store.upsertTask()` and `store.removeTask()` methods

### Phase 6: Migrate UI to Shared Persistence
1. Create `TauriPersistence` implementing abstract class
2. Refactor `taskService` to use it internally
3. Run migration on existing flat JSON tasks

### Phase 7: Cleanup
1. Remove Rust CLI (`src-tauri/src/cli/`)
2. Delete `src/lib/task-store-client.ts` (old implementation)
3. Update route skill if needed

---

## Verification

1. Run migration on existing tasks
2. Verify `.anvil/tasks/` contains folders with `metadata.json` files
3. Create a new task via spotlight
4. Verify new task creates folder structure
5. Navigate to Tasks page → kanban view
6. Verify task appears in "draft" column
7. Drag task to different columns
8. Verify persistence after page reload
9. Run agent CLI commands and verify they use same format

---

## Benefits

- **Single source of truth**: One implementation of task logic
- **Testable**: Mock persistence adapter for unit tests
- **No IPC complexity**: CLI writes directly, app refreshes on detection
- **Consistent pattern**: Same approach works for threads, workspaces, etc.
- **Human-readable storage**: Folder structure easy to inspect/edit manually
