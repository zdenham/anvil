# Unify Simple Tasks and Regular Tasks

## Goal
Make simple tasks and regular tasks derive from the same base type so simple tasks appear on the main kanban board.

## Current Problem
- **Regular tasks** use `TaskMetadataSchema` in `core/types/tasks.ts` with many required fields
- **Simple tasks** use `SimpleTaskMetadataSchema` in `agents/src/runners/simple-runner-strategy.ts` with minimal fields
- Task board uses `TaskMetadataSchema.safeParse()` which fails for simple tasks (missing `slug`, `branchName`, `subtasks`, `parentId`, `tags`, `sortOrder`)

## Requirements
1. Simple tasks appear in kanban columns normally (in-progress, done)
2. Clicking a simple task opens the simple task window
3. Backwards compatible with existing simple task metadata.json files

---

## Implementation Plan

### Step 1: Update Core Schema (`core/types/tasks.ts`)

**branchName null-safety audit:** The `branchName` field changes from `string` to `string | null`. Existing consumers are safe:
- `agents/src/core/persistence.ts` line 191: Only sets branchName during task creation (`task/${slug}`), safe
- `src/entities/tasks/service.ts` line 265: Only sets branchName during creation, safe
- Git operations should check `branchName !== null` before use (simple tasks have `null`)

All existing code paths that read `branchName` for git operations are on regular tasks, where the field is always a string. Simple tasks had no `branchName` field before this change, so any code that would access it was already broken.

Make missing fields optional with sensible defaults. Note: We use `.nullable()` without `.optional()` for fields that the transform guarantees will have a value.

```typescript
export const TaskMetadataSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),                           // NEW: defaults to id via transform
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string().nullable(),                     // CHANGED: nullable (transform ensures non-undefined)
  type: z.enum(["work", "investigate", "simple"]),
  subtasks: z.array(SubtaskSchema).default([]),          // CHANGED: add default
  status: z.enum(["draft", "backlog", "todo", "in-progress", "in-review", "done", "cancelled"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  parentId: z.string().nullable(),                       // Already nullable
  tags: z.array(z.string()).default([]),                 // CHANGED: add default
  sortOrder: z.number().optional(),                      // CHANGED: optional
  repositoryName: z.string().optional(),
  pendingReviews: z.array(PendingReviewSchema).default([]),
  reviewApproved: z.boolean().optional(),
  prUrl: z.string().optional(),
  cwd: z.string().optional(),                            // NEW: for simple tasks
}).transform((data) => ({
  ...data,
  slug: data.slug ?? data.id,                            // Default slug to id for simple tasks
  sortOrder: data.sortOrder ?? data.createdAt,           // Default sortOrder to createdAt
  branchName: data.branchName ?? null,                   // Ensure non-undefined
}));
```

**Important type notes:**
- After the transform, `branchName` will always be `string | null` (never `undefined`)
- This matches `UpdateTaskInput.branchName` which should also be updated to `string | null | undefined`

**Update `UpdateTaskInput` interface:**
```typescript
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  type?: "work" | "investigate" | "simple";
  slug?: string;
  branchName?: string | null;                            // CHANGED: allow null
  status?: TaskStatus;
  subtasks?: Subtask[];
  tags?: string[];
  sortOrder?: number;
  parentId?: string | null;
  repositoryName?: string;
  addPendingReview?: Omit<PendingReview, 'id'>;
  addressPendingReview?: string;
  reviewApproved?: boolean;
  prUrl?: string;
}
```

### Step 2: Update Agent Persistence (`agents/src/core/persistence.ts`)

Update `TaskMetadataOnDiskSchema` to mirror the core schema changes. This schema handles reading from disk with legacy migrations.

