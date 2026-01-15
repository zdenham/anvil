# Task Directory Resolution with Grep-Based Fallback

## Problem Statement

Task and thread paths are dynamic - slugs can change when tasks are renamed (e.g., `draft-abc123` → `fix-auth-bug`). Currently, write operations to tasks or threads often assume the path exists or the slug is correct, which breaks when:

1. A task was renamed and the old slug is cached/stale
2. The frontend and agent runner have different views of the current slug
3. A thread needs to be resumed but its task's directory moved

## Current State Analysis

### Existing Helpers (Frontend)

**`src/entities/tasks/service.ts:144-182`** - `resolveSlug(taskId)`
- Checks if cached slug's `metadata.json` exists
- If stale, scans all task directories to find by ID
- Updates store with correct metadata
- Returns correct slug or null

**`src/entities/threads/service.ts:54-60`** - `findThreadPath(threadId)`
- Uses glob pattern: `tasks/*/threads/*-{threadId}/metadata.json`
- Returns full path to thread directory

**`src/entities/threads/service.ts:64-74`** - `refreshThreadIndex(threadId)`
- Calls `findThreadPath()` and extracts taskId from path
- Updates in-memory index

### Agent Runner Fallback (Partial)

**`agents/src/runner.ts:273-294`**
```typescript
// Has a 3-tier fallback:
// 1. Try persistence.getTaskByIdOrSlug(taskId)
// 2. Check if fallbackTaskDir exists at tasks/{taskId}
// 3. Scan all tasks via persistence.listTasks()
```

This pattern is correct but:
- Not extracted into a reusable helper
- Only handles task lookup, not thread path resolution
- Duplicates logic that exists in frontend

### Missing: No Centralized Service

There is **no shared `findTaskDir` helper** that both frontend and agents can use. The fallback logic is duplicated and inconsistent.

---

## Locations Requiring Grep-Based Fallback

### Critical: Agent Runner (`agents/src/runner.ts`)

| Line | Operation | Current Behavior | Risk |
|------|-----------|------------------|------|
| 305 | `const taskDir = join(args.mortDir, "tasks", taskSlug)` | Constructs path from resolved slug | If slug resolution fails, path is wrong |
| 315 | `const threadPath = join(taskDir, "threads", threadFolderName)` | Depends on taskDir being correct | Cascading failure from above |
| 330-331 | `readFileSync(metadataPath)` | Assumes thread exists at computed path | No fallback if thread moved |
| 403 | `writeFileSync(metadataPath, ...)` | Writes to computed path | Could create orphan if path wrong |
| 604, 624 | Metadata updates on completion/error | Same path assumptions | Same risks |

### Critical: Agent Output (`agents/src/output.ts`)

| Line | Operation | Current Behavior | Risk |
|------|-----------|------------------|------|
| 47 | `statePath = join(threadPath, "state.json")` | Uses threadPath passed from runner | If runner's path is wrong, state.json goes to wrong location |
| 71 | `writeFileSync(statePath, ...)` | Continuous writes to state file | Orphaned state file if path wrong |

### Critical: Agent Persistence (`agents/src/core/persistence.ts`)

| Line | Operation | Current Behavior | Risk |
|------|-----------|------------------|------|
| 92 | `write(tasks/${task.slug}/metadata.json)` | Uses slug from loaded task | Generally safe (slug from disk) |
| 119, 124, 134 | Rename operations | Uses old/new slugs | Safe - explicit rename flow |
| 154 | `updateTaskBySlug(slug)` | Direct slug usage | **No fallback** - caller must provide correct slug |
| 233 | `setTaskContent(slug, content)` | Direct slug usage | **No fallback** - caller must provide correct slug |

### High Priority: Frontend Task Service (`src/entities/tasks/service.ts`)

