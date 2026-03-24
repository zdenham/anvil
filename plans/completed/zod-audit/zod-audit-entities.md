# Zod Migration Audit: src/entities/

This audit evaluates types in `src/entities/` against the Zod boundary pattern defined in `docs/patterns/zod-boundaries.md`.

**Key Principle**: Use Zod ONLY at trust boundaries where data comes from outside TypeScript (disk, network, IPC, user input). Don't use Zod for internal types, interfaces with methods, React props, etc.

## Summary

| Category | Count |
|----------|-------|
| Types that SHOULD use Zod (not currently) | 10 |
| Types that are correctly plain TypeScript | 18 |
| No types incorrectly using Zod | 0 |

**Current state**: No Zod usage exists in `src/entities/`. All types are plain TypeScript interfaces. Several types that represent persisted state loaded from disk or IPC should be migrated to Zod schemas for runtime validation.

## Important: Avoid Redundant Types

When adding Zod schemas, **derive types from schemas using `z.infer<>`** rather than maintaining duplicate TypeScript interfaces:

```typescript
// WRONG: Duplicate type definition
export const TaskMetadataSchema = z.object({ ... });
export interface TaskMetadata { ... } // Redundant, can drift from schema

// CORRECT: Single source of truth
export const TaskMetadataSchema = z.object({ ... });
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
```

This ensures the TypeScript type always matches the runtime validation schema.

---

## Files That Need Changes

### 1. `/Users/zac/Documents/juice/anvil/anvil/src/entities/settings/types.ts`

**Current State**: Plain TypeScript interfaces

**Types that SHOULD use Zod**:
- `WorkspaceSettings` - Loaded from `settings.json` on disk (line 3-23)

**Types correctly using plain TypeScript**:
- `WorkflowMode` - Simple type alias (string literal union, line 1)
- `DEFAULT_WORKSPACE_SETTINGS` - Constant object (line 26-30)

**Recommended Action**: Add Zod schema for `WorkspaceSettings`, derive type with `z.infer<>`

**Example Change**:
```typescript
import { z } from "zod";

// WorkflowMode stays as simple type alias (used by schema)
export type WorkflowMode = "solo" | "team";

// Schema is source of truth - type is derived
export const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
  anthropicApiKey: z.string().nullable(),
  workflowMode: z.enum(["solo", "team"]),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

// Default can now be validated at definition time
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  repository: null,
  anthropicApiKey: null,
  workflowMode: "solo",
};
```

**Usage in service.ts** (line 15, `hydrate()`):
```typescript
// Before
const settings = await persistence.readJson<WorkspaceSettings>(SETTINGS_FILE);

// After
const raw = await persistence.readJson(SETTINGS_FILE);
const settings = raw ? WorkspaceSettingsSchema.parse(raw) : null;
```

---

### 2. `/Users/zac/Documents/juice/anvil/anvil/src/entities/repositories/types.ts`

**Current State**: Plain TypeScript interfaces

**Types that SHOULD use Zod**:
- `RepositorySettings` - Loaded from `settings.json` on disk (line 64-94)
- `WorktreeState` - Nested in RepositorySettings, persisted to disk (line 40-58)
- `TaskBranchInfo` - Nested in RepositorySettings, persisted to disk (line 5-20)
- `WorktreeClaim` - Nested in WorktreeState, persisted to disk (line 26-35)

**Types correctly using plain TypeScript**:
- `RepositoryMetadata` - Internal convenience type derived from settings (line 96-102)
- `RepositoryVersion` - Internal type for version tracking (line 104-108)
- `Repository` - Internal store type, extends metadata (line 110-112)
- `CreateRepositoryInput` - Function parameter (line 114-120)
- `UpdateRepositoryInput` - Function parameter (line 122-126)

**Recommended Action**: Add Zod schemas for persisted types, derive types with `z.infer<>`