```typescript
const TaskMetadataOnDiskSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),                           // NEW: optional for simple tasks
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string().nullable().optional(),          // CHANGED: nullable and optional for simple tasks
  type: z.enum(["work", "investigate", "simple"]),
  subtasks: z.array(SubtaskSchema).optional().default([]),
  status: z.string().transform((status): TaskStatus => {
    if (status in LEGACY_STATUS_MAP) {
      return LEGACY_STATUS_MAP[status];
    }
    if (ALL_VALID_STATUSES.includes(status as TaskStatus)) {
      return status as TaskStatus;
    }
    return "todo";
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
  parentId: z.string().nullable().optional(),            // CHANGED: optional for simple tasks
  tags: z.array(z.string()).optional().default([]),
  sortOrder: z.number().optional(),                      // CHANGED: optional for simple tasks
  repositoryName: z.string().optional(),
  pendingReviews: z.array(PendingReviewSchema).optional().default([]),
  pendingReview: z.object({                              // Legacy migration (keep existing)
    markdown: z.string(),
    defaultResponse: z.string(),
    requestedAt: z.number(),
    onApprove: z.string(),
    onFeedback: z.string(),
  }).optional(),
  reviewApproved: z.boolean().optional(),
  prUrl: z.string().optional(),
  cwd: z.string().optional(),                            // NEW: for simple tasks
}).transform((data) => {
  // Migrate legacy pendingReview (singular) to pendingReviews (array)
  let pendingReviews = data.pendingReviews;
  if (data.pendingReview && pendingReviews.length === 0) {
    pendingReviews = [{
      ...data.pendingReview,
      id: crypto.randomUUID(),
      threadId: 'legacy',
      isAddressed: false,
    }];
  }

  // Return canonical TaskMetadata with computed defaults
  const result: TaskMetadata = {
    id: data.id,
    slug: data.slug ?? data.id,                          // Default to id for simple tasks
    title: data.title,
    description: data.description,
    branchName: data.branchName ?? null,                 // Default to null for simple tasks
    type: data.type,
    subtasks: data.subtasks,
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    parentId: data.parentId ?? null,                     // Default to null
    tags: data.tags,
    sortOrder: data.sortOrder ?? data.createdAt,         // Default to createdAt
    repositoryName: data.repositoryName,
    pendingReviews,
    reviewApproved: data.reviewApproved,
    prUrl: data.prUrl,
    cwd: data.cwd,                                       // NEW: preserve cwd
  };
  return result;
});
```

### Step 3: Update Simple Runner (`agents/src/runners/simple-runner-strategy.ts`)

Remove local `SimpleTaskMetadataSchema` for task metadata and write unified format. Keep `SimpleThreadMetadataSchema` for thread-specific validation.

**In the setup() method, replace the task metadata creation:**

```typescript
// 3. Write task metadata (unified format)
const now = Date.now();
const taskMetadata = {
  id: taskId,
  slug: taskId,                    // Use taskId as slug (simple tasks don't have title-based slugs)
  type: "simple" as const,
  title: prompt.slice(0, 100),     // First 100 chars of prompt as title
  description: prompt,             // IMPORTANT: Preserve full prompt in description
  status: "in-progress" as const,
  cwd,                             // Working directory
  branchName: null,                // No branch for simple tasks
  subtasks: [],
  parentId: null,
  tags: [],
  sortOrder: now,
  createdAt: now,
  updatedAt: now,
  pendingReviews: [],
};

const taskMetadataPath = join(taskPath, "metadata.json");
writeFileSync(taskMetadataPath, JSON.stringify(taskMetadata, null, 2));
```

**In the cleanup() method, update task metadata parsing to use the unified schema:**

Import `TaskMetadataSchema` from core types:
```typescript
import { TaskMetadataSchema } from "@core/types/tasks.js";
```

