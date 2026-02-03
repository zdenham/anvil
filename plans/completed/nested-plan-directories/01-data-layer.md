# Data Layer - Schema & Parent Detection

## Overview

Implement the data model changes and service layer logic for nested plan hierarchies.

**Dependencies**: None
**Parallel with**: 02-tree-state, 04-agent-prompts

---

## Implementation

### 1. Type Changes

**`core/types/plans.ts`**

Add `isFolder` field to track plans that have children:

```typescript
export const PlanMetadataSchema = z.object({
  // ... existing fields
  parentId: z.string().uuid().optional(),
  // NEW: Track if this is a "folder" plan (has a corresponding directory)
  isFolder: z.boolean().optional(),
});
```

### 2. Parent Detection Enhancement

**`src/entities/plans/service.ts`**

Enhance `detectParentPlan()` to support two parent patterns:

1. **Readme pattern**: `plans/my-plan/readme.md` is the parent of `plans/my-plan/other.md`
2. **Sibling file pattern**: `plans/my-plan.md` is the parent of `plans/my-plan/other.md`

Priority: Check for readme.md in the same directory first, then fall back to sibling .md file.

```typescript
/**
 * Detect parent plan from file structure.
 * Supports arbitrary nesting depth.
 *
 * Examples:
 * - plans/auth/login.md -> parent: plans/auth/readme.md (if exists, case-insensitive)
 *                       -> fallback: plans/auth.md (sibling file pattern)
 * - plans/auth/oauth/google.md -> parent: plans/auth/oauth/readme.md (if exists, case-insensitive)
 *                              -> fallback: plans/auth/oauth.md (if exists)
 */
detectParentPlan(relativePath: string, repoId: string): string | undefined {
  const parts = relativePath.split('/');
  const filename = parts[parts.length - 1];

  // readme.md files have no parent within their own directory
  // Their parent would be at the next level up
  if (filename.toLowerCase() === 'readme.md') {
    if (parts.length <= 2) return undefined; // Just "plans/readme.md"
    // Look for parent at directory level above
    const parentDir = parts.slice(0, -2).join('/');
    const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${parentDir}/readme.md`);
    if (readmeParent) return readmeParent.id;
    const siblingParent = this.findByRelativePath(repoId, parts.slice(0, -2).join('/') + '.md');
    if (siblingParent) return siblingParent.id;
    return undefined;
  }

  if (parts.length <= 2) return undefined; // Just "plans/file.md"

  // Walk up the tree looking for nearest ancestor
  for (let i = parts.length - 2; i >= 1; i--) {
    const ancestorDir = parts.slice(0, i + 1).join('/');

    // Pattern 1: Look for readme.md in this directory (case-insensitive)
    const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${ancestorDir}/readme.md`);
    if (readmeParent && readmeParent.relativePath !== relativePath) return readmeParent.id;

    // Pattern 2: Look for sibling .md file (e.g., plans/auth.md for plans/auth/*)
    const siblingPath = ancestorDir + '.md';
    const siblingParent = this.findByRelativePath(repoId, siblingPath);
    if (siblingParent) return siblingParent.id;
  }

  return undefined;
}

/**
 * Find a plan by relative path with case-insensitive filename matching.
 * Used for readme.md detection to handle README.md, Readme.md, etc.
 */
findByRelativePathCaseInsensitive(repoId: string, relativePath: string): PlanMetadata | undefined {
  const dir = relativePath.substring(0, relativePath.lastIndexOf('/'));
  const filename = relativePath.substring(relativePath.lastIndexOf('/') + 1).toLowerCase();

  return this.getByRepo(repoId).find(plan => {
    const planDir = plan.relativePath.substring(0, plan.relativePath.lastIndexOf('/'));
    const planFilename = plan.relativePath.substring(plan.relativePath.lastIndexOf('/') + 1).toLowerCase();
    return planDir === dir && planFilename === filename;
  });
}
```

### 3. Folder Status Detection

**`src/entities/plans/service.ts`**

```typescript
/**
 * Check if a plan acts as a folder (has children).
 */
isFolder(planId: string): boolean {
  return usePlanStore.getState().getChildren(planId).length > 0;
}

/**
 * Recalculate and persist isFolder status for a plan.
 */
async updateFolderStatus(planId: string): Promise<void> {
  const hasChildren = this.isFolder(planId);
  const plan = this.get(planId);
  if (plan && plan.isFolder !== hasChildren) {
    await this.update(planId, { isFolder: hasChildren });
  }
}
```

### 4. Parent Relationship Refresh

**`src/entities/plans/service.ts`**

```typescript
/**
 * Refresh parent relationships for all plans in a repo.
 * Called on startup, file changes, and worktree switch.
 */
async refreshParentRelationships(repoId: string): Promise<void> {
  const plans = this.getByRepo(repoId);

  for (const plan of plans) {
    const detectedParentId = this.detectParentPlan(plan.relativePath, repoId);
    if (plan.parentId !== detectedParentId) {
      await this.update(plan.id, { parentId: detectedParentId });
    }
  }

  // Update folder status for all plans that might have children
  for (const plan of plans) {
    await this.updateFolderStatus(plan.id);
  }
}

/**
 * Refresh parent for a single plan (after file change).
 */
async refreshSinglePlanParent(planId: string): Promise<void> {
  const plan = this.get(planId);
  if (!plan) return;

  const detectedParentId = this.detectParentPlan(plan.relativePath, plan.repoId);
  if (plan.parentId !== detectedParentId) {
    await this.update(planId, { parentId: detectedParentId });
  }

  // Also update the old and new parent's folder status
  if (plan.parentId) await this.updateFolderStatus(plan.parentId);
  if (detectedParentId) await this.updateFolderStatus(detectedParentId);
}
```

### 5. Refresh Hook Points

Wire up refresh calls at these event points:

| Event | Action | Location |
|-------|--------|----------|
| App startup | `refreshParentRelationships(repoId)` | App initialization |
| File watcher change | `refreshSinglePlanParent(planId)` | File watcher handler |
| Plan creation | Detect parent, update parent's folder status | Plan creation service |
| Plan archive/delete | Update parent's folder status, cascade to children | Plan archive service |
| Worktree switch | `refreshParentRelationships(repoId)` | Worktree switch handler |

### 6. Cascading Archive

**`src/entities/plans/service.ts`**

```typescript
/**
 * Archive a plan and all its descendants.
 */
async archiveWithDescendants(planId: string): Promise<void> {
  const descendants = this.getDescendants(planId);

  // Archive in reverse order (deepest children first)
  for (const descendant of descendants.reverse()) {
    await this.archive(descendant.id);
  }

  // Archive the parent last
  await this.archive(planId);
}

/**
 * Get all descendant plans (children, grandchildren, etc.)
 */
getDescendants(planId: string): PlanMetadata[] {
  const children = usePlanStore.getState().getChildren(planId);
  const descendants: PlanMetadata[] = [];

  for (const child of children) {
    descendants.push(child);
    descendants.push(...this.getDescendants(child.id));
  }

  return descendants;
}
```

---

## Checklist

- [ ] Add `isFolder` to PlanMetadataSchema in `core/types/plans.ts`
- [ ] Implement `detectParentPlan()` with readme.md + sibling patterns
- [ ] Implement `findByRelativePathCaseInsensitive()`
- [ ] Implement `isFolder()` and `updateFolderStatus()`
- [ ] Implement `refreshParentRelationships()` and `refreshSinglePlanParent()`
- [ ] Wire up refresh on app startup
- [ ] Wire up refresh on file watcher changes
- [ ] Wire up refresh on plan create
- [ ] Wire up refresh on worktree switch
- [ ] Implement `archiveWithDescendants()` and `getDescendants()`
- [ ] Update plan archive to use cascading archive for folder plans