**Example Change**:
```typescript
import { z } from "zod";

// Build schemas bottom-up (leaf types first)
const WorktreeClaimSchema = z.object({
  taskId: z.string(),
  threadIds: z.array(z.string()),
  claimedAt: z.number(),
});
export type WorktreeClaim = z.infer<typeof WorktreeClaimSchema>;

const TaskBranchInfoSchema = z.object({
  branch: z.string(),
  baseBranch: z.string(),
  mergeBase: z.string(),
  parentTaskId: z.string().optional(),
  createdAt: z.number(),
});
export type TaskBranchInfo = z.infer<typeof TaskBranchInfoSchema>;

const WorktreeStateSchema = z.object({
  path: z.string(),
  version: z.number(),
  currentBranch: z.string().nullable(),
  claim: WorktreeClaimSchema.nullable(),
  lastReleasedAt: z.number().optional(),
  lastTaskId: z.string().optional(),
});
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

export const RepositorySettingsSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  originalUrl: z.string().nullable(),
  sourcePath: z.string(),
  useWorktrees: z.boolean(),
  defaultBranch: z.string(),
  createdAt: z.number(),
  worktrees: z.array(WorktreeStateSchema),
  taskBranches: z.record(z.string(), TaskBranchInfoSchema),
  lastUpdated: z.number(),
});
export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;

// These internal types remain plain TypeScript (not persisted directly)
export interface RepositoryMetadata { ... }
export interface RepositoryVersion { ... }
export interface Repository extends RepositoryMetadata { ... }
export interface CreateRepositoryInput { ... }
export interface UpdateRepositoryInput { ... }
```

**Usage in service.ts** (line 94, `hydrate()`):
```typescript
// Before
const settings = await persistence.readJson<RepositorySettings>(settingsPath);

// After
const raw = await persistence.readJson(settingsPath);
const settings = raw ? RepositorySettingsSchema.parse(raw) : null;
```

**Also update** line 109 (legacy metadata.json fallback) - consider whether to validate or deprecate.

---

### 3. `/Users/zac/Documents/juice/anvil/anvil/src/entities/threads/types.ts`

**Current State**: Plain TypeScript interfaces

**Types that SHOULD use Zod**:
- `ThreadMetadata` - Loaded from `metadata.json` on disk (line 14-28)
- `ThreadTurn` - Nested in ThreadMetadata, persisted to disk (line 5-12)

**Types correctly using plain TypeScript**:
- `ThreadStatus` - Simple type alias (string literal union, line 1)
- `AgentType` - Simple type alias (string literal union, line 3)
- `CreateThreadInput` - Function parameter (line 30-41)
- `UpdateThreadInput` - Function parameter (line 43-51)
- `getThreadFolderName()` - Helper function (line 57-59)
- `parseThreadFolderName()` - Helper function (line 65-70)

**Recommended Action**: Add Zod schemas for persisted types, derive types with `z.infer<>`

**Example Change**:
```typescript
import { z } from "zod";

// ThreadStatus can optionally become a Zod enum if used in schema
export const ThreadStatusSchema = z.enum(["idle", "running", "completed", "error", "paused"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

// AgentType stays as simple type alias (not validated at boundaries)
export type AgentType = "entrypoint" | "execution" | "review" | "merge" | "research" | "simple";

const ThreadTurnSchema = z.object({
  index: z.number(),
  prompt: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  exitCode: z.number().optional(),
  costUsd: z.number().optional(),
});
export type ThreadTurn = z.infer<typeof ThreadTurnSchema>;

export const ThreadMetadataSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentType: z.string(),
  workingDirectory: z.string(),
  status: ThreadStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  ttlMs: z.number().optional(),
  git: z.object({
    branch: z.string(),
    commitHash: z.string().optional(),
  }).optional(),
  turns: z.array(ThreadTurnSchema),
});
export type ThreadMetadata = z.infer<typeof ThreadMetadataSchema>;

// Input types remain plain TypeScript (function parameters)
export interface CreateThreadInput { ... }
export interface UpdateThreadInput { ... }
```

**Usage in service.ts** - Multiple locations where `persistence.readJson<ThreadMetadata>` is called:
- Line 88 in `hydrate()`
- Line 136 in `refreshById()`
- Line 254 in `update()` (read-modify-write)
- Line 303 in `addTurn()` (read-modify-write)
- Line 356 in `completeTurn()` (read-modify-write)

```typescript
// Before
const metadata = await persistence.readJson<ThreadMetadata>(filePath);

// After
const raw = await persistence.readJson(filePath);
const metadata = raw ? ThreadMetadataSchema.parse(raw) : null;
```

---

### 4. `/Users/zac/Documents/juice/anvil/anvil/src/entities/logs/types.ts`

**Current State**: Plain TypeScript interfaces

**Types that SHOULD use Zod**:
- `RawLogEntry` - Parsed from JSON log output from Rust/tracing (IPC boundary, line 5-16)

