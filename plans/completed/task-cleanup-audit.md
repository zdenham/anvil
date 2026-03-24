# Task Cleanup Audit

## Overview

Comprehensive audit of remaining "task" references in the codebase following the Thread + Plan architecture migration documented in `plans/completed/thread-plan-architecture.md`.

## Summary

| Category | Count | Priority | Action |
|----------|-------|----------|--------|
| DELETE (CLI & Deprecated) | 1 file section | HIGH | Remove completely |
| RENAME (Schema/Types) | 4 types, 9+ files | HIGH | Rename to Thread equivalents |
| KEEP (Legitimate Uses) | 8+ locations | N/A | No action needed |
| MODIFY (Comments/Test Data) | 15+ locations | LOW | Update references |

---

## Phase 1: Breaking Changes - DELETE

### CLI Task Commands - `agents/src/cli/anvil.ts`

**Action**: DELETE entire tasks CLI section

The CLI contains dead code with placeholder task implementations that need removal:

- Task type definitions (`TaskStatus`, `TaskMetadata` interfaces)
- `validateStatus()` function
- `formatTaskLine()` and `formatTaskDetails()` functions
- Task help text and `showTasksHelp()` function
- All task subcommand handlers: `tasksList`, `tasksCreate`, `tasksRename`, `tasksUpdate`, `tasksGet`
- Command routing for `tasks` subcommand

---

## Phase 2: Schema Renames - HIGH PRIORITY

### 1. TaskBranchInfo → ThreadBranchInfo

**Files affected**:
- `core/types/repositories.ts` - Type and schema definitions
- `core/types/__tests__/thread-plan-types.test.ts` - Tests
- `src/entities/repositories/service.ts` - Service layer
- `src/entities/repositories/types.ts` - Frontend types
- `src/lib/persistence.ts` - Persistence layer
- `core/services/repository/settings-service.test.ts` - Tests
- `core/services/worktree/worktree-service.test.ts` - Tests
- `agents/src/testing/services/test-anvil-directory.ts` - Test infrastructure
- `src/entities/threads/__tests__/utils.test.ts` - Tests

**Renames required**:
- Type: `TaskBranchInfo` → `ThreadBranchInfo`
- Schema: `TaskBranchInfoSchema` → `ThreadBranchInfoSchema`
- Field: `parentTaskId` → `parentThreadId` (within the schema)
- Object key: `taskBranches` → `threadBranches` in RepositoriesSettingsSchema
- All accessor calls: `.taskBranches` → `.threadBranches`

### 2. Deprecated Git Functions - `agents/src/git.ts`

**Action**: RENAME or DELETE

- `createTaskBranch()` - marked @deprecated, rename to `createThreadBranch()`
- `generateTaskDiff()` - marked @deprecated, rename to `generateThreadDiff()`

---

## Phase 3: Legitimate Uses - KEEP

These are valid uses of "task" that should NOT be changed:

### 1. CLI Argument: `--task-id`

**Files**:
- `agents/src/runners/simple-runner-strategy.ts`
- `agents/src/runners/simple-runner-strategy.test.ts`
- `agents/src/runners/types.ts` (RunnerConfig.taskId)

**Reason**: Internal CLI parameter. Could be renamed in a future pass but not breaking.

### 2. OpenControlPanel Parameters

**Files**:
- `src/lib/tauri-commands.ts`
- `src/lib/hotkey-service.ts`
- `src/components/spotlight/spotlight.tsx`
- `src-tauri/src/panels.rs`

**Reason**: Frontend UI parameter for control panel display. Keep as-is.

### 3. Rust/Tauri Infrastructure

**Files**:
- `src-tauri/src/panels.rs` - Panel functions use `task_id` as display API

### 4. Test Helpers

**Files**:
- `src/test/helpers/queries.ts` - `getKanbanCard(taskId)`
- `src/test/helpers/index.ts`

**Reason**: Test infrastructure for kanban board.

### 5. CSS Classes

**Files**:
- `src/index.css` - `.task-panel-container`, `.tasks-list-container`

**Reason**: Panel styling, separate concerns.

### 6. Documentation

**Files**:
- `docs/data-models.md` - Historic Task section

**Reason**: Keep for historical reference, mark as deprecated.

---

## Phase 4: Comments & Test Data - LOW PRIORITY

### Event System

**File**: `src/entities/events.ts` (line 54)
**Action**: Remove `taskId?: string` from event payload or rename to `threadId`

### Thread Metadata Tests

**File**: `src/entities/threads/__tests__/schema.test.ts`
**Action**: Update test comments to reflect `taskId` is explicitly excluded

### Test Fixtures

**Files**:
- `src/components/control-panel/plan-and-changes-tabs.ui.test.tsx` (TASK_ID constant)
- `src/components/control-panel/control-panel-header.ui.test.tsx`
- `src/hooks/use-mark-thread-as-read.test.ts`

**Action**: Update test fixture data to use meaningful threadId values

### Comment Updates

**Files**:
- `src/lib/prompt-history-service.ts` (line 138) - "taskId is undefined for drafts"
- `agents/src/runners/stdin-message-stream.ts`
- `agents/src/runners/simple-runner-strategy.ts`
- `agents/src/runners/shared.ts`

**Action**: Update comments to use "thread" terminology

### Control Panel Params

**File**: `src/components/control-panel/use-control-panel-params.ts`
**Action**: Review if `taskId` should be renamed to `threadId`

---

## Implementation Checklist

### Phase 1: Breaking Changes
- [ ] Delete all CLI task commands from `agents/src/cli/anvil.ts`
- [ ] Search for calls to deleted CLI functions and remove
- [ ] Verify build succeeds

### Phase 2: Schema Renames
- [ ] Rename `TaskBranchInfoSchema` → `ThreadBranchInfoSchema` in `core/types/repositories.ts`
- [ ] Rename `TaskBranchInfo` type → `ThreadBranchInfo`
- [ ] Rename `parentTaskId` → `parentThreadId` in schema
- [ ] Rename `taskBranches` → `threadBranches` field
- [ ] Update all usages across 9+ affected files
- [ ] Handle deprecated git functions in `agents/src/git.ts`
- [ ] Verify tests pass

### Phase 3: Comments & Test Data
- [ ] Update comments in runner files to use "thread" terminology
- [ ] Update test fixture data to use realistic IDs
- [ ] Update event system comments
- [ ] Review `use-control-panel-params.ts` naming

---

## Files to Ignore

These contain "task" but are safe to ignore:
- `node_modules/` - External dependencies
- `plans/completed/` - Historical planning documents
- Git branch names with "task" in them
- `pnpm-lock.yaml` - Lock file