| Line | Operation | Current Behavior | Risk |
|------|-----------|------------------|------|
| 359 | `writeJson(tasks/${task.slug}/metadata.json)` | Uses slug from store | Could be stale |
| 390 | `removeDir(tasks/${task.slug})` | Uses slug from store | Could delete wrong dir or fail |
| 409, 447 | Content read/write | Uses task.slug | Could be stale |
| 459 | `threadsDir = tasks/${task.slug}/threads` | Uses task.slug | Could be stale |

**Note:** Many of these use `task.slug` from a recently-fetched task object, which is usually correct. The risk is when the in-memory store has stale data.

### High Priority: Frontend Thread Service (`src/entities/threads/service.ts`)

| Line | Operation | Current Behavior | Risk |
|------|-----------|------------------|------|
| 46-50 | `getThreadPath(taskId, ...)` | Uses `getTaskSlug(taskId)` | **Risk:** `getTaskSlug` uses store, could be stale |
| 179-180 | Thread creation | Uses `getThreadPath` | Cascading risk |
| 235-240 | Thread update | Uses `getThreadPath` | Cascading risk |
| 292-297 | Turn addition | Uses computed path | Cascading risk |
| 345-357 | Turn completion | Uses computed path | Cascading risk |
| 418 | Thread deletion | Uses computed path | Could fail or delete wrong thread |

### Medium Priority: Frontend Agent Service (`src/lib/agent-service.ts`)

| Line | Operation | Current Behavior | Risk |
|------|-----------|------------------|------|
| 484 | `fs.joinPath(..., task.slug, ...)` | Constructs state file path | Could be stale slug |

---

## Proposed Solution

### Design Principles

1. **O(1) by default** - Always try the fast path (direct path lookup) first. Only fall back to O(n) directory scan when the fast path fails.

2. **Hint-based resolution** - Callers pass "hint" paths they expect to be correct. If the hint works, no scanning needed. If it fails, automatic fallback.

3. **Adapter pattern** - One shared `ResolutionService` implementation, platform differences isolated to thin `FSAdapter` implementations.

4. **Lazy verification** - Don't verify paths preemptively. Trust the hint, only re-resolve when something fails.

### 1. Adapter Pattern for Platform-Specific Operations

**New file: `core/services/fs-adapter.ts`** (interface only)

```typescript
/**
 * Platform-agnostic filesystem adapter.
 * Implementations: NodeFSAdapter (agents), TauriFSAdapter (frontend)
 */
export interface FSAdapter {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  glob(pattern: string, cwd: string): Promise<string[]>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
}
```

**`agents/src/adapters/node-fs-adapter.ts`**
```typescript
import { FSAdapter } from "../../../core/services/fs-adapter";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { glob } from "glob";

export class NodeFSAdapter implements FSAdapter {
  async exists(path: string) { return existsSync(path); }
  async readFile(path: string) { return readFileSync(path, "utf-8"); }
  async writeFile(path: string, content: string) { writeFileSync(path, content); }
  async readDir(path: string) { return readdirSync(path); }
  async glob(pattern: string, cwd: string) { return glob(pattern, { cwd }); }
  async mkdir(path: string, recursive = true) { mkdirSync(path, { recursive }); }
}
```

**`src/adapters/tauri-fs-adapter.ts`**
```typescript
import { FSAdapter } from "../../core/services/fs-adapter";
import { persistence } from "@/lib/persistence";

export class TauriFSAdapter implements FSAdapter {
  async exists(path: string) { return persistence.exists(path); }
  async readFile(path: string) { return persistence.readText(path); }
  async writeFile(path: string, content: string) { return persistence.writeText(path, content); }
  async readDir(path: string) { return persistence.listDirEntries(path).then(e => e.map(x => x.name)); }
  async glob(pattern: string, cwd: string) { return persistence.glob(pattern, cwd); }
  async mkdir(path: string) { return persistence.createDir(path); }
}
```

### 2. Shared Resolution Service (Single Implementation)

**New file: `core/services/resolution-service.ts`**

