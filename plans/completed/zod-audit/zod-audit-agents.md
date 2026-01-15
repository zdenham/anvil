# Zod Audit: agents/src/

**Date:** 2026-01-07 (Revised: 2026-01-07)
**Pattern Reference:** `docs/patterns/zod-boundaries.md`

## Summary

The `agents/src/` directory currently has **no Zod usage**. This audit identifies which types should use Zod validation (data from trust boundaries) and which should remain as plain TypeScript types.

**Key Finding:** The codebase correctly avoids Zod for internal types, interfaces with methods, and callback signatures. However, there are opportunities to add Zod validation at trust boundaries where external data is read.

**Important:** When adding Zod schemas, always use `z.infer<typeof Schema>` to derive types. Never maintain duplicate TypeScript interfaces alongside Zod schemas - the schema is the single source of truth.

### Audit Statistics

| Category | Count |
|----------|-------|
| Files reviewed | 47 |
| Types that SHOULD use Zod | 5 data types across 4 files |
| Types incorrectly using Zod | 0 (none currently using Zod) |
| Types correctly using plain TypeScript | ~30+ types |

---

## Types That SHOULD Use Zod

These types represent data loaded from disk, parsed from external sources, or received via IPC. They should use Zod for runtime validation.

### 1. `core/types/tasks.ts` (Source of Truth)

**Current State:** Plain TypeScript interfaces without Zod.
```typescript
export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface PendingReview {
  id: string;
  threadId: string;
  markdown: string;
  defaultResponse: string;
  requestedAt: number;
  onApprove: string;
  onFeedback: string;
  isAddressed: boolean;
}

export interface TaskMetadata {
  id: string;
  slug: string;
  title: string;
  description?: string;
  branchName: string;
  type: "work" | "investigate" | "simple";
  subtasks: Subtask[];
  status: TaskStatus;
  // ... more fields
}
```

**Why Zod is needed:** `TaskMetadata` is read from `metadata.json` files on disk by multiple consumers (persistence, workspace, tests). Data could be corrupted, manually edited, or from an older schema version.

**Recommended Change:**
```typescript
import { z } from "zod";

// Define schemas first - these are the source of truth
export const SubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});

export const PendingReviewSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  markdown: z.string(),
  defaultResponse: z.string(),
  requestedAt: z.number(),
  onApprove: z.string(),
  onFeedback: z.string(),
  isAddressed: z.boolean(),
});

export const TaskMetadataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string(),
  type: z.enum(["work", "investigate", "simple"]),
  subtasks: z.array(SubtaskSchema),
  status: z.enum(["draft", "backlog", "todo", "in-progress", "in-review", "done", "cancelled"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  parentId: z.string().nullable(),
  tags: z.array(z.string()),
  sortOrder: z.number(),
  repositoryName: z.string().optional(),
  pendingReviews: z.array(PendingReviewSchema),
  reviewApproved: z.boolean().optional(),
  prUrl: z.string().optional(),
});

// Derive types from schemas - NO DUPLICATE INTERFACES
export type Subtask = z.infer<typeof SubtaskSchema>;
export type PendingReview = z.infer<typeof PendingReviewSchema>;
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
```

**Anti-pattern to avoid:**
```typescript
// BAD: Duplicate type alongside schema
const TaskMetadataSchema = z.object({ ... });
interface TaskMetadata { ... }  // REDUNDANT - will drift out of sync

// GOOD: Single source of truth
const TaskMetadataSchema = z.object({ ... });
type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
```

---

### 2. `agents/src/runners/simple-runner-strategy.ts`

**Current State:**
```typescript
interface SimpleTaskMetadata {
  id: string;
  threadId: string;
  prompt: string;
  cwd: string;
  status: "running" | "complete" | "error";
  createdAt: number;
  updatedAt: number;
  error?: string;
}

// In cleanup() at line 206:
metadata = JSON.parse(existingContent) as SimpleTaskMetadata;
```

