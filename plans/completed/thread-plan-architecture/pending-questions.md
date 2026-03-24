# Resolved Decisions: Thread + Plan Architecture

Questions, ambiguities, and discrepancies found across the sub-plans - now resolved.

---

## Type Definition Decisions

### 1. ThreadMetadata: `planId` vs Separate Relations Table
**Plans involved:** 01-core-types.md, 02-storage-layer.md, 06-relations.md, parent plan

**Decision:** Use relations table only. No `planId` or `planIds` on ThreadMetadata.

All thread-plan relationships must be queried exclusively from the relations table. Sub-plans that add `planId` to ThreadMetadata need to be updated.

---

### 2. PlanMetadata: `absolutePath` vs `repoId + worktreeId + relativePath`
**Plans involved:** 01-core-types.md, 05-plan-entity.md, parent plan

**Decision:** Use `repoId + worktreeId + relativePath`. Remove `absolutePath`.

Update all plans to use the structured path approach:
```typescript
interface PlanMetadata {
  id: string
  repoId: string
  worktreeId: string
  relativePath: string
  // ...
}
```

---

### 3. PlanMetadata: Fields
**Plans involved:** 01-core-types.md, 05-plan-entity.md, 07-ui-inbox.md

**Decision:**
- No `status` field - status is derived from associated threads
- No `title` field - use `relativePath` for display
- Add `isRead: boolean` field
- Use `parentId` (not `parentPlanId`) for hierarchy

PlanMetadata should have:
```typescript
interface PlanMetadata {
  id: string
  repoId: string
  worktreeId: string
  relativePath: string
  parentId?: string
  isRead: boolean
  createdAt: number
  updatedAt: number
}
```

The inbox UI will transform data as needed for display.

---

### 4. ThreadMetadata: `title` Field
**Plans involved:** 01-core-types.md, 07-ui-inbox.md

**Decision:** No `title` field on ThreadMetadata.

Display the last user message when showing threads in the UI. The inbox will need to fetch/derive this at display time.

---

### 5. Timestamp Type
**Plans involved:** 01-core-types.md, 05-plan-entity.md, 07-ui-inbox.md

**Decision:** Use Unix milliseconds (numbers) for all timestamps.

```typescript
createdAt: number  // Unix milliseconds
updatedAt: number  // Unix milliseconds
```

Update 01-core-types.md to use `number` instead of `string`.

---

## Storage Layer Decisions

### 6. ThreadStorageService: Does It Exist?
**Plans involved:** 02-storage-layer.md, 04-thread-refactor.md

**Decision:** Use the existing `persistence` layer directly. Do NOT create new `*StorageService` classes.

Update 04-thread-refactor.md and 06-relations.md to use the persistence layer directly instead of referencing non-existent storage service classes.

---

### 7. Relations Storage Location & Format
**Plans involved:** 06-relations.md, parent plan

**Decision:** Store relations in `~/.anvil/plan-thread-edges/` with the following format:

**File naming:** `{planId}-{threadId}.json`

**File schema:**
```typescript
interface PlanThreadRelation {
  planId: string
  threadId: string
  type: 'created' | 'modified' | 'mentioned'
  createdAt: number
  updatedAt: number
}
```

The `type` field indicates the relationship:
- `created` - thread created this plan
- `modified` - thread modified this plan
- `mentioned` - thread referenced this plan (in user message or context)

Update 06-relations.md to include this explicit file format.

---

### 8. Missing Plan: 10-migration.md
**Plans involved:** README.md

**Decision:** No migration plan needed. Remove from README.

There is no migration - this is greenfield implementation.

---

## Event System Decisions

### 9. Event Name Conventions
**Plans involved:** 01-core-types.md, 02-storage-layer.md, 06-relations.md

**Decision:** Consolidate event naming. Canonical list:

**Thread events:**
- `THREAD_CREATED`
- `THREAD_UPDATED`
- `THREAD_STATUS_CHANGED`
- `THREAD_ARCHIVED`
- `THREAD_FILE_CREATED` (emitted by agent runner)
- `THREAD_FILE_MODIFIED` (emitted by agent runner)

**Plan events:**
- `PLAN_CREATED`
- `PLAN_UPDATED`
- `PLAN_ARCHIVED`

**Relation events:**
- `RELATION_CREATED`
- `RELATION_UPDATED`

**User events:**
- `USER_MESSAGE_SENT` (emitted by agent runner)

No `PLAN_DELETED` event - plans are archived, not deleted.

---

## UI/UX Decisions

### 10. Plan Status Field
**Plans involved:** 07-ui-inbox.md

**Decision:** No `status` field on PlanMetadata. Status is derived from associated threads.

The UI should:
1. Query relations to find threads associated with a plan
2. Check thread statuses to determine if any are running
3. Display "in-progress" indicator if any associated thread is active

Future: May add progress tracking to plans.

---