```typescript
import { FSAdapter } from "./fs-adapter";
import { TaskResolution, ThreadResolution } from "../types/resolution";
import { join } from "path";

/**
 * Shared resolution logic - same code for both Node.js and Tauri.
 * Platform differences handled by FSAdapter.
 */
export class ResolutionService {
  constructor(
    private fs: FSAdapter,
    private tasksDir: string
  ) {}

  /**
   * Resolve task by ID. O(1) if hintSlug is correct, O(n) fallback otherwise.
   */
  async resolveTask(taskId: string, hintSlug?: string): Promise<TaskResolution | null> {
    // O(1): Try hint first
    if (hintSlug) {
      const result = await this.tryTaskPath(taskId, hintSlug);
      if (result) return result;
    }

    // O(n): Fallback to directory scan
    return this.scanForTask(taskId);
  }

  /**
   * Resolve thread by ID. O(1) if hintPath provided and valid, O(n) glob fallback.
   */
  async resolveThread(threadId: string, hintPath?: string): Promise<ThreadResolution | null> {
    // O(1): Try hint first
    if (hintPath) {
      const metaPath = join(hintPath, "metadata.json");
      if (await this.fs.exists(metaPath)) {
        const meta = JSON.parse(await this.fs.readFile(metaPath));
        if (meta.id === threadId) {
          return this.buildThreadResolution(hintPath, meta);
        }
      }
    }

    // O(n): Fallback to glob
    return this.scanForThread(threadId);
  }

  private async tryTaskPath(taskId: string, slug: string): Promise<TaskResolution | null> {
    const metaPath = join(this.tasksDir, slug, "metadata.json");
    if (!await this.fs.exists(metaPath)) return null;

    const meta = JSON.parse(await this.fs.readFile(metaPath));
    if (meta.id !== taskId) return null;

    return {
      taskId,
      slug,
      taskDir: join(this.tasksDir, slug),
      branchName: meta.branchName,
    };
  }

  private async scanForTask(taskId: string): Promise<TaskResolution | null> {
    const dirs = await this.fs.readDir(this.tasksDir);
    for (const slug of dirs) {
      const result = await this.tryTaskPath(taskId, slug);
      if (result) return result;
    }
    return null;
  }

  private async scanForThread(threadId: string): Promise<ThreadResolution | null> {
    const pattern = `*/threads/*-${threadId}/metadata.json`;
    const matches = await this.fs.glob(pattern, this.tasksDir);
    if (matches.length === 0) return null;

    const metaPath = join(this.tasksDir, matches[0]);
    const meta = JSON.parse(await this.fs.readFile(metaPath));
    return this.buildThreadResolution(join(this.tasksDir, matches[0].replace("/metadata.json", "")), meta);
  }

  private buildThreadResolution(threadDir: string, meta: any): ThreadResolution {
    // Extract taskSlug from path: tasks/{taskSlug}/threads/{threadFolder}
    const parts = threadDir.split("/");
    const threadsIdx = parts.indexOf("threads");
    const taskSlug = parts[threadsIdx - 1];

    return {
      threadId: meta.id,
      taskId: meta.taskId,
      taskSlug,
      threadDir,
      agentType: meta.agentType,
    };
  }
}
```

### 3. Integration Pattern

The key insight: **pass hint paths through the call chain, let the writer handle fallback.**

#### Runner (`agents/src/runner.ts`)

```typescript
// At startup: create resolution service and writer
const fsAdapter = new NodeFSAdapter();
const resolution = new ResolutionService(fsAdapter, join(args.mortDir, "tasks"));
const threadWriter = new ThreadWriter(resolution, fsAdapter, args.threadId);

// Resolve task with hint from args (O(1) if hint correct)
const taskResolution = await resolution.resolveTask(args.taskId, args.taskSlug);
if (!taskResolution) {
  throw new Error(`Task not found: ${args.taskId}`);
}
const taskDir = taskResolution.taskDir;

// Compute expected thread path (used as hint)
const expectedThreadPath = join(taskDir, "threads", threadFolderName);

// Write metadata - pass hint, fallback is automatic
await threadWriter.writeMetadata(metadata, expectedThreadPath);
```

#### Output (`agents/src/output.ts`)

```typescript
// Receive writer from runner instead of raw path
export function initState(writer: ThreadWriter, hintPath: string) {
  // Use hint for fast path, writer handles fallback
  return {
    updateState: async (state: ThreadState) => {
      await writer.writeState(state, hintPath);
    }
  };
}
```

#### Thread Service (`src/entities/threads/service.ts`)

```typescript
// Add optional hint parameter
async function getThreadPath(
  taskId: string,
  agentType: string,
  threadId: string,
  hintSlug?: string  // Optional: try this slug first
): Promise<string> {
  const slug = hintSlug ?? getTaskSlug(taskId);
  if (slug) {
    const directPath = `${TASKS_DIR}/${slug}/threads/${getThreadFolderName(agentType, threadId)}`;
    if (await persistence.exists(`${directPath}/metadata.json`)) {
      return directPath;
    }
  }

  // Fallback to glob search
  const found = await findThreadPath(threadId);
  if (found) return found;

  throw new Error(`Thread not found: ${threadId}`);
}
```

---

## Files to Modify

### New Files (Shared Core)
- `core/types/resolution.ts` - TaskResolution, ThreadResolution types
- `core/services/fs-adapter.ts` - FSAdapter interface
- `core/services/resolution-service.ts` - Shared resolution logic (single implementation)

### New Files (Platform Adapters)
- `agents/src/adapters/node-fs-adapter.ts` - Node.js FSAdapter implementation
- `src/adapters/tauri-fs-adapter.ts` - Tauri FSAdapter implementation

### New Files (Services)
- `agents/src/services/thread-writer.ts` - Optimistic write with lazy fallback

### Modified Files
- `agents/src/runner.ts` - Use ResolutionService + ThreadWriter
- `agents/src/output.ts` - Receive ThreadWriter, use for state.json
- `agents/src/core/persistence.ts` - Migrate slug-based APIs to ID-based
- `src/entities/tasks/service.ts` - Use resolution for writes
- `src/entities/threads/service.ts` - Add hint path support to getThreadPath
- `src/lib/agent-service.ts` - Use resolution for state file path

---

## Testing Strategy

1. **Unit tests for resolution service:**
   - Task found at expected slug
   - Task found after rename (different slug)
   - Task not found
   - Thread found via glob
   - Thread not found

2. **Integration tests:**
   - Create task → rename → resume thread (should find moved task)
   - Concurrent rename during thread execution
   - Delete task while thread running (graceful failure)

3. **Manual testing:**
   - Rename task in frontend while agent running
   - Resume thread after task rename
   - Verify state.json written to correct location after rename

---

## Risk Mitigation

1. **Performance:** Glob-based lookup is slower than direct path. Mitigate with:
   - Try direct path first, fallback only on failure
   - Cache successful resolutions (with TTL)
   - Batch operations where possible

2. **Race conditions:** Task could be renamed during operation. Mitigate with:
   - Re-resolve before final write
   - Use task ID as source of truth, not slug
   - Consider file locking for critical operations

3. **Backwards compatibility:** Old code might pass slugs instead of IDs. Mitigate with:
   - `resolveTaskSlug` accepts both ID and slug
   - Graceful fallback when slug passed

---

## Audit: Slug-Based Lookups to Remove

**Principle:** All lookups MUST use task ID. Slugs are derived/display-only values that can change. The ID is the stable identifier.

### Functions to Deprecate/Remove

| File | Function | Current Signature | Action |
|------|----------|-------------------|--------|
| `agents/src/core/persistence.ts:142` | `updateTaskBySlug` | `(slug: string, updates)` | **REMOVE** - use `updateTask(id, updates)` |
| `agents/src/core/persistence.ts:174` | `deleteTaskBySlug` | `(slug: string)` | **REMOVE** - use `deleteTask(id)` |
| `agents/src/core/persistence.ts:218` | `findTaskBySlug` | `(slug: string)` | **KEEP INTERNAL** - used only by rename flow |
| `agents/src/core/persistence.ts:225` | `getTaskContent` | `(slug: string)` | **CHANGE** to `(taskId: string)` |
| `agents/src/core/persistence.ts:232` | `setTaskContent` | `(slug: string, content)` | **CHANGE** to `(taskId: string, content)` |
| `agents/src/core/persistence.ts:239` | `associateThread` | `(taskSlug: string, threadId)` | **CHANGE** to `(taskId: string, threadId)` |
| `src/entities/tasks/service.ts:77` | `refreshTaskBySlug` | `(slug: string)` | **KEEP** - file watcher uses slug from filesystem event |
| `src/entities/tasks/service.ts:195` | `handleRemoteDeleteBySlug` | `(slug: string)` | **KEEP** - file watcher uses slug from filesystem event |
| `src/entities/tasks/service.ts:528` | `findBySlug` | `(slug: string)` | **KEEP** - internal lookup only |

### Callers Passing Slugs (Must Change to ID)

| File | Line | Current Call | Change To |
|------|------|--------------|-----------|
| `agents/src/cli/mort.ts:388` | `persistence.findTaskBySlug(slug)` | User CLI input - acceptable |
| `agents/src/cli/mort.ts:399` | `persistence.getTaskContent(task.slug)` | `getTaskContent(task.id)` |
| `agents/src/runner.ts:305` | `join(args.mortDir, "tasks", taskSlug)` | Use resolution service |

### File Watcher Exceptions

The following use slugs legitimately because they're triggered by filesystem events that only know the directory name:
- `refreshTaskBySlug` - called from file watcher with directory name
- `handleRemoteDeleteBySlug` - called from file watcher with directory name

---

## Unified Thread Resolution Type

**New file: `core/types/resolution.ts`** (shared between frontend and agents)

```typescript
/**
 * Result of resolving a task by ID.
 */
