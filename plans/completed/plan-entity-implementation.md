# Plan Entity Implementation

## Overview

Introduce a new "plan" entity that represents markdown files in a repository's `plans/` directory. Plans can be associated with tasks and threads, providing a way to track implementation planning documents alongside the work being done.

## Key Requirements

1. **Plan Entity**: A plan is a markdown file in the `plans/` directory of a repository
2. **Relationships**: Both tasks and threads can have an optional `planId` field
3. **Detection**: When a thread creates/edits a file in `plans/` OR mentions a plan path in a user message, the thread should be associated with that plan
4. **Persistence**: Plans stored in `.anvil` layout like other entities
5. **Read/Unread Status**: Plans have read/unread status similar to threads
6. **UI**: Third tab in simple-task view to show the associated plan with markdown rendering
7. **Unified Navigation**: Extend existing task navigation to include unread plans in the same priority queue

---

## Data Model

### Plan Entity Type

```typescript
// core/types/plans.ts
import { z } from 'zod';

export const PlanMetadataSchema = z.object({
  /** Unique plan ID (UUID) */
  id: z.string().uuid(),
  /** Path to the plan file relative to repository root (e.g., "plans/feature-x.md") */
  path: z.string(),
  /** Repository name this plan belongs to */
  repositoryName: z.string(),
  /** Plan title (extracted from filename or first H1 in content) */
  title: z.string(),
  /** Whether user has viewed the plan */
  isRead: z.boolean(),
  /** Timestamps */
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;

export interface CreatePlanInput {
  path: string;
  repositoryName: string;
  title?: string;
}

export interface UpdatePlanInput {
  title?: string;
  isRead?: boolean;
}
```

### Task Entity Extension

```typescript
// In core/types/tasks.ts - add to TaskMetadataSchema
planId: z.string().optional(),
```

### Thread Entity Extension

```typescript
// In core/types/threads.ts - add to ThreadMetadataSchema
planId: z.string().optional(),
```

---

## Persistence Layout

Plans metadata stored in `.anvil/plans/` directory:

```
~/.anvil/
├── plans/
│   ├── {plan-id}/
│   │   └── metadata.json    # PlanMetadata
│   └── ...
```

Note: The actual plan content lives in the repository's `plans/` directory, not in `.anvil`. We only store metadata (read status, relationships) in `.anvil`.

---

## Implementation Steps

### Phase 1: Core Types and Store

1. **Create plan types** (`core/types/plans.ts`)
   - Define `PlanMetadataSchema`, types, and helpers
   - Export from `core/types/index.ts`

2. **Create plan Zustand store** (`src/entities/plans/store.ts`)
   - Follow existing patterns from `threads/store.ts`
   - State: `plans: Record<string, PlanMetadata>`, `_hydrated`, `_plansArray`
   - Actions: `hydrate`, `getAll`, `getByRepository`, `getPlan`, `getUnreadPlans`
   - Read management: `markPlanAsRead`, `markPlanAsUnread`, `getUnreadPlansByTask`
   - Optimistic methods: `_applyCreate`, `_applyUpdate`, `_applyDelete`

3. **Create plan service** (`src/entities/plans/service.ts`)
   - Hydration: scan `.anvil/plans/*/metadata.json`
   - CRUD operations with optimistic updates
   - `findByPath(repositoryName, path)` - lookup existing plan by repo + path
   - `ensurePlanExists(repositoryName, path)` - idempotent creation (looks up by path first, creates with new UUID if not found)
   - `getPlanContent(planId)` - read actual file from repo

4. **Create plan types re-export** (`src/entities/plans/types.ts`)
   - Re-export from `@core/types/plans.js`

5. **Create index barrel** (`src/entities/plans/index.ts`)

### Phase 2: Entity Relationships

6. **Update task types** (`core/types/tasks.ts`)
   - Add optional `planId: z.string().optional()` to `TaskMetadataSchema`

7. **Update thread types** (`core/types/threads.ts`)
   - Add optional `planId: z.string().optional()` to `ThreadMetadataSchema`

8. **Update UpdateTaskInput and UpdateThreadInput**
   - Add `planId?: string | null` to both interfaces

### Phase 3: Plan Detection

9. **Create plan detection service** (`src/entities/plans/detection-service.ts`)
   - `detectPlanFromToolCall(toolName, toolInput, workingDirectory)`:
     - Check if `Write` or `Edit` tool targets a path matching `plans/*.md`
     - Return plan path if detected
   - `detectPlanFromMessage(messageContent, workingDirectory)`:
     - Regex match for plan paths in user messages
     - Pattern: `plans/[^\s]+\.md`

10. **Integrate detection into thread state listener** (`src/entities/threads/listeners.ts` or similar)
    - On `AGENT_STATE` events, check `fileChanges` for plan paths
    - On thread creation with user message, check for plan mentions
    - Call `planService.ensurePlanExists()` and update thread's `planId`

### Phase 4: Hydration Integration

11. **Update app bootstrap** (`src/App.tsx` or similar)
    - Add `planService.hydrate()` to initialization sequence
    - Order: repositories → tasks → threads → plans

12. **Update thread hydration** to load plan associations
    - When hydrating threads, verify referenced plans exist

### Phase 5: UI - Plan Tab in Simple Task View