**Types correctly using plain TypeScript**:
- `LogLevel` - Simple type alias (string literal union, line 2)
- `LogEntry` - Internal normalized type derived from RawLogEntry (line 19-27)
- `LogFilter` - Internal UI state (line 29-32)
- `normalizeLogEntry()` - Helper function (line 35-45)

**Recommended Action**: Add Zod schema for RawLogEntry, derive type with `z.infer<>`

**Example Change**:
```typescript
import { z } from "zod";

// LogLevel stays as simple type alias (internal use)
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

// RawLogEntry comes from Rust/tracing - needs validation
export const RawLogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.string(),
  target: z.string(),
  message: z.string().optional(),
  fields: z.object({
    message: z.string().optional(),
  }).passthrough().optional(),
  thread_id: z.string().optional(),
  spans: z.array(z.object({ name: z.string() })).optional(),
});
export type RawLogEntry = z.infer<typeof RawLogEntrySchema>;

// LogEntry is internal (derived from RawLogEntry) - plain TypeScript
export interface LogEntry { ... }

// LogFilter is internal UI state - plain TypeScript
export interface LogFilter { ... }
```

**Usage**: Validate when parsing JSON lines from log file/stream.

---

### 5. `/Users/zac/Documents/juice/anvil/anvil/core/types/tasks.ts`

**Note**: This file is in `core/types/` but is re-exported by `src/entities/tasks/types.ts`. Schemas should be defined here (single source of truth) and re-exported.

**Current State**: Plain TypeScript interfaces

**Types that SHOULD use Zod**:
- `TaskMetadata` - Loaded from `metadata.json` on disk (line 69-106)
- `PendingReview` - Nested in TaskMetadata, persisted to disk (line 50-67)
- `Subtask` - Nested in TaskMetadata, persisted to disk (line 35-39)

**Types correctly using plain TypeScript**:
- `TaskStatus` - Will become Zod enum (used by TaskMetadataSchema)
- `TASK_STATUSES` - Constant array (line 19-26)
- `ACTIVE_STATUSES` - Constant array (line 29-33)
- `Task` - Extends TaskMetadata, content loaded separately (line 108-110)
- `CreateTaskInput` - Function parameter (line 112-122)
- `UpdateTaskInput` - Function parameter (line 124-158)
- `generateTaskId()` - Helper function (line 164-168)

**Recommended Action**: Add Zod schemas for persisted types, derive types with `z.infer<>`

**Example Change**:
```typescript
import { z } from "zod";

// TaskStatus becomes Zod enum (used in schema)
export const TaskStatusSchema = z.enum([
  "draft", "backlog", "todo", "in-progress", "in-review", "done", "cancelled"
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Constants derived from schema values
export const TASK_STATUSES: readonly TaskStatus[] = TaskStatusSchema.options;
export const ACTIVE_STATUSES: readonly TaskStatus[] = ["todo", "in-progress", "in-review"];

const SubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});
export type Subtask = z.infer<typeof SubtaskSchema>;

const PendingReviewSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  markdown: z.string(),
  defaultResponse: z.string(),
  requestedAt: z.number(),
  onApprove: z.string(),
  onFeedback: z.string(),
  isAddressed: z.boolean(),
});
export type PendingReview = z.infer<typeof PendingReviewSchema>;

export const TaskMetadataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string(),
  type: z.enum(["work", "investigate", "simple"]),
  subtasks: z.array(SubtaskSchema),
  status: TaskStatusSchema,
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
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// Task extends metadata - plain TypeScript (content loaded separately)
export interface Task extends TaskMetadata {
  content: string;
}

// Input types remain plain TypeScript (function parameters)
export interface CreateTaskInput { ... }
export interface UpdateTaskInput { ... }
```

**Usage in service.ts** - Multiple locations where `persistence.readJson<TaskMetadata>` is called:
- Line 35 in `hydrate()`
- Line 59 in `refresh()`
- Line 79 in `refreshTaskBySlug()`
- Line 128 in `refreshTask()`
- Line 172 in `resolveSlug()`

```typescript
// Before
const metadata = await persistence.readJson<TaskMetadata>(`${TASKS_DIR}/${entry.name}/metadata.json`);

// After
const raw = await persistence.readJson(`${TASKS_DIR}/${entry.name}/metadata.json`);
const metadata = raw ? TaskMetadataSchema.parse(raw) : null;
```

---

### 6. `/Users/zac/Documents/juice/anvil/anvil/core/types/events.ts`

