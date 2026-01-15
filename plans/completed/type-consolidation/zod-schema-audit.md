# Zod Schema Audit Report

## Summary

**Total Zod Schemas Found: 42 schemas across 17 files**

The codebase follows the pattern of defining schemas at trust boundaries (disk I/O, IPC, external data) and deriving types using `z.infer<>`. However, there are **2 duplicated schemas** that need attention, including one with a **schema drift bug**.

## Schema Inventory

### Core Types (14 schemas - source of truth)

#### `core/types/tasks.ts`
- `SubtaskSchema`
- `PendingReviewSchema`
- `TaskMetadataSchema`
- Derived types: `Subtask`, `PendingReview`, `TaskMetadata`

#### `core/types/events.ts`
- `WorktreeStatePayloadSchema`
- `AgentThreadStatusSchema`
- `FileChangeSchema`
- `ResultMetricsSchema`
- `ToolExecutionStateSchema`
- `ThreadStateSchema`
- `EventNameSchema`
- `AgentEventMessageSchema`
- `AgentStateMessageSchema`
- `AgentLogMessageSchema`
- `AgentOutputSchema`

### Entity Schemas (12 schemas)

#### `src/entities/threads/types.ts`
- `ThreadTurnSchema`
- `ThreadMetadataSchema`
- Derived types: `ThreadTurn`, `ThreadMetadata`

#### `src/entities/repositories/types.ts`
- `WorktreeClaimSchema` (with migration support for old `threadId` format)
- `TaskBranchInfoSchema`
- `WorktreeStateSchema`
- `RepositorySettingsSchema`
- `RepositoryMetadataSchema`
- `RepositoryVersionSchema`
- `RepositorySchema`

#### `src/entities/settings/types.ts`
- `WorkspaceSettingsSchema`

### UI/Library Schemas (9 schemas)

#### `src/lib/tauri-commands.ts`
- `WorktreeInfoSchema` (IPC response validation)

#### `src/lib/filesystem-client.ts`
- `DirEntrySchema` (IPC response validation)

#### `src/lib/types/paths.ts`
- `PathsInfoSchema` (IPC response validation)

#### `src/lib/prompt-history-service.ts`
- `PromptHistoryEntrySchema`
- `PromptHistoryDataSchema` (internal only)

#### `src/components/clipboard/types.ts`
- `ClipboardEntryPreviewSchema`
- `ClipboardEntrySchema` (extends preview schema)

#### `src/hooks/use-git-commits.ts`
- `GitCommitSchema`
- `GitCommitArraySchema`

#### `src/components/spotlight/types.ts`
- `AppResultSchema` (IPC response validation)

### Agent Schemas (5 schemas - MISSING FROM ORIGINAL AUDIT)

#### `agents/src/output.ts`
- `ToolEventSchema` (tool event protocol validation)

#### `agents/src/core/persistence.ts`
- `TaskMetadataOnDiskSchema` (legacy migration schema for reading tasks from disk)

#### `agents/src/runners/simple-runner-strategy.ts`
- `SimpleTaskMetadataSchema`
- `ThreadTurnSchema` **DUPLICATE - see Findings**
- `SimpleThreadMetadataSchema`

### Additional UI Schemas (2 schemas - MISSING FROM ORIGINAL AUDIT)

#### `src/components/simple-task/use-simple-task-params.ts`
- `PendingSimpleTaskSchema` (IPC response validation, snake_case from Rust)
- `OpenSimpleTaskEventSchema` (event payload validation, camelCase)

### Duplicate Schemas (1 schema - MISSING FROM ORIGINAL AUDIT)

#### `src/lib/workspace-settings-service.ts`
- `WorkspaceSettingsSchema` **DUPLICATE with SCHEMA DRIFT BUG - see Findings**

## Findings

### CRITICAL: Duplicate Schemas Found

#### 1. WorkspaceSettingsSchema - SCHEMA DRIFT BUG

Two different `WorkspaceSettingsSchema` definitions exist with **different fields**:

**Location 1: `src/entities/settings/types.ts` (canonical)**
```typescript
const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
  anthropicApiKey: z.string().nullable(),
  workflowMode: z.enum(["solo", "team"]),  // HAS THIS FIELD
});
```

**Location 2: `src/lib/workspace-settings-service.ts` (duplicate)**
```typescript
const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
  anthropicApiKey: z.string().nullable(),
  // MISSING workflowMode field!
});
```

**Impact:** This is a **live bug**. When `workspace-settings-service.ts` reads settings from disk, it will strip the `workflowMode` field during validation. When it writes settings back, the field will be lost (silent data loss).

**Fix:** Remove the duplicate schema from `workspace-settings-service.ts` (lines 13-26) and import from `@/entities/settings/types`.

#### 2. ThreadTurnSchema - DRY Violation

