# Task Dead Code Cleanup

## Overview

The "task" concept has been deprecated in favor of threads as the primary entity. This audit identifies all remaining task-related code that should be cleaned up.

## Findings

### 1. CSS Dead Styles

**File:** `src/index.css`

**Lines 24-36:**
```css
/* Task panel transparency */
html:has(.task-panel-container),
html:has(.task-panel-container) body,
html:has(.task-panel-container) #root {
  background: transparent !important;
}

/* Tasks list panel transparency */
html:has(.tasks-list-container),
html:has(.tasks-list-container) body,
html:has(.tasks-list-container) #root {
  background: transparent !important;
}
```

**Lines 184-188:**
```css
.task-panel-container,
.tasks-list-container,
.error-container {
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}
```

**Status:** Dead code - these CSS classes are no longer used anywhere.

---

### 2. Rust/Tauri - `task_id` Parameter Propagation

The `task_id` parameter is passed through several layers but serves no meaningful purpose:

| File | Line | Code |
|------|------|------|
| `src-tauri/src/lib.rs` | 331 | `task_id: String` param in `open_control_panel` |
| `src-tauri/src/panels.rs` | 668 | `pub task_id: String` in `PendingControlPanel` struct |
| `src-tauri/src/panels.rs` | 837 | `task_id: &str` param in `show_control_panel` |
| `src-tauri/src/panels.rs` | 840, 846, 869 | Logging and passing `task_id` |
| `src-tauri/src/process_commands.rs` | 123 | `task_id: String` param in `submit_tool_result` |
| `src-tauri/src/process_commands.rs` | 133, 150 | Logging and including in JSON payload |
| `src-tauri/src/thread_commands.rs` | 19 | `pub task_id: String` in `ThreadMetadata` struct |
| `src-tauri/src/logging/log_server.rs` | 45, 286, 318 | `task_id` field in log rows |

**Status:** Vestigial - `task_id` is generated as a random UUID in the frontend but never used meaningfully. Threads are now the primary entity.

---

### 3. Frontend - `taskId` Parameter Usage

| File | Line | Code | Status |
|------|------|------|--------|
| `src/components/spotlight/spotlight.tsx` | 248 | `const taskId = crypto.randomUUID();` | Generates unused ID |
| `src/components/spotlight/spotlight.tsx` | 262 | `await openControlPanel(threadId, taskId, content);` | Passes unused param |
| `src/lib/hotkey-service.ts` | 96-99 | `openControlPanel(threadId, taskId, prompt)` | Function signature includes unused param |
| `src/hooks/use-action-state.ts` | 16, 41, 47 | `taskId: string \| null` param | Only checks if non-null, doesn't use value |
| `src/lib/triggers/types.ts` | 27 | `taskId?: string` in `TriggerContext` | Likely unused |
| `src/lib/prompt-history-service.ts` | 13, 71, 84, 138 | `taskId` field in history entries | Legacy compatibility |

---

### 4. Test Helpers - Kanban/Task Dead Code

**File:** `src/test/helpers/queries.ts`

**Lines 61-62:**
```typescript
kanbanColumn: (status: string) => `kanban-column-${status}`,
kanbanCard: (id: string) => `kanban-card-${id}`,
```

**Lines 137-154:**
```typescript
/**
 * Get a kanban card by task ID.
 */
export function getKanbanCard(taskId: string): HTMLElement {
  return screen.getByTestId(testIds.kanbanCard(taskId));
}

/**
 * Get a kanban column by status.
 */
export function getKanbanColumn(status: string): HTMLElement {
  return screen.getByTestId(testIds.kanbanColumn(status));
}

/**
 * Get cards within a specific kanban column.
 */
export function getCardsInColumn(status: string): HTMLElement[] { ... }
```

**Status:** Dead - Kanban board was part of tasks UI, now deleted.

---

### 5. Agents Package - Task References

| File | Line | Code | Status |
|------|------|------|--------|
| `agents/src/validators/types.ts` | 9 | `taskId: string \| null` in `ValidationContext` | May be dead |
| `agents/src/runners/thread-history.test.ts` | 362-411 | Tests referencing `tasks/{taskId}/threads/` path | Outdated tests for legacy path structure |
| `agents/src/agent-types/simple.ts` | 12 | `- Task ID: {{taskId}}` in prompt template | Included in agent prompts |

---

### 6. Legacy Migration Code

**File:** `src/entities/threads/service.ts`

**Lines 22-24:**
```typescript
const THREADS_DIR = "threads";           // New top-level structure
const LEGACY_TASKS_DIR = "tasks";        // Legacy task-nested structure
const ARCHIVE_THREADS_DIR = "archive/threads";
```

