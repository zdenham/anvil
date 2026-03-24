# Fix Plan Detection Schema Mismatch

## Problem

The agent-side plan detection writes metadata with an incompatible schema that the frontend cannot parse.

**Agent writes** (`agents/src/core/persistence.ts`):
```typescript
{
  id: string;
  absolutePath: string;  // "/Users/.../plans/foo.md"
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}
```

**Frontend expects** (`core/types/plans.ts`):
```typescript
{
  id: string;
  repoId: string;        // UUID - MISSING
  worktreeId: string;    // UUID - MISSING
  relativePath: string;  // "plans/foo.md" - uses absolutePath instead
  parentId?: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}
```

When `PLAN_DETECTED` fires, `planService.refreshById()` calls `PlanMetadataSchema.safeParse()` which fails validation, so the plan is never added to the frontend store.

## Root Cause

1. `repoId` and `worktreeId` are available in `RunnerConfig` (parsed from CLI args)
2. But they're NOT passed to `OrchestrationContext`
3. So `shared.ts` doesn't have access to them when calling `persistence.ensurePlanExists()`
4. The persistence layer only takes `absolutePath` and doesn't know about repo/worktree context

## Solution

### Step 1: Extend OrchestrationContext

**File:** `agents/src/runners/types.ts`

Add `repoId` and `worktreeId` to `OrchestrationContext`:

```typescript
export interface OrchestrationContext {
  workingDir: string;
  threadId: string;
  threadPath: string;
  repoId?: string;      // ADD
  worktreeId?: string;  // ADD
  cleanup?: () => void | Promise<void>;
  permissionMode?: PermissionMode;
}
```

### Step 2: Pass repoId/worktreeId in SimpleRunnerStrategy.setup()

**File:** `agents/src/runners/simple-runner-strategy.ts`

Update the return statement in `setup()` (around line 285):

```typescript
return {
  workingDir: cwd,
  threadId,
  threadPath,
  repoId,       // ADD
  worktreeId,   // ADD
};
```

### Step 3: Update AnvilPersistence interface

**File:** `agents/src/core/persistence.ts`

Update `ensurePlanExists()` and `createPlan()` signatures:

```typescript
interface PlanMetadata {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

async ensurePlanExists(
  repoId: string,
  worktreeId: string,
  absolutePath: string,
  workingDir: string
): Promise<{ id: string; isNew: boolean }> {
  // Convert absolutePath to relativePath
  const relativePath = this.toRelativePath(absolutePath, workingDir);

  // Find existing plan by repoId + relativePath
  const existing = await this.findPlanByPath(repoId, relativePath);
  if (existing) {
    await this.updatePlan(existing.id, { isRead: false });
    return { id: existing.id, isNew: false };
  }

  // Create new plan
  const plan = await this.createPlan({ repoId, worktreeId, relativePath });
  return { id: plan.id, isNew: true };
}

async createPlan(input: {
  repoId: string;
  worktreeId: string;
  relativePath: string
}): Promise<PlanMetadata> {
  const now = Date.now();
  const id = crypto.randomUUID();

  const plan: PlanMetadata = {
    id,
    repoId: input.repoId,
    worktreeId: input.worktreeId,
    relativePath: input.relativePath,
    isRead: false,
    createdAt: now,
    updatedAt: now,
  };

  await this.mkdir(`plans/${id}`);
  await this.write(`plans/${id}/metadata.json`, plan);
  return plan;
}

private toRelativePath(absolutePath: string, workingDir: string): string {
  // Handle symlink resolution (macOS /var -> /private/var)
  const realAbsolute = realpathSync(absolutePath);
  const realWorkDir = realpathSync(workingDir);
  return relative(realWorkDir, realAbsolute);
}

async findPlanByPath(repoId: string, relativePath: string): Promise<PlanMetadata | null> {
  const dirs = await this.listDirs("plans");
  for (const dir of dirs) {
    const plan = await this.read<PlanMetadata>(`plans/${dir}/metadata.json`);
    if (plan && plan.repoId === repoId && plan.relativePath === relativePath) {
      return plan;
    }
  }
  return null;
}
```

### Step 4: Update shared.ts plan detection

**File:** `agents/src/runners/shared.ts`

Update the plan detection in `PostToolUse` hook (around line 286-320):

```typescript
// Detect plan files and create/update plan entity
if (isPlanPath(filePath, context.workingDir)) {
  // Require repoId and worktreeId for plan creation
  if (!context.repoId || !context.worktreeId) {
    logger.warn(`[PostToolUse] Cannot create plan: missing repoId or worktreeId`);
  } else {
    try {
      const { id: planId } = await persistence.ensurePlanExists(
        context.repoId,
        context.worktreeId,
        isAbsolute(filePath) ? filePath : resolve(context.workingDir, filePath),
        context.workingDir
      );
      emitEvent(EventName.PLAN_DETECTED, { planId });
      logger.info(`[PostToolUse] Plan detected: ${filePath} -> ${planId}`);

      // Associate thread with plan...
      // (rest of existing code)
    } catch (err) {
      logger.warn(`[PostToolUse] Failed to create plan entity: ${err}`);
    }
  }
}
```

### Step 5: Update integration tests

**File:** `agents/src/testing/__tests__/plan-detection.integration.test.ts`

Update test assertions to verify the new schema:

```typescript
// Verify plan metadata structure matches frontend schema
expect(planMetadata.id).toBe(planId);
expect(planMetadata.repoId).toBeDefined();
expect(planMetadata.worktreeId).toBeDefined();
expect(planMetadata.relativePath).toBe('plans/hello-world.md');
expect(planMetadata.isRead).toBe(false);
expect(typeof planMetadata.createdAt).toBe('number');
expect(typeof planMetadata.updatedAt).toBe('number');
// Verify absolutePath is NOT present
expect((planMetadata as any).absolutePath).toBeUndefined();
```

## Files to Modify

1. `agents/src/runners/types.ts` - Add repoId/worktreeId to OrchestrationContext
2. `agents/src/runners/simple-runner-strategy.ts` - Pass repoId/worktreeId in setup()
3. `agents/src/core/persistence.ts` - Update schema and methods
4. `agents/src/runners/shared.ts` - Update plan detection to use new API
5. `agents/src/testing/__tests__/plan-detection.integration.test.ts` - Update assertions

## Verification

After implementation, run:
```bash
cd agents && npm run test -- --run src/testing/__tests__/plan-detection.integration.test.ts
```

The tests should pass AND the metadata.json files should now contain `repoId`, `worktreeId`, and `relativePath` instead of `absolutePath`.