**Why Zod is needed:** This metadata is read from disk (`simple-tasks/{threadId}/metadata.json`) and could be corrupted, manually edited, or from an older schema version.

**Recommended Change:**
```typescript
import { z } from "zod";

const SimpleTaskMetadataSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "complete", "error"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  error: z.string().optional(),
});

// DELETE the interface - use z.infer instead
type SimpleTaskMetadata = z.infer<typeof SimpleTaskMetadataSchema>;

// Then in cleanup():
const existingContent = readFileSync(metadataPath, "utf-8");
const metadata = SimpleTaskMetadataSchema.parse(JSON.parse(existingContent));
```

---

### 3. `agents/src/lib/workspace.ts`

**Current State:**
```typescript
import type { TaskMetadata } from "../core/types.js";
export type Task = TaskMetadata;

// In readTasksDirectory() at line 35:
const task = JSON.parse(content) as Task;
```

**Why Zod is needed:** Task metadata is loaded from disk and could be corrupted or from an older version.

**Recommended Change:** Once `TaskMetadataSchema` exists in `core/types/tasks.ts`:

```typescript
import { TaskMetadataSchema, type TaskMetadata } from "../core/types.js";

export type Task = TaskMetadata;

// In readTasksDirectory():
const content = readFileSync(filePath, "utf-8");
const parseResult = TaskMetadataSchema.safeParse(JSON.parse(content));
if (parseResult.success) {
  tasks.push(parseResult.data);
} else {
  logger.error(`Failed to parse task file ${file}:`, parseResult.error);
}
```

---

### 4. `agents/src/lib/persistence-node.ts`

**Current State:**
```typescript
async read<T>(path: string): Promise<T | null> {
  const content = readFileSync(fullPath, "utf-8");
  return JSON.parse(content) as T;  // Line 38 - unsafe cast
}
```

**Why Zod is needed:** The generic `read<T>()` method does unsafe casts. Callers like `agents/src/core/persistence.ts` rely on this method to read task metadata.

**Recommended Change:** Two options:

**Option A:** Add schema-aware read method:
```typescript
async readValidated<T>(path: string, schema: z.ZodSchema<T>): Promise<T | null> {
  const content = readFileSync(fullPath, "utf-8");
  return schema.parse(JSON.parse(content));
}
```

**Option B:** Validate at call sites (preferred - schema stays with domain):
```typescript
// In persistence.ts listTasks():
const raw = await this.read<unknown>(`${TASKS_DIR}/${dir}/metadata.json`);
if (raw) {
  const task = TaskMetadataSchema.parse(raw);
  tasks.push(this.normalizeTask(task));
}
```

---

### 5. `agents/src/output.ts`

**Current State:**
```typescript
export function relayEventsFromToolOutput(toolOutput: string): void {
  // Manual validation at lines 244-251
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed.type === "event" &&
    typeof parsed.name === "string" &&
    parsed.payload &&
    typeof parsed.payload === "object"
  ) {
    stdout(parsed);
  }
}
```

**Why Zod could help:** This is parsing external tool output that could be malformed. The current manual validation is verbose and could miss edge cases.

**Recommended Change (optional improvement):**
```typescript
import { z } from "zod";

const ToolEventSchema = z.object({
  type: z.literal("event"),
  name: z.string(),
  payload: z.record(z.unknown()),
});

type ToolEvent = z.infer<typeof ToolEventSchema>;

// In relayEventsFromToolOutput:
const result = ToolEventSchema.safeParse(parsed);
if (result.success) {
  stdout(result.data);
}
```

---

### 6. `agents/src/core/persistence.ts` (MortPersistence class)

**Current State:**
```typescript
async listTasks(): Promise<TaskMetadata[]> {
  for (const dir of dirs) {
    const task = await this.read<TaskMetadata>(`${TASKS_DIR}/${dir}/metadata.json`);
    if (task) tasks.push(this.normalizeTask(task));
  }
}
```