**Lines 50-54:**
```typescript
// Fall back to legacy task-nested location
const legacyPattern = `${LEGACY_TASKS_DIR}/*/threads/*-${threadId}/metadata.json`;
const matches = await persistence.glob(legacyPattern);
```

**Lines 73-75:**
```typescript
// Load from legacy task-nested structure: ~/.mort/tasks/*/threads/*/metadata.json
const legacyPattern = `${LEGACY_TASKS_DIR}/*/threads/*/metadata.json`;
const legacyFiles = await persistence.glob(legacyPattern);
```

**Status:** Migration code - keep if users may have legacy data in `~/.mort/tasks/` structure.

---

## Implementation Proposal

### Phase 1: CSS Cleanup (Safe, No Dependencies)

**Priority:** High
**Risk:** None
**Files:** `src/index.css`

1. Remove lines 24-36 (task panel and tasks list transparency rules)
2. Update lines 184-188 to only include `.error-container` (remove task classes from shadow rule)

---

### Phase 2: Test Helper Cleanup (Safe, No Runtime Impact)

**Priority:** Medium
**Risk:** Low - may cause test compilation errors if any tests still reference these
**Files:** `src/test/helpers/queries.ts`

1. Remove `kanbanColumn` and `kanbanCard` from `testIds` object
2. Remove `getKanbanCard()`, `getKanbanColumn()`, and `getCardsInColumn()` functions
3. Run tests to verify nothing breaks

---

### Phase 3: Frontend taskId Parameter Removal

**Priority:** High
**Risk:** Medium - requires coordinated changes across frontend and backend
**Files:** Multiple

#### Step 1: Update Frontend Callers
- `src/components/spotlight/spotlight.tsx`: Remove `taskId` generation and parameter
- `src/lib/hotkey-service.ts`: Remove `taskId` from `openControlPanel` signature

#### Step 2: Update Rust Commands
- `src-tauri/src/lib.rs`: Remove `task_id` param from `open_control_panel` command
- `src-tauri/src/panels.rs`: Remove `task_id` from `PendingControlPanel` struct and `show_control_panel` function

#### Step 3: Clean Up Downstream
- `src/hooks/use-action-state.ts`: Remove `taskId` parameter (only uses `threadId`)
- `src/lib/triggers/types.ts`: Remove `taskId` from `TriggerContext`

---

### Phase 4: Rust Backend Cleanup

**Priority:** Medium
**Risk:** Medium - may affect logging/debugging
**Files:** Multiple Rust files

#### Keep (for logging/debugging):
- `src-tauri/src/logging/log_server.rs`: Keep `task_id` field for structured logging compatibility

#### Remove:
- `src-tauri/src/thread_commands.rs`: Remove `task_id` from `ThreadMetadata` struct
- `src-tauri/src/process_commands.rs`: Remove `task_id` from `submit_tool_result` (or rename to clarify purpose)

---

### Phase 5: Agents Package Cleanup

**Priority:** Low
**Risk:** Low
**Files:** `agents/src/*`

1. `agents/src/validators/types.ts`: Remove `taskId` from `ValidationContext` if unused by validators
2. `agents/src/runners/thread-history.test.ts`: Update or remove tests that reference legacy `tasks/{taskId}/threads/` path structure
3. `agents/src/agent-types/simple.ts`: Consider removing `Task ID: {{taskId}}` from prompt template (or keep for traceability)

---

### Phase 6: Legacy Migration Code (Defer)

**Priority:** Low
**Risk:** Data loss if users have legacy data
**Files:** `src/entities/threads/service.ts`

**Recommendation:** Keep migration code until confident no production systems have data in `~/.mort/tasks/*/threads/*/` structure. Add a deprecation comment with target removal date.

---

### Phase 7: Prompt History Cleanup (Defer)

**Priority:** Low
**Risk:** May affect stored history data
**Files:** `src/lib/prompt-history-service.ts`

**Recommendation:** Keep `taskId` field for backwards compatibility with existing history files. Consider removing in a future major version.

---

## Summary

| Phase | Files | Priority | Risk | Effort |
|-------|-------|----------|------|--------|
| 1. CSS Cleanup | 1 | High | None | Small |
| 2. Test Helpers | 1 | Medium | Low | Small |
| 3. Frontend taskId | 4 | High | Medium | Medium |
| 4. Rust Backend | 3 | Medium | Medium | Medium |
| 5. Agents Package | 3 | Low | Low | Small |
| 6. Migration Code | 1 | Low | High | Small |
| 7. Prompt History | 1 | Low | Medium | Small |

## Recommended Order

1. **Phase 1** - CSS cleanup (no dependencies, safe)
2. **Phase 2** - Test helpers (no runtime impact)
3. **Phase 3 + 4** - Frontend + Rust taskId removal (coordinated change)
4. **Phase 5** - Agents package (after frontend/backend aligned)
5. **Phase 6 + 7** - Defer until migration period complete