`ThreadTurnSchema` is defined in two files:

**Location 1: `src/entities/threads/types.ts` (canonical)**
```typescript
export const ThreadTurnSchema = z.object({
  index: z.number(),
  prompt: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  exitCode: z.number().optional(),
  costUsd: z.number().optional(),
});
```

**Location 2: `agents/src/runners/simple-runner-strategy.ts` (duplicate)**
```typescript
// Comment warns: "Must match frontend's ThreadTurnSchema"
const ThreadTurnSchema = z.object({
  index: z.number(),
  prompt: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  exitCode: z.number().optional(),
  costUsd: z.number().optional(),
});
```

**Impact:** Currently identical, but any future changes to one will not propagate to the other. The comment "Must match frontend's ThreadTurnSchema" is a DRY violation red flag.

**Fix:** Move `ThreadTurnSchema` to `core/types/threads.ts` and import from both locations.

### Schema Naming Convention

Types are consistently derived using `z.infer<typeof Schema>`:
- `type ThreadTurn = z.infer<typeof ThreadTurnSchema>`
- No separate TypeScript interfaces alongside schemas (except for input types like `CreateThreadInput`)

### Consolidation Status

#### Already Consolidated ✅
- Task types (`core/types/tasks.ts` is single source of truth)
- Event types (`core/types/events.ts` is single source of truth)

#### Needs Consolidation ⚠️
- Thread types (`src/entities/threads/types.ts` → should move to `core/types/threads.ts`)
- Repository types (`src/entities/repositories/types.ts` → partial move to `core/types/repositories.ts`)

#### Well-Placed Schemas ✅
- IPC boundary schemas in `tauri-commands.ts`, `filesystem-client.ts`, `paths.ts`
- Clipboard and UI schemas co-located with components

## Schema Organization Quality

### Trust Boundary Validation

All schemas are positioned correctly at data entry points:

| Boundary Type | Schemas | Location |
|---------------|---------|----------|
| Disk reads | TaskMetadata, ThreadMetadata, RepositorySettings, WorkspaceSettings, PromptHistory | entity types |
| IPC responses | WorktreeInfo, DirEntry, PathsInfo, GitCommit, AppResult | lib/ |
| Agent output | ThreadState, FileChange, AgentEventMessage, AgentStateMessage, AgentLogMessage | core/types/events.ts |

### Migration Support

Zod transforms used appropriately:
- `WorktreeClaimSchema` handles `threadId` → `threadIds` migration
- `RepositorySettingsSchema` provides defaults for missing fields

### Naming Convention

Consistent across codebase:
- `{TypeName}Schema` for Zod definitions
- `type {TypeName} = z.infer<typeof {TypeName}Schema>` for derived types

## Recommendations

### 1. Maintain Current Pattern

The established pattern of defining schemas at trust boundaries is excellent. Continue this as new types are added.

### 2. Move Thread Schemas to Core

As documented in `shared-thread-types.md`, these should move to `core/types/threads.ts`:
- `ThreadTurnSchema`
- `ThreadMetadataSchema`

### 3. Move Repository Schemas to Core

Partially move to `core/types/repositories.ts`:
- `RepositorySettingsSchema`
- `WorktreeStateSchema`
- `WorktreeClaimSchema`

Keep in `src/entities/repositories/types.ts`:
- `RepositoryMetadataSchema` (frontend-only)
- `TaskBranchInfoSchema` (frontend-only)
- `RepositoryVersionSchema` (frontend-only)
- `RepositorySchema` (frontend-only)

### 4. Schema Versioning

With `RepositorySettingsSchema` having `schemaVersion: z.literal(1)`, consider applying similar versioning to other long-lived schemas:
- `ThreadMetadataSchema`
- `TaskMetadataSchema`
- `WorkspaceSettingsSchema`

## Summary Statistics

| Category | Count |
|----------|-------|
| Total schemas | 42 |
| Core/types schemas | 14 |
| Entity schemas | 12 |
| UI/Library schemas | 9 |
| Agent schemas | 5 |
| Additional UI schemas | 2 |
| **Duplications found** | **2** |
| Schemas needing migration | 7 |

## Conclusion

The Zod schema organization is **generally good** with schemas positioned at trust boundaries. However, **two critical issues** require immediate attention:

1. **WorkspaceSettingsSchema schema drift** - This is a live bug causing silent data loss of the `workflowMode` field
2. **ThreadTurnSchema duplication** - DRY violation with drift risk

**Immediate actions:**
1. Fix `workspace-settings-service.ts` to import schema from `@/entities/settings/types`
2. Move `ThreadTurnSchema` to `core/types/threads.ts` as documented in `shared-thread-types.md`

The remaining migration work (thread and repository schemas to `core/types/`) is documented in other audit files.