**Note**: This file contains types used for IPC between Node agents and the Tauri frontend. Agent stdout messages are parsed as JSON and should be validated.

**Current State**: Plain TypeScript interfaces

**Types that SHOULD use Zod**:
- `AgentOutput` (union type) - Parsed from agent stdout JSON (line 217)
- `AgentEventMessage` - Agent event output (line 191-195)
- `AgentStateMessage` - Agent state output (line 200-203)
- `AgentLogMessage` - Agent log output (line 208-212)
- `ThreadState` - Persisted to `state.json` on disk AND emitted via IPC (line 173-182)

**Types correctly using plain TypeScript**:
- `EventName` - Const object (runtime values, line 44-77)
- `EventNameType` - Type derived from const (line 79)
- `EventPayloads` - Internal mapped type (line 95-132)
- `WorktreeStatePayload` - Simplified internal type (line 12-17)
- `AgentThreadStatus` - Simple type alias (line 34)
- `ThreadStatusType` - Simple type alias (line 89)
- `FileChange` - Internal type (line 141-146)
- `ResultMetrics` - Internal type (line 151-155)
- `ToolExecutionState` - Internal type (line 160-164)

**Recommended Action**: Add Zod schemas for IPC types that are parsed from agent stdout

**Example Change**:
```typescript
import { z } from "zod";

// ThreadState is both persisted to disk AND received via IPC - needs validation
export const ThreadStateSchema = z.object({
  messages: z.array(z.any()), // MessageParam from Anthropic SDK
  fileChanges: z.array(z.object({
    path: z.string(),
    operation: z.enum(["create", "modify", "delete", "rename"]),
    oldPath: z.string().optional(),
    diff: z.string(),
  })),
  workingDirectory: z.string(),
  metrics: z.object({
    durationApiMs: z.number(),
    totalCostUsd: z.number(),
    numTurns: z.number(),
  }).optional(),
  status: z.enum(["running", "complete", "error"]),
  error: z.string().optional(),
  timestamp: z.number(),
  toolStates: z.record(z.string(), z.object({
    status: z.enum(["running", "complete", "error"]),
    result: z.string().optional(),
    isError: z.boolean().optional(),
  })),
});
export type ThreadState = z.infer<typeof ThreadStateSchema>;

// Agent output messages parsed from stdout
export const AgentEventMessageSchema = z.object({
  type: z.literal("event"),
  name: z.string(),
  payload: z.unknown(),
});

export const AgentStateMessageSchema = z.object({
  type: z.literal("state"),
  state: ThreadStateSchema,
});

export const AgentLogMessageSchema = z.object({
  type: z.literal("log"),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  message: z.string(),
});

export const AgentOutputSchema = z.discriminatedUnion("type", [
  AgentEventMessageSchema,
  AgentStateMessageSchema,
  AgentLogMessageSchema,
]);
export type AgentOutput = z.infer<typeof AgentOutputSchema>;
```

**Usage in thread service.ts** (line 537, `loadThreadState()`):
```typescript
// Before
const stateJson = await persistence.readJson<ThreadState>(statePath);

// After
const raw = await persistence.readJson(statePath);
const stateJson = raw ? ThreadStateSchema.parse(raw) : null;
```

**Usage in agent output parsing** (wherever agent stdout is parsed):
```typescript
// Before
const message = JSON.parse(line) as AgentOutput;

// After
const message = AgentOutputSchema.parse(JSON.parse(line));
```

---

## Files That Are Correctly Plain TypeScript (No Changes Needed)

### `/Users/zac/Documents/juice/anvil/anvil/src/entities/events.ts`

All types here are internal event bus types used within the TypeScript runtime:
- `AppEvents` - Internal mapped type extending core event payloads (line 17-21)
- `eventBus` - mitt instance (runtime object, not data) (line 24)

### `/Users/zac/Documents/juice/anvil/anvil/src/entities/tasks/types.ts`

This file only re-exports from `core/types/tasks.ts` - no additional types defined here.

### `/Users/zac/Documents/juice/anvil/anvil/core/types/resolution.ts`

Internal types for path resolution within TypeScript runtime:
- `TaskResolution` - Internal convenience type (line 4-13)
- `ThreadResolution` - Internal convenience type (line 18-29)

### `/Users/zac/Documents/juice/anvil/anvil/core/types/index.ts`

