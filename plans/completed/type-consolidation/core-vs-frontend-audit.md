# Type Consolidation Audit: Core vs Frontend

## Summary of Findings

The codebase shows **excellent consolidation** of types from core/types into src/. Most shared types are properly centralized in `core/types/` and re-exported from `src/entities/`. There are very few duplications, and those that exist are intentional separations for different use cases.

## Core/Types Structure

**Location:** `core/types/`

Files:
- `index.ts` - Constants and type ID definitions
- `tasks.ts` - Task types (TaskStatus, TaskMetadata, Zod schemas)
- `events.ts` - Event types, ThreadState, and agent output schemas
- `resolution.ts` - Resolution types for path/ID lookups

## Key Findings

### 1. Properly Shared Types (No Duplication)

| Type | Location | Usage | Status |
|------|----------|-------|--------|
| `TaskStatus` | `core/types/tasks.ts` | Re-exported in `src/entities/tasks/types.ts` | ✅ Single source of truth |
| `TaskMetadata`, `Subtask`, `PendingReview` | `core/types/tasks.ts` | Re-exported with schemas | ✅ Single source of truth |
| `ThreadStatus`, `AgentType` | `src/entities/threads/types.ts` | Defined locally (not in core) | ⚠️ See shared-thread-types.md |
| `ThreadMetadata`, `ThreadTurn` | `src/entities/threads/types.ts` | Defined locally | ⚠️ See shared-thread-types.md |
| `EventName`, `EventPayloads`, `ThreadState` | `core/types/events.ts` | Used by 9 imports in src | ✅ Single source of truth |
| `WorktreeState`, `WorktreeClaim`, `TaskBranchInfo` | `src/entities/repositories/types.ts` | Defined locally | ⚠️ Should move to core |

### 2. Detected Duplications

#### a) WorkspaceSettings Schema (BUG - SCHEMA DRIFT)

- **Core location:** None - currently missing from core
- **Frontend location:** `src/entities/settings/types.ts` (exported)
- **Secondary location:** `src/lib/workspace-settings-service.ts` (private duplicate)
- **Status:** **BUG - SCHEMA DRIFT causing potential runtime validation failures**
  - `src/entities/settings/types.ts`: Has `workflowMode: z.enum(["solo", "team"])`
  - `src/lib/workspace-settings-service.ts`: **Missing `workflowMode` field entirely**
  - This is a real bug that could cause silent data loss when saving/loading workspace settings
  - **Recommendation:** Remove duplicate schema from `src/lib/workspace-settings-service.ts` (lines 13-26) and import from `@/entities/settings/types`

#### b) WorktreeInfo Schema

- **Location:** `src/lib/tauri-commands.ts`
- **Related type:** `WorktreeStatePayload` in `core/types/events.ts`
- **Status:** ⚠️ **POTENTIAL INCONSISTENCY**
  - `WorktreeInfo` (in tauri-commands): `{path, branch, isBare}`
  - `WorktreeStatePayload` (in core/events): `{path, currentBranch}`
  - These represent different concepts - one from git, one for events
  - **Recommendation:** Document distinction clearly

### 3. Frontend-Only Types (Intentionally Not in Core)

These should NOT be moved to core because they are frontend-specific UI/state types:

- Component-specific types:
  - `src/components/spotlight/types.ts`
  - `src/components/diff-viewer/types.ts`
  - `src/components/clipboard/types.ts`
- Library types:
  - `src/lib/types/paths.ts` - Tauri backend paths schema
  - `src/lib/types/agent-messages.ts` - Re-exports core types + frontend-specific message types
- Entity types (frontend domain):
  - `src/entities/logs/types.ts` - Log entry schemas for UI log viewer
  - `src/entities/settings/types.ts` - Workspace settings
  - `src/entities/threads/types.ts` - Thread types (see shared-thread-types.md)
  - `src/entities/repositories/types.ts` - Repository/worktree types
  - `src/entities/tasks/types.ts` - Task types (re-exports from core)

## Recommendations

### Priority 1: Fix WorkspaceSettings Schema Drift (BUG)

**This is a live bug that should be fixed immediately.**

- Remove the private `WorkspaceSettingsSchema` from `src/lib/workspace-settings-service.ts` (lines 13-35)
- Import `WorkspaceSettingsSchema`, `WorkspaceSettings`, and `DEFAULT_WORKSPACE_SETTINGS` from `@/entities/settings/types`
- The duplicate schema is missing `workflowMode` which causes data validation inconsistency

### Priority 2: Document WorktreeInfo vs WorktreeStatePayload Distinction

- Add comments explaining the semantic difference:
  - `WorktreeInfo`: Direct git worktree properties from filesystem
  - `WorktreeStatePayload`: Event payload format for agent communication
- Files affected:
  - `src/lib/tauri-commands.ts`
  - `core/types/events.ts`

## Summary Statistics

- **Core type files:** 4 files (index, tasks, events, resolution)
- **Frontend type files:** 10 files total
  - 3 component-specific: `spotlight`, `diff-viewer`, `clipboard`
  - 2 library types: `paths.ts`, `agent-messages.ts`
  - 5 entity types: `logs`, `settings`, `threads`, `repositories`, `tasks`
- **Files importing from core/types/events:** 9 files in src/
- **Actual duplications:** 1 (WorkspaceSettings - **BUG**)
- **Potential duplications:** 1 (WorktreeInfo vs WorktreeStatePayload - semantic, not code)
- **Overall consolidation quality:** **85%** - Mostly well-organized, but the WorkspaceSettings bug needs immediate attention