Update the cleanup parsing logic with fallback error recovery:
```typescript
// 2. Update task metadata
const taskPath = join(threadPath, "..", "..");
const taskMetadataPath = join(taskPath, "metadata.json");
if (existsSync(taskMetadataPath)) {
  const existingContent = readFileSync(taskMetadataPath, "utf-8");
  let jsonContent: unknown;
  try {
    jsonContent = JSON.parse(existingContent);
  } catch (e) {
    emitLog("ERROR", `Failed to parse task metadata JSON: ${e}`);
    jsonContent = null;
  }

  if (jsonContent) {
    const parseResult = TaskMetadataSchema.safeParse(jsonContent);

    if (parseResult.success) {
      const updated = {
        ...parseResult.data,
        status: status === "completed" ? "done" : "cancelled",
        updatedAt: now,
      };
      writeFileSync(taskMetadataPath, JSON.stringify(updated, null, 2));
    } else {
      emitLog("ERROR", `Invalid task metadata during cleanup: ${parseResult.error.message}`);
      // Fallback: write minimal valid metadata to unstick the task
      // This prevents tasks from being stuck in "in-progress" indefinitely
      const fallbackMetadata = {
        id: taskId,
        slug: taskId,
        type: "simple" as const,
        title: "Task (recovered)",
        status: status === "completed" ? "done" : "cancelled",
        branchName: null,
        subtasks: [],
        parentId: null,
        tags: [],
        sortOrder: now,
        createdAt: now,
        updatedAt: now,
        pendingReviews: [],
      };
      writeFileSync(taskMetadataPath, JSON.stringify(fallbackMetadata, null, 2));
      emitLog("WARN", `Wrote fallback metadata for task ${taskId}`);
    }
  }
} else {
  emitLog("WARN", `Task metadata not found during cleanup: ${taskMetadataPath}`);
}
```

**Note on storage path:** Simple tasks use `taskId` as both the folder name and slug. This is consistent because the folder path is `tasks/{taskId}/metadata.json` and `slug = taskId`. Regular tasks use title-based slugs (e.g., `fix-auth-bug`), but lookups by slug will work for both since the slug field matches the folder name in both cases.

### Step 4: Update Click Handler (`src/components/main-window/tasks-page.tsx`)

Route simple task clicks to simple task window. The existing code already retrieves threads, so we just need to add type-based routing:

```typescript
import { TaskBoardPage } from "@/components/tasks/task-board-page";
import { openTask, openSimpleTask } from "@/lib/hotkey-service";
import type { TaskMetadata } from "@/entities/tasks/types";
import { threadService } from "@/entities/threads/service";

export function TasksPage() {
  const handleTaskClick = (task: TaskMetadata) => {
    // Get threads for this task from the store
    const threads = threadService.getByTask(task.id);
    // Use the first thread if available, otherwise use the task ID as a fallback thread ID
    // TODO: Race condition edge case - when a simple task first appears via thread:created event,
    // the thread may exist on disk but not yet be hydrated into the frontend store. If the user
    // clicks immediately, we fall back to using taskId as threadId. The simple task window should
    // handle this gracefully by looking up the thread from disk if needed. This is acceptable for
    // initial implementation; user can click again if the window fails to load.
    const threadId = threads[0]?.id ?? task.id;

    if (task.type === "simple") {
      openSimpleTask(threadId, task.id);
    } else {
      openTask(threadId, task.id);
    }
  };

  return <TaskBoardPage onTaskClick={handleTaskClick} />;
}
```

### Step 5: Update Task Card (`src/components/tasks/task-card.tsx`)

Add visual indicator for simple tasks. Since the unified schema now guarantees arrays have defaults, existing array access (e.g., `task.subtasks.filter(...)`, `task.tags.length`) will work safely.

Add the "Quick" badge after the status badge:

```typescript
{/* Status badge row with phase indicator */}
<div className="flex items-center gap-2 mt-2">
  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusConfig.className}`} data-testid={`task-status-${task.id}`}>
    {statusConfig.label}
  </span>

  {/* Simple task indicator */}
  {task.type === "simple" && (
    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-500/20 text-purple-400">
      Quick
    </span>
  )}

  {/* Review/Merge phase indicator for in-review status */}
  {isInReviewPhase && (
    // ... existing code
  )}
