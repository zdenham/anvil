# Sub-plan visual parent should default to parent plan

## Problem

When an agent creates sub-plans (e.g., `plans/auth/readme.md` + `plans/auth/login.md`), the child plans' `visualSettings.parentId` is always set to the worktree ID instead of the parent plan's ID. This causes sub-plans to appear at the tree root in the sidebar rather than nested under their parent plan.

## Root Cause

There are two independent issues that combine to cause this:

### 1. Agent-side `createPlan` doesn't detect parent plans

`agents/src/core/persistence.ts:createPlan()` (line 145–155) always sets `visualSettings.parentId = input.worktreeId`:

```typescript
const plan: PlanMetadata = {
  ...
  visualSettings: {
    parentId: input.worktreeId,  // Always worktree, never parent plan
  },
};
```

It has no equivalent of the frontend's `detectParentPlan()` logic. The `PlanMetadata` interface in this file (line 43–53) doesn't even include `parentId` (domain parent field).

### 2. Frontend `refreshSinglePlanParent` doesn't update visual settings

When the frontend receives `PLAN_DETECTED` from the agent (`src/entities/plans/listeners.ts:12–22`), it calls:
1. `planService.refreshById(planId)` — loads metadata from disk (inheriting wrong `visualSettings.parentId = worktreeId`)
2. `planService.refreshSinglePlanParent(planId)` — updates domain `parentId` but **not** `visualSettings.parentId`

`refreshSinglePlanParent` (`src/entities/plans/service.ts:797–811`) only calls `update()` with `{ parentId: detectedParentId }`, leaving `visualSettings` unchanged.

### Contrast with frontend `create()`

The frontend's own `create()` method (`src/entities/plans/service.ts:193–233`) correctly handles this:
```typescript
const domainParentId = input.parentId ?? this.detectParentPlan(input.relativePath, input.repoId);
visualSettings: { parentId: domainParentId ?? input.worktreeId }
```

But this path is only used when the frontend creates plans directly — agent-created plans go through the persistence → PLAN_DETECTED → refreshById path instead.

## Solution

Fix `refreshSinglePlanParent` to also update `visualSettings.parentId` when it detects a domain parent. This is the correct fix location because:

- It already runs for every agent-created plan (via `PLAN_DETECTED` listener)
- It has access to `detectParentPlan()` which already works correctly
- It avoids duplicating parent-detection logic into the agent-side persistence layer
- It's the single place where domain parent is reconciled, so visual parent should be reconciled here too

**Only update `visualSettings.parentId` if the user hasn't manually repositioned the plan** (i.e., only when visual parent still matches the old domain parent or worktree default).

## Phases

- [x] Update `refreshSinglePlanParent` in `src/entities/plans/service.ts` to sync `visualSettings.parentId`
- [x] Update agent-side `PlanMetadata` interface in `agents/src/core/persistence.ts` to include `parentId` field, and detect parent during `createPlan` when possible
- [x] Add tests for the visual parent defaulting behavior
- [x] Verify with existing plan detection tests (`agents/src/testing/__tests__/plan-detection.integration.test.ts`)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Files

| File | Role |
|------|------|
| `src/entities/plans/service.ts` | Frontend plan service — `refreshSinglePlanParent`, `detectParentPlan`, `create` |
| `agents/src/core/persistence.ts` | Agent-side plan creation — `createPlan`, `ensurePlanExists` |
| `src/entities/plans/listeners.ts` | Event listeners — `PLAN_DETECTED` handler |
| `core/types/plans.ts` | Plan metadata schema (includes `parentId` and `visualSettings`) |
| `core/types/visual-settings.ts` | `VisualSettings` schema (`parentId`, `sortKey`) |

## Implementation Details

### Phase 1: Fix `refreshSinglePlanParent`

In `src/entities/plans/service.ts`, update `refreshSinglePlanParent` to:

```typescript
async refreshSinglePlanParent(planId: string): Promise<void> {
  const plan = this.get(planId);
  if (!plan) return;

  const oldParentId = plan.parentId;
  const detectedParentId = this.detectParentPlan(plan.relativePath, plan.repoId);

  const needsParentUpdate = plan.parentId !== detectedParentId;

  // Sync visual parent if it still matches the old default
  // (don't override manual user repositioning via DnD)
  const currentVisualParent = plan.visualSettings?.parentId;
  const wasDefault = currentVisualParent === oldParentId
    || currentVisualParent === plan.worktreeId
    || !currentVisualParent;
  const newVisualParent = detectedParentId ?? plan.worktreeId;
  const needsVisualUpdate = wasDefault && currentVisualParent !== newVisualParent;

  if (needsParentUpdate || needsVisualUpdate) {
    await this.update(planId, {
      parentId: detectedParentId,
      isRead: plan.isRead,
      ...(needsVisualUpdate && {
        visualSettings: { ...plan.visualSettings, parentId: newVisualParent },
      }),
    });
  }

  if (oldParentId) await this.updateFolderStatus(oldParentId);
  if (detectedParentId) await this.updateFolderStatus(detectedParentId);
}
```

### Phase 2: Agent-side improvement (defense in depth)

In `agents/src/core/persistence.ts`:

1. Add `parentId` to the `PlanMetadata` interface
2. Add a `detectParentPlan` method that scans existing plans on disk
3. Set both `parentId` and `visualSettings.parentId` during `createPlan`

This ensures correct metadata is written to disk from the start, reducing reliance on the frontend fix-up pass.