export interface TaskResolution {
  /** The task's unique ID (stable, never changes) */
  taskId: string;
  /** Current slug (directory name, may change on rename) */
  slug: string;
  /** Full path to task directory */
  taskDir: string;
  /** Git branch name for this task */
  branchName: string;
}

/**
 * Result of resolving a thread by ID.
 */
export interface ThreadResolution {
  /** The thread's unique ID */
  threadId: string;
  /** Parent task's ID */
  taskId: string;
  /** Parent task's current slug */
  taskSlug: string;
  /** Full path to thread directory */
  threadDir: string;
  /** Agent type (e.g., "work", "planning") */
  agentType: string;
}

/**
 * Service interface for resolving task and thread paths.
 *
 * Implementations:
 * - `agents/src/services/task-resolution-node.ts` - Node.js (fs + directory scan)
 * - `src/services/task-resolution-tauri.ts` - Tauri (IPC to Rust backend)
 */
export interface ResolutionService {
  /**
   * Resolve a task by ID. Returns null if not found.
   * Uses fast path (check expected location) with fallback (scan all tasks).
   */
  resolveTask(taskId: string): Promise<TaskResolution | null>;

  /**
   * Resolve a thread by ID. Returns null if not found.
   * Uses glob pattern: tasks/*/threads/*-{threadId}/metadata.json
   */
  resolveThread(threadId: string): Promise<ThreadResolution | null>;