13. **Create PlanTab component** (`src/components/simple-task/plan-tab.tsx`)
    - Props: `planId: string | null`, `repositoryName: string`
    - If no plan: show empty state ("No plan associated")
    - If plan: load content via `planService.getPlanContent(planId)`
    - Render with `MarkdownRenderer` component
    - Mark plan as read when viewed

14. **Update SimpleTaskHeader** (`src/components/simple-task/simple-task-header.tsx`)
    - Add third view type: `"thread" | "changes" | "plan"`
    - Add plan icon button (e.g., `FileText` from lucide)
    - Show plan button only if thread has `planId` OR task has `planId`

15. **Update SimpleTaskWindow** (`src/components/simple-task/simple-task-window.tsx`)
    - Add `activeView` state option for "plan"
    - Conditionally render `PlanTab` when `activeView === "plan"`
    - Pass planId from thread or task metadata

### Phase 6: Unified Navigation for Tasks and Plans

16. **Update task navigation hook** (`src/hooks/use-navigate-to-next-task.ts`)
    - Rename or extend to handle both tasks and plans as "items"
    - `getNextUnreadItem()` - returns either a task or plan, whichever is next in priority order
    - Priority order: use existing task priority sort, interleave unread plans based on their associated task's priority
    - For plans not associated with a task, treat them as lowest priority (or separate category)

17. **Update copy from "task" to "item"**
    - Change "Go to next task" → "Go to next item" (or similar neutral wording)
    - Update button labels, tooltips, and any related UI text
    - Consider: "Next unread" as a concise alternative

18. **Update SuggestedActionsPanel** (`src/components/simple-task/suggested-actions-panel.tsx`)
    - Modify existing "next task" action to use unified navigation
    - Single action handles both unread tasks and unread plans
    - No separate "next plan" action needed

### Phase 7: Plan Read Status Management

19. **Add plan read/unread methods to service**
    - `markAsRead(planId)` - set isRead = true, persist
    - `markAsUnread(planId)` - set isRead = false, persist

20. **Auto-mark plan as read**
    - When PlanTab is viewed, call `markAsRead`
    - Use similar pattern to `useMarkThreadAsRead` hook

21. **Integrate with unified navigation**
    - Ensure plan read status changes are reflected in the unified "next item" calculations
    - When a plan is marked as read, navigation should skip to the next unread task or plan

---

## Configuration

For now, the plans directory defaults to `plans/` at the repository root. Future configuration via UI can be added to repository settings.

```typescript
// Default configuration
const PLANS_DIRECTORY = "plans";
```

---

## File Structure Summary

```
core/types/
├── plans.ts              # NEW: Plan types and schemas
├── tasks.ts              # MODIFIED: Add planId field
├── threads.ts            # MODIFIED: Add planId field
└── index.ts              # MODIFIED: Export plans

src/entities/plans/
├── index.ts              # NEW: Barrel export
├── types.ts              # NEW: Re-export from core
├── store.ts              # NEW: Zustand store
├── service.ts            # NEW: CRUD + content loading
└── detection-service.ts  # NEW: Plan detection logic

src/components/simple-task/
├── plan-tab.tsx          # NEW: Plan view component
├── simple-task-header.tsx # MODIFIED: Add plan toggle
└── simple-task-window.tsx # MODIFIED: Add plan view

src/hooks/
└── use-navigate-to-next-task.ts # MODIFIED: Extend to handle tasks + plans as unified "items"

src/components/simple-task/
└── suggested-actions-panel.tsx # MODIFIED: Update copy from "task" to "item"
```

---

## Edge Cases and Considerations

1. **Plan deleted from repo**: Handle gracefully - show "Plan not found" in UI, don't crash
2. **Multiple threads editing same plan**: All threads get associated with the same plan entity
3. **Plan renamed**: Old plan becomes orphaned, new plan created - consider detection
4. **Large plans**: Consider lazy loading or virtualization for very large markdown files
5. **Binary files in plans/**: Only process `.md` files
6. **Nested directories**: Support `plans/subdir/plan.md` paths

---

## Testing Strategy

1. **Unit tests for plan store**: Create, update, delete, read status
2. **Unit tests for detection service**: Various tool call scenarios
3. **Integration tests**: Thread creates plan → plan entity created → thread associated
4. **UI tests for PlanTab**: Loading states, markdown rendering, read marking

---

## Migration Notes

- Existing tasks/threads have no `planId` - field is optional, no migration needed
- On first run after update, plans store will be empty (no existing metadata)
- Plans will be created as they're detected from new thread activity

---

## Open Questions

1. **Task vs Thread planId priority**: If both task and thread have planId, which takes precedence in UI?
   - Recommendation: Thread planId (more specific) takes precedence, fall back to task planId

2. **Multiple plans per thread**: Should a thread be able to reference multiple plans?
   - Recommendation: Start with single planId, can extend to `planIds: string[]` later if needed

3. **Plan mentions in agent responses**: Should we also detect plans mentioned in assistant messages?
   - Recommendation: Start with user messages + tool calls only, can expand later

4. **Cross-repository plans**: Should plans be globally unique or scoped to repository?
   - Recommendation: Scoped to repository via `repositoryName` field (plan IDs are UUIDs, globally unique)
