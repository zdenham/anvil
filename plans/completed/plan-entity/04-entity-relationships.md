# 04 - Entity Relationships

**Dependencies:** 01-core-types
**Parallelizable with:** 02-store-service, 03-detection

## Design Decisions

- **UUID Validation**: Use `z.string().uuid()` for planId fields (stricter validation)
- **Null for Unsetting**: Use `null` to explicitly unset plan associations
- **One Plan Per Thread**: Currently one-to-one; may expand to many-to-many in future
- **Add to Base Schema**: For threads, add `planId` to `ThreadMetadataBaseSchema` (not the transform)

## Overview

Add the `planId` field to Task and Thread entities, enabling the association between these entities and Plans.

## Implementation Steps

### 1. Update Task Types

**File:** `core/types/tasks.ts`

Add to `TaskMetadataSchema`:

```typescript
// Add this field to the existing schema
planId: z.string().uuid().optional(),
```

Update `UpdateTaskInput` interface:

```typescript
export interface UpdateTaskInput {
  // ... existing fields
  planId?: string | null;  // null to explicitly unset
}
```

### 2. Update Thread Types

**File:** `core/types/threads.ts`

Add to `ThreadMetadataBaseSchema` (NOT `ThreadMetadataSchema` - that's a transform):

```typescript
// Add this field to ThreadMetadataBaseSchema
planId: z.string().uuid().optional(),
```

Update `UpdateThreadInput` interface:

```typescript
export interface UpdateThreadInput {
  // ... existing fields
  planId?: string | null;  // null to explicitly unset
}
```

### 3. Update Thread Service (if needed)

**File:** `src/entities/threads/service.ts`

Add method to associate thread with plan:

```typescript
async associateWithPlan(threadId: string, planId: string): Promise<void> {
  await this.update(threadId, { planId });
}

async dissociateFromPlan(threadId: string): Promise<void> {
  await this.update(threadId, { planId: null });
}
```

### 4. Update Task Service (if needed)

**File:** `src/entities/tasks/service.ts`

Add method to associate task with plan:

```typescript
async associateWithPlan(taskId: string, planId: string): Promise<void> {
  await this.update(taskId, { planId });
}

async dissociateFromPlan(taskId: string): Promise<void> {
  await this.update(taskId, { planId: null });
}
```

## Type Priority Notes

When displaying a plan in the UI:
1. Check thread's `planId` first (more specific)
2. Fall back to task's `planId` if thread has none
3. Show "No plan" state if neither has a planId

This logic will be implemented in the UI sub-plan (06-ui.md).

## Validation Criteria

- [ ] `TaskMetadataSchema` includes optional `planId` field with UUID validation
- [ ] `ThreadMetadataBaseSchema` includes optional `planId` field with UUID validation
- [ ] Both update input interfaces support `planId?: string | null`
- [ ] Null explicitly unsets the association (not undefined)
- [ ] Existing tasks/threads without planId continue to work (field is optional)
- [ ] TypeScript compiles without errors
- [ ] Zod schemas validate correctly