  /**
   * Check if a path exists (for fast-path validation).
   */
  exists(path: string): Promise<boolean>;
}
```

---

## Audit: Uncontrolled Writes Bypassing Helpers

**Principle:** ALL file writes to task/thread directories MUST go through a dedicated service that handles resolution. No stray `writeFileSync` or direct `persistence.writeJson` calls.

### Critical: Direct `writeFileSync` in Agent Runner

| File | Line | Current Code | Issue |
|------|------|--------------|-------|
| `agents/src/runner.ts:65` | `writeFileSync(wrapperPath, ...)` | **OK** - bin directory, not task data |
| `agents/src/runner.ts:354` | `mkdirSync(threadPath, ...)` | Uses computed path without verification |
| `agents/src/runner.ts:403` | `writeFileSync(metadataPath, ...)` | **CRITICAL** - thread metadata with unverified path |
| `agents/src/runner.ts:434` | `writeFileSync(additionalInstructionsPath, ...)` | **OK** - debug file, dev mode only |
| `agents/src/runner.ts:604` | `writeFileSync(metadataPath, ...)` | **CRITICAL** - completion metadata |
| `agents/src/runner.ts:624` | `writeFileSync(metadataPath, ...)` | **CRITICAL** - error metadata |

### Critical: Direct `writeFileSync` in Output

| File | Line | Current Code | Issue |
|------|------|--------------|-------|
| `agents/src/output.ts:71` | `writeFileSync(statePath, ...)` | **CRITICAL** - state.json with path from runner |

### Problematic Pattern in Output Module

The `output.ts` module receives `threadPath` from runner and writes to it continuously. If runner's path resolution is wrong, ALL state writes go to wrong location.

**Current flow:**
```
runner.ts → computes threadPath → passes to initState() → output.ts writes to it
```

**Proposed flow:**
```
runner.ts → resolves threadPath via service → passes to initState() → output.ts writes to it
                                          ↓
                             service verifies path exists
