# Thread-Plan Architecture: Implementation Review & Fixes

> **Last Updated:** 2026-01-22
> **Review Method:** 9 parallel task agents reviewed each plan's implementation

## Summary

Review of all 9 implementation plans completed. The architecture is ~70% complete with several blocking issues preventing manual testing.

---

## Plan Status Overview

| Plan | Status | Ready for Testing |
|------|--------|-------------------|
| 01-core-types | PARTIAL | No |
| 02-storage-layer | MOSTLY COMPLETE | Blocked by 01 |
| 03-delete-tasks | INCOMPLETE (~50%) | No |
| 04-thread-refactor | MOSTLY COMPLETE | Blocked by 01 |
| 05-plan-entity | COMPLETE | Yes |
| 06-relations | COMPLETE | Yes |
| 07-ui-inbox | PARTIAL | No |
| 08-control-panel | PARTIAL | No |
| 09-tauri-backend | COMPLETE | Yes |

---

## Critical Blockers

### 1. Frontend Build Fails
The frontend cannot build due to imports from deleted task modules.

### 2. Schema Inconsistency
Legacy fields remain in `core/types/threads.ts` that should be removed.

### 3. UnifiedInbox Not Wired
Component exists but isn't connected to data stores.

### 4. Control Panel Plan View Missing
Routing logic for plan view not implemented.

---

## Detailed Fixes Required

### Fix 1: Core Types Schema (01-core-types)

**File:** `core/types/threads.ts`

**Action:** Remove these fields from `ThreadMetadataBaseSchema` (lines 42-44):
```typescript
// DELETE these lines:
agentType: z.string().optional(),
workingDirectory: z.string().optional(),
planId: z.string().uuid().optional(),
```

**Also remove from `UpdateThreadInput`:**
```typescript
// DELETE this line (~line 89):
planId?: string | null;
```

**Verification:** Run `npm test -- core/types/__tests__` - schema tests should pass.

---

### Fix 2: Delete Task References (03-delete-tasks)

**Files with broken imports that need fixing:**

#### `src/lib/agent-service.ts`
- Remove `taskService` import from `@/entities`
- Remove `TaskMetadata` import from `@/entities/tasks/types`
- Remove `TASK_CREATED`, `TASK_UPDATED`, `TASK_DELETED`, `TASK_STATUS_CHANGED` event references
- Remove `thread.taskId` references

#### `src/components/control-panel/control-panel-window.tsx`
- Remove `useTaskStore` import
- Remove `markTaskUnread`, `archiveTask`, `useNavigateToNextTask` imports
- Replace with thread/plan equivalents

#### `src/components/control-panel/control-panel-header.tsx`
- Remove `useTaskStore` import
- Replace with `useThreadStore` or `usePlanStore`

#### `src/components/workspace/action-panel.tsx`
- Remove all task-related imports (`useTaskStore`, `taskService`, `TaskStatus`, `PendingReview`)
- Update to use threadService/planService

#### `src/lib/agent-state-machine.ts`
- Remove `TaskStatus` import
- Use `ThreadStatus` from `core/types/threads.ts`

#### `src/components/spotlight/spotlight.tsx`
- Remove `taskService` reference
- Remove `EventName.TASK_CREATED` reference
- Remove `task-panel-ready` event handling
- Rename `createSimpleTask` method to `createControlPanelTask`

#### `agents/src/core/types.ts`
- Remove re-exports from `core/types/tasks.js`

#### `agents/src/lib/events.ts`
- Remove `TaskStatus` import
- Remove task event helpers (`taskCreated`, `taskUpdated`, etc.)

#### Test helpers
- `src/test/helpers/event-emitter.ts` - Remove task event helpers
- `src/test/helpers/virtual-fs.ts` - Remove `@core/types/tasks` import
- `src/test/helpers/index.ts` - Remove task factory exports

**Create:** `src/test/task-deletion.test.ts` with verification tests (as specified in plan)

---

### Fix 3: Wire UnifiedInbox (07-ui-inbox)

**File:** `src/components/main-window/main-window-layout.tsx`

**Problem:** Line 41 renders `<UnifiedInbox />` without required props.

