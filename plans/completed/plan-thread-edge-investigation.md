# Plan-Thread Edge Investigation and Fix Plan

**Status: NEEDS REVISION**

## Summary

The original implementation added event emissions for the frontend to create plan-thread edges. However, **the agent should write relations directly to disk** instead of relying on event-driven frontend processing. Additionally, **refreshing a thread should also refresh its relations**.

### Why Direct Disk Write is Better

1. **Simpler architecture** - No dependency on frontend being open or event bridge working
2. **Agent already has full write access** - `NodePersistence` can write to `~/.anvil/plan-thread-edges/`
3. **More reliable** - No event timing issues or missed events
4. **Consistent with existing pattern** - Agent already writes plan metadata directly via `persistence.ensurePlanExists()`

---

## Problem Statement

When a plan is created or modified by a thread, no `plan-thread-edge` record is being written to storage. The expected behavior is:

1. When a thread creates a plan file (`plans/*.md`), a relation with type `created` should be stored
2. When a thread modifies an existing plan file, a relation with type `modified` should be stored
3. When a user message mentions a plan using `@{relativePath}` syntax, a relation with type `mentioned` should be stored

Additionally:
4. When a thread is refreshed from disk, its relations should also be refreshed

## Current Architecture

### Agent Capabilities

The agent uses `NodePersistence` (`agents/src/lib/persistence-node.ts`) which has full read/write access to `~/.anvil/`:

```typescript
// Agent can already:
await persistence.write("plan-thread-edges/{planId}-{threadId}.json", relationData);
await persistence.read("plan-thread-edges/{planId}-{threadId}.json");
```

### Relation File Format

Relations are stored at `~/.anvil/plan-thread-edges/{planId}-{threadId}.json`:

```typescript
interface PlanThreadRelation {
  planId: string;      // UUID
  threadId: string;    // UUID
  type: 'created' | 'modified' | 'mentioned';
  archived: boolean;
  createdAt: number;   // Unix ms
  updatedAt: number;   // Unix ms
}
```

### Relation Type Precedence

Per Decision #13: Relations can only upgrade, never downgrade.
- `created` (3) > `modified` (2) > `mentioned` (1)

## Fix Proposal

### Part 1: Agent Writes Relations Directly to Disk

**File:** `agents/src/runners/shared.ts`

When the agent detects a plan file creation/modification, write the relation directly:

```typescript
// In PostToolUse hook, after isPlanPath check:
if (isPlanPath(filePath, context.workingDir)) {
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(context.workingDir, filePath);

  // 1. Ensure plan exists (already done)
  const { id: planId } = await persistence.ensurePlanExists({
    repoId: context.repoId,
    absolutePath,
    relativePath,
    title,
  });

  // 2. Write relation directly to disk (NEW)
  const relationType = operation === 'create' ? 'created' : 'modified';
  await persistence.createOrUpgradeRelation({
    planId,
    threadId: context.threadId,
    type: relationType,
  });

  // 3. Emit events for UI refresh
  emitEvent(EventName.PLAN_DETECTED, { planId });
  emitEvent(EventName.RELATION_CREATED, { planId, threadId: context.threadId, type: relationType });
}
```

**Add to persistence module** (`agents/src/core/persistence.ts`):

```typescript
const RELATION_TYPE_PRECEDENCE = {
  mentioned: 1,
  modified: 2,
  created: 3,
} as const;

async createOrUpgradeRelation(params: {
  planId: string;
  threadId: string;
  type: 'created' | 'modified' | 'mentioned';
}): Promise<PlanThreadRelation> {
  const { planId, threadId, type } = params;
  const path = `plan-thread-edges/${planId}-${threadId}.json`;

  // Check for existing relation
  const existing = await this.read<PlanThreadRelation>(path);

  if (existing) {
    // Only upgrade, never downgrade
    if (RELATION_TYPE_PRECEDENCE[type] > RELATION_TYPE_PRECEDENCE[existing.type]) {
      const updated = { ...existing, type, updatedAt: Date.now() };
      await this.write(path, updated);
      return updated;
    }
    return existing;
  }

  // Create new relation
  const now = Date.now();
  const relation: PlanThreadRelation = {
    planId,
    threadId,
    type,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  await this.write(path, relation);
  return relation;
}
```

### Part 2: Relation Listeners Refresh on Thread/Plan Updates

**File:** `src/entities/relations/listeners.ts`

Add listeners for `THREAD_UPDATED` and `PLAN_UPDATED` events to automatically refresh relations:

```typescript
// When thread is updated (e.g., refreshed from disk), refresh its relations
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
  logger.debug(`[relations:listeners] THREAD_UPDATED: refreshing relations for ${threadId}`);
  await relationService.refreshByThread(threadId);
});

// When plan is updated (e.g., refreshed from disk), refresh its relations
eventBus.on(EventName.PLAN_UPDATED, async ({ planId }) => {
  logger.debug(`[relations:listeners] PLAN_UPDATED: refreshing relations for ${planId}`);
  await relationService.refreshByPlan(planId);
});
```

**File:** `src/entities/relations/service.ts`

Add methods to refresh relations for a specific thread or plan:

```typescript
/**
 * Refresh relations for a specific thread from disk.
 * Called when THREAD_UPDATED event is received.
 */
async refreshByThread(threadId: string): Promise<void> {
  const store = useRelationStore.getState();
  const files = await persistence.listDir(RELATIONS_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    if (!file.includes(threadId)) continue; // Quick filter by threadId in filename

    const raw = await persistence.readJson(`${RELATIONS_DIR}/${file}`);
    const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;

    if (result?.success && result.data.threadId === threadId) {
      const key = makeKey(result.data.planId, result.data.threadId);
      const existing = store.relations[key];

      if (!existing) {
        // New relation from disk - add to store (no rollback needed, store-only)
        store._applyCreate(result.data);
      } else if (result.data.updatedAt > existing.updatedAt) {
        // Disk version is newer - update store
        store._applyUpdate(result.data.planId, result.data.threadId, result.data);
      }
    }
  }
}

/**
 * Refresh relations for a specific plan from disk.
 * Called when PLAN_UPDATED event is received.
 */
async refreshByPlan(planId: string): Promise<void> {
  const store = useRelationStore.getState();
  const files = await persistence.listDir(RELATIONS_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    if (!file.includes(planId)) continue; // Quick filter by planId in filename

    const raw = await persistence.readJson(`${RELATIONS_DIR}/${file}`);
    const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;

    if (result?.success && result.data.planId === planId) {
      const key = makeKey(result.data.planId, result.data.threadId);
      const existing = store.relations[key];

      if (!existing) {
        store._applyCreate(result.data);
      } else if (result.data.updatedAt > existing.updatedAt) {
        store._applyUpdate(result.data.planId, result.data.threadId, result.data);
      }
    }
  }
}
```

**Why listeners instead of modifying `refreshById()`:**
- Keeps concerns separated - thread service doesn't need to know about relations
- Works automatically for all refresh triggers (explicit refresh, event-driven, etc.)
- Follows existing pattern in `listeners.ts` (archive events already handled this way)
- Avoids circular dependencies between services

## Implementation Plan

### Phase 1: Add Persistence Method for Relations

**File:** `agents/src/core/persistence.ts`

1. Add `PlanThreadRelation` type import from `@core/types/relations.js`
2. Add `RELATION_TYPE_PRECEDENCE` constant
3. Add `createOrUpgradeRelation()` method

### Phase 2: Agent Writes Relations Directly

**File:** `agents/src/runners/shared.ts`

1. After `ensurePlanExists()` call, add `createOrUpgradeRelation()` call
2. Emit `RELATION_CREATED` event for UI refresh (optional, for immediate UI update)

### Phase 3: Relation Listeners for Thread/Plan Updates

**File:** `src/entities/relations/listeners.ts`

1. Add listener for `THREAD_UPDATED` → calls `relationService.refreshByThread()`
2. Add listener for `PLAN_UPDATED` → calls `relationService.refreshByPlan()`

**File:** `src/entities/relations/service.ts`

1. Add `refreshByThread()` method
2. Add `refreshByPlan()` method

### Phase 4: Testing

**File:** `agents/src/testing/__tests__/plan-thread-relation.integration.test.ts`

1. Test that relation file is created when agent creates a plan
2. Test that relation is upgraded when agent modifies a plan
3. Test that relation type precedence is respected

## Files to Modify

1. `agents/src/core/persistence.ts` - Add `createOrUpgradeRelation()` method
2. `agents/src/runners/shared.ts` - Call persistence method to create relation
3. `src/entities/relations/listeners.ts` - Add listeners for `THREAD_UPDATED` and `PLAN_UPDATED`
4. `src/entities/relations/service.ts` - Add `refreshByThread()` and `refreshByPlan()` methods
5. `agents/src/testing/__tests__/plan-thread-relation.integration.test.ts` - Update tests

## Success Criteria

1. When an agent creates a plan file, a relation file appears at `~/.anvil/plan-thread-edges/{planId}-{threadId}.json`
2. When an agent modifies a plan file, the relation is created or upgraded
3. When `threadService.refreshById()` is called, the thread's relations are also refreshed from disk
4. Relation type precedence is respected (created > modified > mentioned)

## Removed from Scope

- Event-driven relation creation from frontend (replaced by direct disk write)
- `THREAD_FILE_CREATED`/`THREAD_FILE_MODIFIED` event emissions (no longer needed for relations)