**Why Zod is needed:** The `read<T>()` method returns unvalidated JSON parsed from disk. The `normalizeTask()` method attempts to handle legacy data, but Zod would provide cleaner validation.

**Recommended Change:** Use `TaskMetadataSchema` with transforms for migrations:

```typescript
import { TaskMetadataSchema } from "./types.js";

// Define a lenient schema for reading that handles migrations
const TaskMetadataOnDiskSchema = TaskMetadataSchema.extend({
  // Accept legacy status values and transform them
  status: z.string().transform((status) => {
    const legacyMap: Record<string, string> = {
      "complete": "done",
      "completed": "done",
      "in_progress": "in-progress",
      "pending": "todo",
    };
    return legacyMap[status] ?? status;
  }),
}).transform((data) => ({
  ...data,
  tags: data.tags ?? [],
  subtasks: data.subtasks ?? [],
  pendingReviews: data.pendingReviews ?? [],
}));

async listTasks(): Promise<TaskMetadata[]> {
  for (const dir of dirs) {
    const raw = await this.read<unknown>(`${TASKS_DIR}/${dir}/metadata.json`);
    if (raw) {
      const result = TaskMetadataOnDiskSchema.safeParse(raw);
      if (result.success) {
        tasks.push(result.data);
      } else {
        logger.error(`[persistence] Invalid task in ${dir}:`, result.error);
      }
    }
  }
}
```

This replaces the manual `normalizeTask()` method with declarative Zod transforms.

---

## Types Correctly Using Plain TypeScript

These types correctly avoid Zod because they describe code structure, not external data.

### agent-types/

| File | Types | Reason |
|------|-------|--------|
| `index.ts` | `AgentConfig` | Internal interface, describes config objects constructed in code |
| `merge-types.ts` | `MergeContext`, `WorkflowMode` | Internal interfaces passed between functions |

### runners/

| File | Types | Reason |
|------|-------|--------|
| `types.ts` | `AgentType`, `RunnerConfig`, `OrchestrationContext`, `RunnerStrategy` | Internal interfaces and function signatures |
| `shared.ts` | `AgentLoopOptions` | Callback interface with function types |
| `task-runner-strategy.ts` | `CleanupState` | Internal tracking state, never persisted |

### validators/

| File | Types | Reason |
|------|-------|--------|
| `types.ts` | `ValidationResult`, `ValidationContext`, `AgentValidator` | Interfaces with methods, internal code structure |

### lib/

| File | Types | Reason |
|------|-------|--------|
| `workspace.ts` | `GitState` | Simple internal type returned by function |
| `logger.ts` | `LogLevel` | Simple type alias |
| `timeout.ts` | `TimeoutError` | Error class (code structure) |
| `events.ts` | (re-exports from core) | Type re-exports |

### core/types/

| File | Types | Reason |
|------|-------|--------|
| `events.ts` | `FileChange`, `ResultMetrics`, `ToolExecutionState`, `ThreadState`, `AgentEventMessage`, `AgentStateMessage`, `AgentLogMessage` | These are emitted from our code, not read from external sources. The agent process constructs and emits these - consumers trust the producer. |

### Other files

| File | Types | Reason |
|------|-------|--------|
| `context.ts` | `EnvironmentContext`, `GitContext`, `TaskContext` | Internal interfaces built from runtime data (not external JSON) |
| `git.ts` | `ChangedFile` | Internal interface returned by functions |
| `orchestration.ts` | `RunnerArgs`, `OrchestrationResult` | Internal interfaces for function params/returns |
| `output.ts` | (re-exports from core) | Type re-exports |
| `services/thread-writer.ts` | `ThreadWriter` class | Code structure with methods |
| `adapters/node-fs-adapter.ts` | `NodeFSAdapter` class | Adapter pattern with methods |
| `testing/types.ts` | `AgentRunOutput`, `AgentTestOptions` | Test infrastructure types (constructed in code, not read from disk) |
| `testing/runner-config.ts` | `RunnerConfig` | Test config interface with function types |
| `testing/assertions.ts` | `AgentAssertions` class | Assertion builder pattern |