```

### Frontend Writes Through `persistence` (Lower Risk)

These use `persistence.writeJson` which is safer but still doesn't verify paths:

| File | Line | Path Construction | Risk |
|------|------|-------------------|------|
| `src/entities/tasks/service.ts:273` | `${TASKS_DIR}/${task.slug}/metadata.json` | Uses in-memory task.slug |
| `src/entities/tasks/service.ts:324` | `${TASKS_DIR}/${task.slug}/metadata.json` | Uses in-memory task.slug |
| `src/entities/tasks/service.ts:359` | `${TASKS_DIR}/${task.slug}/metadata.json` | Uses in-memory task.slug |
| `src/entities/tasks/service.ts:447` | `${TASKS_DIR}/${task.slug}/content.md` | Uses in-memory task.slug |
| `src/entities/threads/service.ts:180` | `${threadPath}/metadata.json` | Uses computed threadPath |
| `src/entities/threads/service.ts:240` | `metadataPath` | Uses computed threadPath |
| `src/entities/threads/service.ts:297` | `metadataPath` | Uses computed threadPath |
| `src/entities/threads/service.ts:357` | `metadataPath` | Uses computed threadPath |
| `src/lib/agent-service.ts:484` | `fs.joinPath(..., task.slug, ...)` | Uses in-memory task.slug |

### Solution: Optimistic Write with Lazy Fallback

**Principle:** Default to O(1) operations. Only fall back to O(n) scan when the fast path fails.

**New pattern for agents (`agents/src/services/thread-writer.ts`):**

```typescript
import { ResolutionService } from "../../../core/services/resolution-service";
import { ThreadResolution } from "../../../core/types/resolution";
import { FSAdapter } from "../../../core/services/fs-adapter";
import { join } from "path";

export class ThreadWriter {
  private cachedPath: string | null = null;

  constructor(
    private resolution: ResolutionService,
    private fs: FSAdapter,
    private threadId: string
  ) {}

