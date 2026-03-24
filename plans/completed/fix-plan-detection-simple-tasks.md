# Fix Plan Detection for Simple Tasks

## Problem

Plan detection is not working for simple tasks launched from the spotlight, despite passing integration tests. When a simple agent creates/modifies a file in the `plans/` directory, no `PLAN_DETECTED` event is emitted and no plan metadata is saved to `.anvil/plans/`.

## Root Cause

The plan detection logic in `agents/src/runners/shared.ts:278` requires `repositoryName` to be set on the task context:

```typescript
if (repositoryName && isPlanPath(filePath, context.workingDir)) {
  // ... create plan entity
}
```

However, `repositoryName` is never set for simple tasks created from the spotlight.

The **integration tests pass** because `AgentTestHarness` pre-creates task metadata with `repositoryName` set before the agent runs. This bypasses the issue.

## Evidence

Task `dd54c0f0-f457-425d-8405-5ad5e6bbc374` shows:
- Thread state confirms a plan file was created at `plans/hello-world.md`
- Task metadata has no `repositoryName` field
- No plan entity was created in `.anvil/plans/`

## Design Problems with Current Approach

### 1. Relative paths are fragile

**Current design**: Plans store `repositoryName` + relative `path`:
```json
{
  "repositoryName": "anvil",
  "path": "plans/hello-world.md"
}
```

**Problems**:
- Requires `repositoryName` to resolve content (lookup `repo.sourcePath` then join with `path`)
- Breaks if repository is renamed or moved
- Extra indirection for a simple file reference

### 2. Worktrees complicate relative paths

A plan at `plans/hello.md` could exist in:
- Main repo: `/Users/zac/repos/anvil/plans/hello.md`
- Worktree: `/Users/zac/repos/anvil-worktrees/feature-x/plans/hello.md`

With relative paths, we need `repositoryName` to know which `sourcePath` to use. But the file might not exist in `sourcePath` if it was created in a worktree on a different branch.

### 3. The agent already has the absolute path

When the Write tool creates a plan file, it has the **full absolute path**:
```
/Users/zac/Documents/juice/anvil/anvil/plans/hello-world.md
```

Converting this to a relative path + repositoryName adds complexity for no benefit.

## Solution: Store Absolute Paths

Store the absolute path directly. This eliminates the need for `repositoryName` in plan detection and simplifies content resolution.

### Schema Change

**`core/types/plans.ts`**:
```typescript
export const PlanMetadataSchema = z.object({
  id: z.string().uuid(),
  /** Absolute path to the plan file */
  absolutePath: z.string(),
  /** Plan title (extracted from filename or first H1) */
  title: z.string(),
  /** Whether user has viewed the plan */
  isRead: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

**Remove**: `path` (relative) and `repositoryName` fields.

### Files to Modify

#### 1. `core/types/plans.ts`
- Replace `path: z.string()` with `absolutePath: z.string()`
- Remove `repositoryName: z.string()`
- Update `CreatePlanInput` to take `absolutePath` instead of `path` + `repositoryName`

#### 2. `agents/src/core/persistence.ts`
- Update `PlanMetadata` interface
- Update `ensurePlanExists(absolutePath)` - no longer needs `repositoryName`
- Update `findPlanByPath(absolutePath)` - simple exact match on `absolutePath`
- Update `createPlan({ absolutePath, title? })`

#### 3. `agents/src/runners/shared.ts`
- Remove the `repositoryName` check - just check `isPlanPath()`
- Pass the absolute `filePath` directly to `persistence.ensurePlanExists(filePath)`
- No need to convert to relative path

```typescript
// BEFORE
if (repositoryName && isPlanPath(filePath, context.workingDir)) {
  let relativePath = filePath;
  if (isAbsolute(filePath)) {
    relativePath = relative(context.workingDir, filePath);
  }
  const { id: planId } = await persistence.ensurePlanExists(repositoryName, relativePath);
}

// AFTER
if (isPlanPath(filePath, context.workingDir)) {
  const { id: planId } = await persistence.ensurePlanExists(filePath);
}
```

#### 4. `src/entities/plans/service.ts`
- Update `getPlanContent()` - just read from `plan.absolutePath` directly
- Remove `getRepositorySourcePath()` helper - no longer needed
- Update `findByPath()` to match on `absolutePath`
- Update `ensurePlanExists()` signature

```typescript
// BEFORE
async getPlanContent(planId: string): Promise<string | null> {
  const plan = usePlanStore.getState().getPlan(planId);
  if (!plan) return null;
  const repoSourcePath = await this.getRepositorySourcePath(plan.repositoryName);
  if (!repoSourcePath) return null;
  const absolutePath = `${repoSourcePath}/${plan.path}`;
  return await fs.readFile(absolutePath);
}

// AFTER
async getPlanContent(planId: string): Promise<string | null> {
  const plan = usePlanStore.getState().getPlan(planId);
  if (!plan) return null;
  return await fs.readFile(plan.absolutePath);
}
```

#### 5. `src/entities/plans/store.ts`
- Update `findByPath(absolutePath)` - simple match on `absolutePath`
- Remove `getByRepository()` if no longer needed (or keep for filtering by path prefix)

#### 6. `agents/src/testing/__tests__/plan-detection.integration.test.ts`
- Update assertions to check `absolutePath` instead of `path` + `repositoryName`

### Migration

For existing plans with relative paths:

```typescript
// In hydrate(), convert old format to new:
if (plan.path && plan.repositoryName && !plan.absolutePath) {
  const repo = repoService.get(plan.repositoryName);
  if (repo?.sourcePath) {
    plan.absolutePath = `${repo.sourcePath}/${plan.path}`;
  }
}
```

## Benefits

1. **Simpler detection**: No `repositoryName` needed - agent just passes the absolute path
2. **Simpler content resolution**: Direct file read, no repository lookup
3. **Worktree-safe**: Absolute path works regardless of which worktree created the file
4. **Self-contained**: Plan metadata has everything needed to read the file

## Trade-offs

1. **Portability**: Absolute paths break if repo moves. Mitigation: Migration on hydrate.
2. **Multi-machine**: Paths differ across machines. Mitigation: Plans are local to the machine anyway.
3. **Grouping by repo**: Harder to query "all plans for repo X". Mitigation: Filter by path prefix or add optional `repositoryName` for grouping only.

## Verification

After implementing:

1. Create a simple task: "Create plans/test.md with content 'test'"
2. Check that:
   - Plan entity exists in `.anvil/plans/`
   - Plan has `absolutePath` field (e.g., `/Users/.../anvil/plans/test.md`)
   - `PLAN_DETECTED` event is emitted
   - Plan content is readable via `planService.getPlanContent()`

3. **Worktree test**: Create plan from a worktree, verify absolute path is correct and content is readable

## Impact

- **Medium risk**: Schema change requires migration for existing plans
- **Simplifies code**: Removes `repositoryName` dependency from plan detection
- **Better worktree support**: Works correctly regardless of which worktree is used