**Fix:** Wire the component to stores and handlers:
```tsx
// Add imports
import { useThreadStore, threadService } from '@/entities/threads';
import { usePlanStore, planService } from '@/entities/plans';
import { useThreadLastMessages } from '@/hooks/use-thread-last-messages';

// In component:
const threads = useThreadStore(state => Object.values(state.threads));
const plans = usePlanStore(state => Object.values(state.plans));
const threadLastMessages = useThreadLastMessages(threads);

const handleThreadSelect = (thread: ThreadMetadata) => {
  // Navigate to thread or open control panel
};

const handlePlanSelect = (plan: PlanMetadata) => {
  // Navigate to plan or open control panel
};

// Render with props:
<UnifiedInbox
  threads={threads}
  plans={plans}
  threadLastMessages={threadLastMessages}
  onThreadSelect={handleThreadSelect}
  onPlanSelect={handlePlanSelect}
/>
```

**Missing components to create:**
- `src/components/inbox/plan-detail.tsx` - Plan detail view with related threads
- Navigation routing for `/inbox`, `/inbox/threads/:id`, `/inbox/plans/:id`
- Bulk actions component (`InboxActions`)

---

### Fix 4: Control Panel Plan View Routing (08-control-panel)

**File:** `src/components/control-panel/control-panel-window.tsx`

**Problem:** Window doesn't route between thread and plan views.

**Fix:** Add routing logic using `useControlPanelStore`:
```tsx
import { useControlPanelStore } from './store';
import { PlanView } from './plan-view';
import { PlanViewHeader } from './plan-view-header';
import { PlanInputArea } from './plan-input-area';

// In component:
const view = useControlPanelStore(state => state.view);

// Conditional rendering:
if (view?.type === 'plan') {
  return (
    <>
      <PlanViewHeader planId={view.planId} />
      <PlanView planId={view.planId} />
      <PlanInputArea planId={view.planId} />
    </>
  );
}

// Existing thread view code...
```

---

### Fix 5: Tauri Capabilities Cleanup (09-tauri-backend) - Minor

**File:** `src-tauri/capabilities/default.json`

**Action:** Remove stale entries from windows array:
```json
// Change from:
"windows": ["main", "spotlight", "clipboard", "task", "error", "control-panel", "tasks-list"]

// To:
"windows": ["main", "spotlight", "clipboard", "error", "control-panel"]
```

---

## Recommended Fix Order

1. **Fix 1: Core Types** - Remove legacy fields (unblocks 02 and 04)
2. **Fix 2: Delete Tasks** - Fix all broken imports (unblocks frontend build)
3. **Fix 3: UI Inbox** - Wire UnifiedInbox component
4. **Fix 4: Control Panel** - Add plan view routing
5. **Fix 5: Tauri** - Clean up capabilities (minor)

---

## Verification Commands

After fixes, run:

```bash
# TypeScript compilation
npx tsc --noEmit

# All tests
npm test -- --run

# Frontend build
pnpm build:frontend

# Rust build
cd src-tauri && cargo build
```

---

## Components Ready for Manual Testing Now

Even with blockers, these can be tested via unit tests:

- **Plan entity** (05): Plan creation, hierarchy, read/unread status
- **Relations** (06): Plan-thread linking, detection, precedence
- **Thread storage** (02): Dual-path hydration, archiving
- **Tauri backend** (09): All Rust commands work

---

## Test Coverage Summary

| Area | Tests | Status |
|------|-------|--------|
| Core types | 65 | Pass (4 fail on schema) |
| Thread entity | 109 | Pass (4 fail on schema) |
| Plan entity | 52 | All pass |
| Relations | 86 | All pass |
| Inbox UI | 60 | All pass |
| Total | 372+ | ~96% passing |

---

## What's Already Working

These parts of the architecture are correctly implemented:

- Thread, Plan, and Relation Zustand stores (`useThreadStore`, `usePlanStore`, `useRelationStore`)
- Entity services (`threadService`, `planService`, `relationService`)
- Event listeners for THREAD_*, PLAN_*, RELATION_* events
- Relation type precedence enforcement (created > modified > mentioned)
- Archive flows for threads and plans
- Repository and worktree filtering
- Plan hierarchy detection via `parentId`
- Rust backend with control panel commands
- Relation detection system for file changes and user messages