### 11. Repository Config: `id` Field
**Plans involved:** 01-core-types.md, parent plan

**Decision:** Keep the `id` field on RepositoryConfig.

```typescript
interface RepositoryConfig {
  id: string                    // UUID
  path: string
  plansDirectory: string
  completedDirectory: string
}
```

---

### 12. worktreeId: Required vs Optional
**Plans involved:** 01-core-types.md, 04-thread-refactor.md, parent plan

**Decision:** `worktreeId` is required.

The main repo is also a worktree, so every thread has a worktreeId. Update 04-thread-refactor.md to make `worktreeId` required in the service interface.

---

### 13. Relation Type Transitions
**Plans involved:** 06-relations.md

**Decision:** Relation types have precedence: `created` > `modified` > `mentioned`

Rules:
- A relation can only upgrade, never downgrade
- `mentioned` can upgrade to `modified` or `created`
- `modified` can upgrade to `created`
- `created` cannot change (highest precedence)
- Only one relation per thread-plan pair exists; the type reflects the highest-precedence action

---

### 14. Archive Thread Relations
**Plans involved:** 06-relations.md, parent plan

**Decision:** Relations are preserved when threads are archived.

`archiveByThread` should mark relations as archived (or move to archive storage) but NOT delete them. They remain queryable for "threads that touched this plan" history.

---

### 15. Plan Hierarchy
**Plans involved:** 05-plan-entity.md, parent plan

**Decision:** Plan hierarchy IS in scope. Use file structure to determine hierarchy.

- `parentId` field on PlanMetadata
- Parent-child relationships derived from file structure in the repository
- UI should support nested plan rendering

---

## Dependency/Ordering Decisions

### 16. UI Dependencies
**Plans involved:** 07-ui-inbox.md

**Decision:** 07-ui-inbox.md should include tasks to create missing dependencies.

Components/utilities to create:
- `getThreadDotColor` utility
- `useRelatedPlans(threadId)` hook
- `useRelatedThreadsIncludingArchived(planId)` hook
- `usePlanContent(planId)` hook

Remove references to deleted task components.

---

### 17. Thread-Plan Relation Detection Mechanism
**Plans involved:** 06-relations.md

**Decision:** Events are emitted by the agent runner.

The agent runner emits:
- `THREAD_FILE_CREATED` - when a thread creates a file
- `THREAD_FILE_MODIFIED` - when a thread modifies a file
- `USER_MESSAGE_SENT` - when user sends a message to a thread

The relation service listens to these events and creates/updates relations when the file paths match plan files.

---

## Implementation Gap Decisions

### 18. Plan Content Editing
**Plans involved:** All

**Decision:** Out of scope. Users do not edit plan content within the app.

Agents edit the plan files, not humans. The app may display plan content (read-only) but editing is done via agents or external editors.

---

### 19. Context Hydration Implementation
**Plans involved:** Parent plan only

**Decision:** Defer to separate implementation phase.

Context hydration (injecting plan content into thread context) is a feature that can be implemented after the core thread/plan/relation architecture is in place.

---

### 20. Repository/Worktree Entity
**Plans involved:** 01-core-types.md, 04-thread-refactor.md

**Decision:** Needs clarification - are these already implemented?

This question remains open. Need to verify:
- Does `WorktreeMetadata` type exist?
- Is repository/worktree storage implemented?
- If not, a sub-plan may be needed.

---

## Minor Issue Resolutions

### 21. File Naming Convention
**Decision:** Confirmed: `{planId}-{threadId}.json` for relation files.

### 22. Testing Plan
**Decision:** Testing is implicitly part of each sub-plan. No dedicated testing sub-plan.

### 23. Migration Path
**Decision:** No migration needed. This is greenfield - no existing data to migrate.

---

## Summary

| Category | Resolved |
|----------|----------|
| Type definition decisions | 5 |
| Storage layer decisions | 3 |
| Event system decisions | 1 |
| UI/UX decisions | 6 |
| Dependency decisions | 2 |
| Implementation decisions | 3 |
| Minor decisions | 3 |
| **Total Resolved** | **23** |

**Remaining open:** Question 20 (Repository/Worktree Entity) needs verification of existing implementation.

---

## Action Items

Sub-plans that need updates based on these decisions:

1. **01-core-types.md** - Update timestamp types to `number`, confirm `parentId` naming
2. **02-storage-layer.md** - Remove `planId` from ThreadMetadata
3. **04-thread-refactor.md** - Make `worktreeId` required, use persistence layer directly
4. **05-plan-entity.md** - Update to use `repoId + worktreeId + relativePath`, add `isRead`, use `parentId`
5. **06-relations.md** - Add explicit file format, use persistence layer directly, document event sources
6. **07-ui-inbox.md** - Remove references to `thread.title`, `plan.status`, `plan.title`; add tasks for missing hooks
7. **README.md** - Remove 10-migration.md from the list