---

## Implementation Checklist

Priority order based on risk of data corruption and dependency order:

### Phase 1: Core Types (High Priority)

- [ ] **`core/types/tasks.ts`** - Source of truth for task types
  - Add `zod` as a dependency to the `core` package (if not already)
  - Define `SubtaskSchema`, `PendingReviewSchema`, `TaskMetadataSchema`
  - **DELETE** the existing `interface` declarations
  - Replace with `type X = z.infer<typeof XSchema>`
  - Keep `CreateTaskInput` and `UpdateTaskInput` as plain TypeScript (not persisted)
  - Keep `generateTaskId()` function unchanged
  - Export both schemas and types

### Phase 2: Consumers (High Priority)

- [ ] **`agents/src/core/persistence.ts`**
  - Import `TaskMetadataSchema` from `./types.js`
  - Create `TaskMetadataOnDiskSchema` with transforms for legacy migrations
  - Update `listTasks()` to use `safeParse()` instead of type cast
  - **DELETE** the `normalizeTask()` method (replaced by Zod transforms)
  - Update `getTask()`, `findTaskBySlug()` similarly

- [ ] **`agents/src/lib/workspace.ts`**
  - Import `TaskMetadataSchema` from `../core/types.js`
  - Update `readTasksDirectory()` to use `safeParse()`
  - Log validation errors with `logger.error()`

- [ ] **`agents/src/lib/persistence-node.ts`**
  - No changes needed to `read<T>()` - validation happens at call sites
  - (Optional) Add `readValidated<T>(path, schema)` method for convenience

### Phase 3: Strategy-Specific (Medium Priority)

- [ ] **`agents/src/runners/simple-runner-strategy.ts`**
  - Add `SimpleTaskMetadataSchema` (local to this file)
  - **DELETE** the `interface SimpleTaskMetadata` declaration
  - Replace with `type SimpleTaskMetadata = z.infer<typeof SimpleTaskMetadataSchema>`
  - Update `cleanup()` to use `SimpleTaskMetadataSchema.parse()`

### Phase 4: Optional Improvements (Low Priority)

- [ ] **`agents/src/output.ts`**
  - Add `ToolEventSchema` for `relayEventsFromToolOutput()`
  - Replace manual `typeof` checks with `safeParse()`
  - This is optional - current implementation works, just verbose

---

## Key Principle: No Redundant Types

When adding Zod schemas, **delete the corresponding TypeScript interface**. The schema becomes the single source of truth:

```typescript
// BEFORE (redundant):
interface TaskMetadata { id: string; ... }
const TaskMetadataSchema = z.object({ id: z.string(), ... });

// AFTER (correct):
const TaskMetadataSchema = z.object({ id: z.string(), ... });
type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
```

This prevents type drift where the interface and schema become misaligned.

---

## Implementation Notes

1. **Bundle Size:** Adding Zod will increase bundle size by ~12-15kb minified. This is acceptable for the agents package since it runs on Node.js (not browser).

2. **Migration Strategy:** Use Zod's `.transform()` to replace the existing `normalizeTask()` legacy migration logic. This provides:
   - Declarative transforms (easier to reason about)
   - Type-safe output (transforms return the correct type)
   - Better error messages when migrations fail

3. **Schema Location:** Place schemas alongside types in the same file:
   - `core/types/tasks.ts` -> `TaskMetadataSchema`, `SubtaskSchema`, `PendingReviewSchema`
   - `agents/src/runners/simple-runner-strategy.ts` -> `SimpleTaskMetadataSchema` (local, not exported)
   - Follow naming convention: `{TypeName}Schema`

4. **Error Handling:**
   - Use `.safeParse()` where graceful degradation is needed (e.g., skipping malformed files in `readTasksDirectory()`)
   - Use `.parse()` where failures should throw (e.g., in cleanup when we expect valid metadata)
   - Always log validation errors with enough context to debug