Re-exports and simple type aliases:
- `TaskId`, `ThreadId`, `RepoPath` - Simple type aliases (line 6-8)
- `THREADS_DIR`, `TASKS_DIR`, `STATE_FILE` - Constants (line 14-16)

### `/Users/zac/Documents/juice/anvil/anvil/src/entities/*/store.ts` files

Store interfaces define Zustand state and actions - these are code structure, not persisted data:
- `SettingsState`, `SettingsActions` (settings/store.ts)
- `RepositoryState`, `RepositoryActions` (repositories/store.ts)
- `ThreadStoreState`, `ThreadStoreActions` (threads/store.ts)
- `TaskState`, `TaskActions` (tasks/store.ts)
- `LogState`, `LogActions` (logs/store.ts)

### `/Users/zac/Documents/juice/anvil/anvil/src/entities/*/service.ts` files

Services contain business logic functions - not data types. These files are **consumers** of the schemas defined in types.ts files.

---

## Migration Priority

1. **High Priority** (data loaded at app startup):
   - `WorkspaceSettings` in settings/types.ts
   - `RepositorySettings` in repositories/types.ts
   - `TaskMetadata` in core/types/tasks.ts
   - `ThreadMetadata` in threads/types.ts

2. **Medium Priority** (parsed during runtime - IPC boundaries):
   - `AgentOutput` in core/types/events.ts (parsed from agent stdout)
   - `ThreadState` in core/types/events.ts (loaded from state.json AND via IPC)
   - `RawLogEntry` in logs/types.ts (IPC from Rust tracing)

3. **Low Priority** (nested types, validated as part of parent):
   - `WorktreeState`, `TaskBranchInfo`, `WorktreeClaim` (nested in RepositorySettings)
   - `ThreadTurn` (nested in ThreadMetadata)
   - `Subtask`, `PendingReview` (nested in TaskMetadata)
   - `AgentEventMessage`, `AgentStateMessage`, `AgentLogMessage` (components of AgentOutput)

   These are validated implicitly when their parent schemas are validated, but defining them as separate schemas enables reuse and clearer error messages.

---

## Implementation Notes

1. **Schema Location**: Keep schemas in the same file as types (e.g., `types.ts`)

2. **Naming Convention**: Use `*Schema` suffix for Zod schemas, derive types with `z.infer<>`
   ```typescript
   export const TaskMetadataSchema = z.object({ ... });
   export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
   ```

3. **Avoid Redundant Types**: Never maintain both a Zod schema AND a separate interface for the same type. The schema is the source of truth; the type is derived.

4. **Validation Points**: Add `.parse()` calls in service files where `persistence.readJson()` is called

5. **Error Handling**: Consider using `.safeParse()` with fallback to defaults for non-critical data
   ```typescript
   const result = WorkspaceSettingsSchema.safeParse(raw);
   const settings = result.success ? result.data : DEFAULT_WORKSPACE_SETTINGS;
   ```

6. **Bundle Size**: Zod adds ~12-15kb minified. This is acceptable for the validation benefits at disk/IPC boundaries.

7. **Nested Schemas**: Define schemas bottom-up (leaf types first) so parent schemas can reference child schemas.
   ```typescript
   const SubtaskSchema = z.object({ ... });
   const TaskMetadataSchema = z.object({
     subtasks: z.array(SubtaskSchema),
     ...
   });
   ```

8. **Export Strategy**: Export both schemas and types. Schemas are needed at validation points; types are needed everywhere.
   ```typescript
   // In types.ts
   export const TaskMetadataSchema = z.object({ ... });
   export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

   // In service.ts
   import { TaskMetadataSchema, type TaskMetadata } from "./types";
   ```

9. **Re-exports**: When types are re-exported (like `src/entities/tasks/types.ts` re-exporting from `core/types/tasks.ts`), also re-export the schemas:
   ```typescript
   export {
     TaskMetadataSchema,
     type TaskMetadata,
     // ...
   } from "../../../core/types/tasks.js";
   ```

## Checklist for Each Migration

For each file being migrated:

- [ ] Define Zod schema for each persisted/IPC type
- [ ] Derive TypeScript type using `z.infer<>`
- [ ] Delete the original interface (avoid redundancy)
- [ ] Update all `persistence.readJson<T>()` calls to use schema validation
- [ ] Export both schema and type
- [ ] Update re-export files if applicable
- [ ] Run type checker to verify no regressions
- [ ] Add tests for validation error cases (malformed data)