```

**Note on color choice:** Purple is intentionally different from existing status colors to clearly distinguish task type from task status. The existing `STATUS_CONFIG` uses amber, accent, secondary, emerald, and red for statuses.

**Conditional rendering for simple tasks:** Consider hiding UI elements that don't apply to simple tasks to reduce visual noise:
- Subtask count (simple tasks never have subtasks)
- PR link indicator (simple tasks don't create PRs)
- Review/Merge phase indicators (simple tasks don't go through review)

However, the existing code handles these gracefully (empty arrays return `0` for counts, undefined values don't render links), so this is an optional enhancement. The unified schema with defaults ensures no runtime errors from accessing these fields on simple tasks.

---

## Files to Modify

| File | Changes |
|------|---------|
| `core/types/tasks.ts` | Schema changes with defaults, transform, and UpdateTaskInput fix |
| `agents/src/core/persistence.ts` | On-disk schema alignment with full transform |
| `agents/src/runners/simple-runner-strategy.ts` | Write unified format, update cleanup parsing, add description |
| `src/components/main-window/tasks-page.tsx` | Click handler routing with type check |
| `src/components/tasks/task-card.tsx` | Visual indicator for simple tasks |
| `src/entities/tasks/service.ts` | No code changes needed (uses TaskMetadataSchema which auto-updates) |

---

## Migration Strategy

**Approach: Lazy migration on write**

Existing simple task files will be migrated when they are next updated (e.g., on cleanup when task completes). This approach:
1. Avoids complex migration scripts
2. Naturally migrates active tasks
3. Keeps old files readable (the new schema accepts the old format)

**What happens during the transition:**

1. **Reading old simple tasks:** The updated `TaskMetadataOnDiskSchema` with `.optional()` fields and `.default([])` allows parsing old minimal format. The transform fills in computed fields (`slug`, `sortOrder`, `branchName`, etc.) in memory.

2. **Writing updated tasks:** When a simple task's status changes (e.g., via cleanup), the full unified format is written back to disk.

3. **In-memory representation:** After parsing, all tasks have the full `TaskMetadata` shape regardless of what was on disk.

**No eager migration is performed.** Stale simple task files on disk may have the old minimal format until they are next written. This is acceptable because:
- The schema accepts both formats
- The in-memory representation is always complete
- Active tasks will naturally migrate when they complete

---

## Backwards Compatibility

Old simple task format:
```json
{
  "id": "abc123",
  "type": "simple",
  "title": "Fix the bug",
  "status": "in-progress",
  "cwd": "/path/to/repo",
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

After parsing with new schema (via defaults + transform):
```json
{
  "id": "abc123",
  "slug": "abc123",
  "type": "simple",
  "title": "Fix the bug",
  "description": undefined,
  "status": "in-progress",
  "cwd": "/path/to/repo",
  "branchName": null,
  "subtasks": [],
  "parentId": null,
  "tags": [],
  "sortOrder": 1234567890,
  "createdAt": 1234567890,
  "updatedAt": 1234567890,
  "pendingReviews": []
}
```

**Note:** Old simple tasks won't have `description` populated. New simple tasks will have `description: prompt` to preserve the full prompt content.

---

## Testing Requirements

### Unit Tests

**File: `core/types/tasks.test.ts`** (create or update)

```typescript
describe("TaskMetadataSchema", () => {
  it("parses full regular task metadata", () => {
    const input = {
      id: "task-123",
      slug: "fix-auth-bug",
      title: "Fix auth bug",
      branchName: "task/fix-auth-bug",
      type: "work",
      subtasks: [],
      status: "in-progress",
      createdAt: 1234567890,
      updatedAt: 1234567890,
      parentId: null,
      tags: [],
      sortOrder: 1234567890,
      pendingReviews: [],
    };
    const result = TaskMetadataSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses minimal simple task metadata with defaults", () => {
    const input = {
      id: "abc123",
      type: "simple",
      title: "Fix the bug",
      status: "in-progress",
      cwd: "/path/to/repo",
      createdAt: 1234567890,
      updatedAt: 1234567890,
    };
    const result = TaskMetadataSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("abc123");          // defaults to id
      expect(result.data.branchName).toBeNull();        // defaults to null
      expect(result.data.subtasks).toEqual([]);         // defaults to []
      expect(result.data.tags).toEqual([]);             // defaults to []
      expect(result.data.sortOrder).toBe(1234567890);   // defaults to createdAt
      expect(result.data.parentId).toBeNull();          // defaults to null
    }
  });

  it("preserves cwd field for simple tasks", () => {
    const input = {
      id: "abc123",
      type: "simple",
      title: "Fix the bug",
      status: "in-progress",
      cwd: "/path/to/repo",
      createdAt: 1234567890,
      updatedAt: 1234567890,
    };
    const result = TaskMetadataSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cwd).toBe("/path/to/repo");
    }
  });
});
```

**File: `agents/src/core/persistence.test.ts`** (update existing tests)

Add test cases for parsing simple task format through `TaskMetadataOnDiskSchema`.

### Integration Tests

**File: `agents/src/runners/simple-runner-strategy.test.ts`** (update)

```typescript
describe("SimpleRunnerStrategy", () => {
  describe("setup", () => {
    it("writes unified task metadata format", async () => {
      // ... setup test
      const metadataPath = join(anvilDir, "tasks", taskId, "metadata.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

      expect(metadata.slug).toBe(taskId);
      expect(metadata.description).toBe(prompt);       // Full prompt preserved
      expect(metadata.branchName).toBeNull();
      expect(metadata.subtasks).toEqual([]);
      expect(metadata.tags).toEqual([]);
    });
  });

  describe("cleanup", () => {
    it("updates task status using unified schema", async () => {
      // ... setup and run cleanup
      const metadataPath = join(anvilDir, "tasks", taskId, "metadata.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

      expect(metadata.status).toBe("done");
      // Verify all unified fields are preserved
      expect(metadata.slug).toBeDefined();
      expect(metadata.subtasks).toBeDefined();
    });
  });
});
```

### TypeScript Build Verification

Run type checking in all affected packages to catch any type errors introduced by schema changes:

```bash
# Root package
npx tsc --noEmit

# Agents package
cd agents && npx tsc --noEmit

# Core package
cd core && npx tsc --noEmit
```

**Important:** Run this before and after changes to establish a baseline and verify no new type errors are introduced. The `TaskMetadata` type is used throughout the codebase, so schema changes can cascade.

### Manual Verification

1. Create a simple task via spotlight - verify it appears in kanban "in-progress" column
2. Click simple task in kanban - verify simple task window opens (not regular task window)
3. Complete simple task - verify it moves to "done" column
4. Refresh task board - verify existing simple tasks load correctly
5. Create a regular task - verify it still works normally
6. Run existing test suite to ensure no regression for regular tasks

---

## Event Handler Audit

The `thread:created` event emitted by simple tasks:
```typescript
emitEvent("thread:created", {
  threadId,
  taskId,
  agent: "simple",
  cwd,
});
```

**Consumers to verify:**
- Any event handlers that look up task metadata by `taskId` should handle both regular and simple task formats
- Per `docs/patterns/event-bridge.md`, events are signals not data carriers, so handlers should be resilient to schema changes

**Specific files to audit (via `grep -r "eventBus.on"`):**
- `src/entities/events.ts` - defines event types
- Any files that call `eventBus.on("thread:created")` or similar patterns
- Any files that call `eventBus.on("task:updated")` or similar patterns

No changes are expected to be needed for event handlers, but verify during testing that:
- Thread creation events for simple tasks don't cause errors
- Task refresh after thread creation works correctly

---

## Potential Issues

### Performance
Zod transforms run on every parse. For task lists, this is typically <100 tasks, so the overhead is negligible. If performance becomes an issue, consider:
- Caching parsed tasks in memory
- Moving defaults to the store layer instead of schema

### Regular Task `cwd`
The new `cwd` field is optional and only used by simple tasks. Regular tasks could potentially use it to track their worktree path, but this is out of scope for this change. The field will be `undefined` for regular tasks.

### Simple Task Status Constraints
Simple tasks only use three statuses: `in-progress`, `done`, `cancelled`. The schema allows all statuses for type simplicity, so:
- If a simple task is dragged to "draft", "backlog", "todo", or "in-review" columns, the code will allow it
- This is considered acceptable for initial implementation (no runtime errors)
- **TODO:** Consider adding drag-and-drop validation in the future to restrict simple tasks to valid status transitions

### Transform Performance Alternative
If Zod transform performance becomes an issue at scale (unlikely with <100 tasks), an alternative is to move defaults to the persistence layer (after parsing but before returning) rather than in the schema itself. This separates validation from transformation. For now, the schema-based approach is cleaner and sufficient.