5. **Dependency Order:** Changes must be made in order:
   1. First add schemas to `core/types/tasks.ts`
   2. Then update consumers (`persistence.ts`, `workspace.ts`)
   3. Finally update isolated files (`simple-runner-strategy.ts`)

6. **Testing:** After implementing, verify with:
   - Create a task with valid metadata, verify it loads
   - Manually corrupt a `metadata.json`, verify graceful error handling
   - Check that legacy status values ("complete", "in_progress") are migrated correctly

---

## Appendix: Files Reviewed

Total: 47 files in `agents/src/` directory.

### core/ (source of truth types)
- `core/types/tasks.ts` - `TaskMetadata`, `Subtask`, `PendingReview`, etc. (**NEEDS ZOD** - read from disk)
- `core/types/events.ts` - `ThreadState`, `FileChange`, `ResultMetrics`, etc. (correct: emitted, not read)
- `agents/src/core/slug.ts` - Utility functions only
- `agents/src/core/types.ts` - Re-exports from core/types/tasks.ts
- `agents/src/core/persistence.ts` - `MortPersistence` class (**consumers NEED ZOD**)

### agent-types/
- simple.ts - No types, just config object
- shared-prompts.ts - Only exports strings
- research.ts - No types, just config object
- index.ts - `AgentConfig` interface (correct: internal)
- execution.ts - No types, just config object
- merge.ts - No types, just config object
- merge-types.ts - `MergeContext`, `WorkflowMode` (correct: internal)

### validators/
- types.ts - `ValidationResult`, `ValidationContext`, `AgentValidator` (correct: internal)
- research-naming.ts - No new types
- human-review.ts - No new types
- merge-task-status.ts - No new types
- index.ts - No new types

### runners/
- types.ts - `AgentType`, `RunnerConfig`, `OrchestrationContext`, `RunnerStrategy` (correct: internal)
- shared.ts - `AgentLoopOptions` (correct: callback interface)
- task-runner-strategy.ts - `CleanupState` (correct: internal, never persisted)
- simple-runner-strategy.ts - `SimpleTaskMetadata` (**NEEDS ZOD** - read from disk)
- index.ts - Re-exports only

### lib/
- workspace.ts - `GitState` (correct), `Task` alias (**consumers NEED ZOD** - sources from disk)
- persistence-node.ts - `NodePersistence` class with unsafe `read<T>()` (validation at call sites)
- logger.ts - `LogLevel` (correct: simple alias)
- timeout.ts - `TimeoutError` (correct: error class)
- events.ts - Re-exports from core
- index.ts - Re-exports

### Root level files
- types.ts - Re-exports from SDK
- context.ts - `EnvironmentContext`, `GitContext`, `TaskContext` (correct: built at runtime)
- output.ts - Re-exports from core, has `relayEventsFromToolOutput` (**could use Zod** - optional)
- runner.ts - No new types
- git.ts - `ChangedFile` (correct: internal)
- orchestration.ts - `RunnerArgs`, `OrchestrationResult` (correct: internal)

### testing/
- types.ts - Re-exports and `AgentRunOutput`, `AgentTestOptions` (correct: test infrastructure)
- runner-config.ts - `RunnerConfig` (correct: has function types)
- assertions.ts - `AgentAssertions` class (correct: builder pattern)
- agent-harness.ts - Test harness class
- index.ts - Re-exports
- services/test-repository.ts - Test service
- services/test-mort-directory.ts - Test service
- services/index.ts - Re-exports
- __tests__/exports.test.ts - Tests
- __tests__/harness-self-test.ts - Tests

### cli/
- timeout-wrapper.ts - No new types
- mort.ts - No new types, uses types from other files

### adapters/
- node-fs-adapter.ts - `NodeFSAdapter` class (correct: adapter pattern)

### services/
- thread-writer.ts - `ThreadWriter` class (correct: code structure)