  /**
   * Write to thread directory. O(1) if hintPath valid, O(n) fallback on failure.
   *
   * @param filename - File to write (e.g., "metadata.json", "state.json")
   * @param content - Content to write
   * @param hintPath - Optional path hint (try this first)
   */
  async write(filename: string, content: string, hintPath?: string): Promise<string> {
    const pathToTry = hintPath ?? this.cachedPath;

    // O(1): Try hint/cached path first
    if (pathToTry) {
      const filePath = join(pathToTry, filename);
      try {
        // Verify directory exists before writing
        if (await this.fs.exists(pathToTry)) {
          await this.fs.writeFile(filePath, content);
          this.cachedPath = pathToTry;
          return filePath;
        }
      } catch {
        // Fall through to resolution
      }
    }

    // O(n): Fallback - resolve and retry
    const resolved = await this.resolution.resolveThread(this.threadId, pathToTry);
    if (!resolved) {
      throw new Error(`Thread not found: ${this.threadId}`);
    }

    // Log if path changed (task was renamed)
    if (pathToTry && resolved.threadDir !== pathToTry) {
      console.error(`[ThreadWriter] Path changed: ${pathToTry} → ${resolved.threadDir}`);
    }

    const filePath = join(resolved.threadDir, filename);
    await this.fs.writeFile(filePath, content);
    this.cachedPath = resolved.threadDir;
    return filePath;
  }

  /** Convenience: write metadata.json */
  async writeMetadata(metadata: object, hintPath?: string): Promise<string> {
    return this.write("metadata.json", JSON.stringify(metadata, null, 2), hintPath);
  }

  /** Convenience: write state.json */
  async writeState(state: object, hintPath?: string): Promise<string> {
    return this.write("state.json", JSON.stringify(state), hintPath);
  }

  /** Get current cached path (may be stale) */
  getCachedPath(): string | null {
    return this.cachedPath;
  }
}
```

**Key differences from previous approach:**
1. **No per-write verification** - Only resolves when write fails or no hint provided
2. **Hint parameter** - Caller can pass expected path, used for O(1) fast path
3. **Cached path** - After first successful write, caches path for subsequent writes
4. **Lazy fallback** - Resolution only happens when needed, not preemptively

---

## Updated Implementation Plan

### Phase 1: Foundation (Types + Adapters)
1. Create `core/types/resolution.ts` with unified types
2. Create `core/services/fs-adapter.ts` interface
3. Implement `agents/src/adapters/node-fs-adapter.ts`
4. Implement `src/adapters/tauri-fs-adapter.ts`

### Phase 2: Resolution Service
1. Create `core/services/resolution-service.ts` (shared implementation)
2. Wire up in agents: instantiate with NodeFSAdapter
3. Wire up in frontend: instantiate with TauriFSAdapter
4. Add unit tests (can test with mock adapter)

### Phase 3: Migrate Slug-Based APIs to ID-Based
**Now possible because resolution service exists to translate ID → slug**
1. Change `getTaskContent(slug)` → `getTaskContent(taskId)` - uses resolution internally
2. Change `setTaskContent(slug, content)` → `setTaskContent(taskId, content)`
3. Change `associateThread(taskSlug, threadId)` → `associateThread(taskId, threadId)`
4. Deprecate `updateTaskBySlug`, `deleteTaskBySlug` - add `@deprecated` and migrate callers
5. Update all callers to pass IDs

### Phase 4: ThreadWriter Integration (Agents)
1. Create `agents/src/services/thread-writer.ts`
2. Update `runner.ts` - pass hint paths to writer, use cached paths
3. Update `output.ts` - receive writer instance, use for state.json writes
4. Replace direct `writeFileSync` calls with writer methods

### Phase 5: Frontend Write Path Updates
1. Update `src/entities/tasks/service.ts` - use resolution before writes
2. Update `src/entities/threads/service.ts` - add hint path to getThreadPath
3. Update `src/lib/agent-service.ts` - use resolution for state file path

### Phase 6: Cleanup
1. Remove deprecated slug-based functions (after migration complete)
2. Add integration tests for rename-during-execution scenario
3. Document the resolution pattern for future contributors
