# 05: Plan Entity Layer

**Dependencies:** 01-core-types.md, 02-storage-layer.md
**Can run parallel with:** 04-thread-refactor.md, 09-tauri-backend.md

## Goal

Extend the existing plan entity layer to support plan-thread linking, repository filtering, and plan hierarchy.

## Current State

The plan entity layer already exists and follows our standard entity pattern:

**Existing files:**
- `src/entities/plans/store.ts` - Zustand store with optimistic updates
- `src/entities/plans/service.ts` - PlanService with CRUD operations
- `src/entities/plans/listeners.ts` - Event listeners for `PLAN_DETECTED`
- `src/entities/plans/types.ts` - PlanMetadata type and Zod schema
- `src/entities/plans/index.ts` - Public exports
- `src/entities/plans/use-mark-plan-as-read.ts` - Auto-mark-as-read hook

**Existing PlanMetadata type** (`core/types/plans.ts`):
```typescript
interface PlanMetadata {
  id: string           // UUID
  absolutePath: string // Full path to plan file (WILL BE REMOVED)
  isRead: boolean      // Read status
  createdAt: number
  updatedAt: number
}
```

**New PlanMetadata type** (per decisions #2, #3, #5):
```typescript
interface PlanMetadata {
  id: string           // UUID
  repoId: string       // UUID - foreign key to repository
  worktreeId: string   // UUID - foreign key to worktree (main repo is also a worktree)
  relativePath: string // Path relative to repo's plans directory
  parentId?: string    // UUID - For nested plans (hierarchy from file structure)
  isRead: boolean      // For inbox unread state
  createdAt: number    // Unix milliseconds
  updatedAt: number    // Unix milliseconds
}
```

**Key changes:**
- Remove `absolutePath` - use `repoId + worktreeId + relativePath` instead (decision #2)
- No `status` field - status is derived from associated threads via relations (decision #3)
- No `title` field - use `relativePath` for display (decision #3)
- Add `parentId` for hierarchy (decisions #3, #15)
- All timestamps are Unix milliseconds (decision #5)

**Existing store methods:**
- `getAll()`, `getPlan(id)`, `findByPath(absolutePath)`
- `getByPathPrefix(pathPrefix)` - Filter by path prefix
- `getUnreadPlans()` - Get unread plans
- `markPlanAsRead(id)`, `markPlanAsUnread(id)` - Read state management
- `_applyCreate()`, `_applyUpdate()`, `_applyDelete()` - Optimistic methods

**Note:** The `markPlanAsUnread(id)` method already exists. This is used by the relation system when a thread modifies a plan file, marking it as unread so users see it in their inbox.

**Existing service methods:**
- `hydrate()` - Load from `~/.anvil/plans/{id}/metadata.json`
- `create(input)`, `update(id, input)`, `delete(id)`
- `ensurePlanExists(absolutePath)` - Idempotent creation
- `getPlanContent(planId)` - Read actual plan file content
- `refreshById(planId)` - Refresh from disk

## Tasks

### 1. Update PlanMetadata type and schema

Update `src/entities/plans/types.ts` and `core/types/plans.ts`:

```typescript
// core/types/plans.ts
import { z } from 'zod'

export const PlanMetadataSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  worktreeId: z.string().uuid(),
  relativePath: z.string(),
  parentId: z.string().uuid().optional(),
  isRead: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type PlanMetadata = z.infer<typeof PlanMetadataSchema>
```

### 2. Add repository and worktree filtering to store

Update `src/entities/plans/store.ts` to add repository-aware queries:

```typescript
// Add to PlanStoreActions interface:
interface PlanStoreActions {
  // ... existing methods ...

  /** Get plans for a specific repository */
  getByRepository(repoId: string): PlanMetadata[]

  /** Get plans for a specific worktree */
  getByWorktree(worktreeId: string): PlanMetadata[]
}

// Implementation:
getByRepository: (repoId: string) =>
  get()._plansArray.filter((p) => p.repoId === repoId),

getByWorktree: (worktreeId: string) =>
  get()._plansArray.filter((p) => p.worktreeId === worktreeId),
```

**Note:** These replace the old `getByPathPrefix` method. Queries are now direct ID lookups.

### 3. Add plan hierarchy support

Per decision #15, plan hierarchy IS in scope. Add hierarchy methods to store and service.

**Update `src/entities/plans/store.ts`:**

```typescript
// Add to PlanStoreActions interface:
interface PlanStoreActions {
  // ... existing methods ...

  /** Get child plans of a parent plan */
  getChildren(planId: string): PlanMetadata[]

  /** Get root plans (no parent) for a repository */
  getRootPlans(repoId: string): PlanMetadata[]
}

// Implementation:
getChildren: (planId: string) =>
  get()._plansArray.filter((p) => p.parentId === planId),

getRootPlans: (repoId: string) =>
  get()._plansArray.filter((p) => p.repoId === repoId && !p.parentId),
```

**Update `src/entities/plans/service.ts`:**

```typescript
class PlanService {
  // ... existing methods ...

  /**
   * Detect parent plan from file structure.
   * A plan's parent is the plan file in the immediate parent directory.
   *
   * Example: plans/auth/login.md -> parent is plans/auth.md (if it exists)
   */
  detectParentPlan(relativePath: string, repoId: string): string | undefined {
    const parts = relativePath.split('/')
    if (parts.length <= 1) return undefined

    // Check for parent directory plan (e.g., "auth.md" for "auth/login.md")
    const parentDir = parts.slice(0, -1).join('/')
    const parentPlanPath = parentDir + '.md'

    const parentPlan = usePlanStore.getState()
      .getByRepository(repoId)
      .find((p) => p.relativePath === parentPlanPath)

    return parentPlan?.id
  }
}
```

### 4. Update service to use persistence layer directly

Per decision #6, use the existing `persistence` layer. Do NOT create new storage service classes.

**Ensure `src/entities/plans/service.ts` uses persistence:**

```typescript
import { persistence } from '@/core/persistence'

class PlanService {
  async create(input: CreatePlanInput): Promise<PlanMetadata> {
    const id = generateId()
    const now = Date.now()

    const metadata: PlanMetadata = {
      id,
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      relativePath: input.relativePath,
      parentId: this.detectParentPlan(input.relativePath, input.repoId),
      isRead: false,
      createdAt: now,
      updatedAt: now,
    }

    // Use persistence layer directly
    await persistence.savePlanMetadata(metadata)

    usePlanStore.getState()._applyCreate(metadata)
    return metadata
  }

  async update(id: string, input: Partial<PlanMetadata>): Promise<PlanMetadata> {
    const existing = usePlanStore.getState().getPlan(id)
    if (!existing) throw new Error(`Plan not found: ${id}`)

    const updated: PlanMetadata = {
      ...existing,
      ...input,
      updatedAt: Date.now(),
    }

    await persistence.savePlanMetadata(updated)

    usePlanStore.getState()._applyUpdate(updated)
    return updated
  }
}
```

### 5. Verify file watcher integration

The file watcher integration already works:
- Agent runner (`agents/src/runners/shared.ts`) calls `persistence.ensurePlanExists(absolutePath)` when detecting plans
- Agent runner emits `PLAN_DETECTED` event
- Frontend listener (`src/entities/plans/listeners.ts`) receives event and refreshes

**Update the listener to use `eventBus`:**

```typescript
// src/entities/plans/listeners.ts
import { eventBus, EventName } from '@/core/events'

export function setupPlanListeners() {
  eventBus.on(EventName.PLAN_DETECTED, async (event) => {
    const { planId } = event
    await planService.refreshById(planId)
  })
}
```

This is verification only - no new implementation needed.

### 6. Update ensurePlanExists for new schema

Update `ensurePlanExists` to work with the new schema:

```typescript
class PlanService {
  /**
   * Ensure a plan exists for the given file path.
   * Creates the plan if it doesn't exist, returns existing plan if it does.
   */
  async ensurePlanExists(
    repoId: string,
    worktreeId: string,
    relativePath: string
  ): Promise<PlanMetadata> {
    // Check if plan already exists
    const existing = usePlanStore.getState()
      .getByRepository(repoId)
      .find((p) => p.relativePath === relativePath)

    if (existing) return existing

    // Create new plan
    return this.create({ repoId, worktreeId, relativePath })
  }

  /**
   * Find a plan by repository and relative path.
   * Used by the relation detection system to look up plans without absolutePath.
   */
  findByRelativePath(repoId: string, relativePath: string): PlanMetadata | undefined {
    return usePlanStore.getState()
      .getByRepository(repoId)
      .find((p) => p.relativePath === relativePath)
  }

  /**
   * Mark a plan as unread. Called by the relation system when a thread
   * modifies a plan file.
   */
  async markUnread(planId: string): Promise<void> {
    const plan = usePlanStore.getState().getPlan(planId)
    if (!plan) return

    await this.update(planId, { isRead: false })
  }
}
```

### 7. Add path resolution utility

Since we no longer store `absolutePath`, add a utility to resolve the full path:

```typescript
// src/entities/plans/utils.ts
import { repositoryStore } from '@/entities/repositories'
import { worktreeStore } from '@/entities/worktrees'

/**
 * Resolve the absolute path for a plan.
 * Requires looking up the repo/worktree to get the base path.
 */
export function resolvePlanPath(plan: PlanMetadata): string {
  const worktree = worktreeStore.getState().getWorktree(plan.worktreeId)
  if (!worktree) throw new Error(`Worktree not found: ${plan.worktreeId}`)

  const repo = repositoryStore.getState().getRepository(plan.repoId)
  if (!repo) throw new Error(`Repository not found: ${plan.repoId}`)

  return path.join(worktree.path, repo.plansDirectory, plan.relativePath)
}

/**
 * Get the display name for a plan (filename without extension).
 */
export function getPlanDisplayName(plan: PlanMetadata): string {
  const filename = path.basename(plan.relativePath)
  return filename.replace(/\.md$/, '')
}
```

## Acceptance Criteria

- [ ] `PlanMetadata` type updated with `repoId`, `worktreeId`, `relativePath`, `parentId`
- [ ] `absolutePath` field removed from `PlanMetadata`
- [ ] Repository filtering method added (`getByRepository`)
- [ ] Worktree filtering method added (`getByWorktree`)
- [ ] Hierarchy methods added (`getChildren`, `getRootPlans`, `detectParentPlan`)
- [ ] Service uses `persistence` layer directly (no new storage service classes)
- [ ] `ensurePlanExists` updated for new schema
- [ ] Path resolution utility added
- [ ] Listener uses `eventBus` (not `emitter`)
- [ ] All timestamps are Unix milliseconds (numbers)
- [ ] TypeScript compiles
- [ ] All programmatic tests pass (see below)

## Programmatic Testing Plan

Create test file `src/entities/plans/__tests__/plan-entity.test.ts` with the following test suites. **Do not stop until all tests pass.**

### 1. PlanMetadata Schema Tests

```typescript
describe('PlanMetadataSchema', () => {
  it('should validate a complete valid PlanMetadata object', () => {
    // Test with all required fields: id (uuid), repoId (uuid), worktreeId (uuid),
    // relativePath (string), isRead (boolean), createdAt (number), updatedAt (number)
  })

  it('should validate PlanMetadata with optional parentId', () => {
    // Test that parentId is accepted when provided as a valid uuid
  })

  it('should reject PlanMetadata with invalid uuid for id', () => {
    // Test that non-uuid strings are rejected for id field
  })

  it('should reject PlanMetadata with invalid uuid for repoId', () => {
    // Test that non-uuid strings are rejected for repoId field
  })

  it('should reject PlanMetadata with invalid uuid for worktreeId', () => {
    // Test that non-uuid strings are rejected for worktreeId field
  })

  it('should reject PlanMetadata with invalid uuid for parentId', () => {
    // Test that non-uuid strings are rejected for parentId field
  })

  it('should reject PlanMetadata missing required fields', () => {
    // Test that objects missing repoId, worktreeId, or relativePath are rejected
  })

  it('should NOT have absolutePath field in schema', () => {
    // Verify the schema does not accept absolutePath field
    // This confirms the migration away from absolutePath
  })
})
```

### 2. Plan Store Repository/Worktree Filtering Tests

```typescript
describe('usePlanStore filtering', () => {
  beforeEach(() => {
    // Reset store state and populate with test data:
    // - 3 plans for repo-1 (2 in worktree-1, 1 in worktree-2)
    // - 2 plans for repo-2 (all in worktree-3)
  })

  describe('getByRepository', () => {
    it('should return only plans for the specified repository', () => {
      // Call getByRepository('repo-1') and verify exactly 3 plans returned
    })

    it('should return empty array for repository with no plans', () => {
      // Call getByRepository('nonexistent-repo') and verify empty array
    })

    it('should not return plans from other repositories', () => {
      // Verify getByRepository('repo-1') does not include repo-2 plans
    })
  })

  describe('getByWorktree', () => {
    it('should return only plans for the specified worktree', () => {
      // Call getByWorktree('worktree-1') and verify exactly 2 plans returned
    })

    it('should return empty array for worktree with no plans', () => {
      // Call getByWorktree('nonexistent-worktree') and verify empty array
    })
  })
})
```

### 3. Plan Store Hierarchy Tests

```typescript
describe('usePlanStore hierarchy', () => {
  beforeEach(() => {
    // Reset store and populate with hierarchical test data:
    // - root-plan-1 (no parentId, repo-1)
    // - root-plan-2 (no parentId, repo-1)
    // - child-plan-1 (parentId: root-plan-1)
    // - child-plan-2 (parentId: root-plan-1)
    // - grandchild-plan-1 (parentId: child-plan-1)
    // - root-plan-3 (no parentId, repo-2)
  })

  describe('getChildren', () => {
    it('should return direct children of a plan', () => {
      // Call getChildren('root-plan-1') and verify child-plan-1 and child-plan-2 returned
    })

    it('should not return grandchildren', () => {
      // Call getChildren('root-plan-1') and verify grandchild-plan-1 is NOT included
    })

    it('should return empty array for plan with no children', () => {
      // Call getChildren('grandchild-plan-1') and verify empty array
    })

    it('should return empty array for nonexistent plan', () => {
      // Call getChildren('nonexistent-id') and verify empty array
    })
  })

  describe('getRootPlans', () => {
    it('should return only root plans (no parentId) for a repository', () => {
      // Call getRootPlans('repo-1') and verify root-plan-1 and root-plan-2 returned
    })

    it('should not return plans with parentId set', () => {
      // Verify getRootPlans('repo-1') does not include child or grandchild plans
    })

    it('should only return root plans for the specified repository', () => {
      // Call getRootPlans('repo-1') and verify root-plan-3 (repo-2) is NOT included
    })

    it('should return empty array for repository with no plans', () => {
      // Call getRootPlans('nonexistent-repo') and verify empty array
    })
  })
})
```

### 4. Plan Service detectParentPlan Tests

```typescript
describe('PlanService.detectParentPlan', () => {
  beforeEach(() => {
    // Reset store and add plans:
    // - auth.md (relativePath: 'auth.md', repoId: 'repo-1')
    // - features.md (relativePath: 'features.md', repoId: 'repo-1')
  })

  it('should return undefined for root-level plan', () => {
    // detectParentPlan('login.md', 'repo-1') should return undefined
    // (no parent directory to check)
  })

  it('should detect parent plan from directory structure', () => {
    // detectParentPlan('auth/login.md', 'repo-1') should return the id of auth.md
    // because auth.md exists as the parent directory plan
  })

  it('should return undefined when parent plan does not exist', () => {
    // detectParentPlan('users/profile.md', 'repo-1') should return undefined
    // because users.md does not exist
  })

  it('should only detect parent within same repository', () => {
    // detectParentPlan('auth/login.md', 'repo-2') should return undefined
    // even though auth.md exists in repo-1
  })

  it('should handle deeply nested paths', () => {
    // Add 'features/auth.md' to store
    // detectParentPlan('features/auth/oauth.md', 'repo-1') should return id of features/auth.md
  })
})
```

### 5. Plan Service ensurePlanExists Tests

```typescript
describe('PlanService.ensurePlanExists', () => {
  beforeEach(() => {
    // Reset store and mock persistence layer
  })

  it('should return existing plan if it already exists', async () => {
    // Add a plan with relativePath 'existing.md' to store
    // Call ensurePlanExists('repo-1', 'worktree-1', 'existing.md')
    // Verify the existing plan is returned without creating a new one
    // Verify persistence.savePlanMetadata was NOT called
  })

  it('should create new plan if it does not exist', async () => {
    // Call ensurePlanExists('repo-1', 'worktree-1', 'new-plan.md')
    // Verify a new plan is created with correct repoId, worktreeId, relativePath
    // Verify persistence.savePlanMetadata was called
    // Verify plan is added to store
  })

  it('should set isRead to false for newly created plans', async () => {
    // Create new plan and verify isRead is false
  })

  it('should set createdAt and updatedAt to current timestamp', async () => {
    // Create new plan and verify timestamps are recent (within 1 second of Date.now())
  })

  it('should auto-detect and set parentId for nested plans', async () => {
    // Add 'auth.md' plan to store
    // Call ensurePlanExists for 'auth/login.md'
    // Verify parentId is set to auth.md's id
  })
})
```

### 6. Path Resolution Utility Tests

```typescript
describe('resolvePlanPath', () => {
  beforeEach(() => {
    // Mock repositoryStore and worktreeStore with test data:
    // - repo-1: plansDirectory = 'plans'
    // - worktree-1: path = '/home/user/project'
  })

  it('should resolve absolute path from plan metadata', () => {
    // Plan with repoId: 'repo-1', worktreeId: 'worktree-1', relativePath: 'auth.md'
    // Should resolve to '/home/user/project/plans/auth.md'
  })

  it('should handle nested relative paths', () => {
    // Plan with relativePath: 'features/auth/login.md'
    // Should resolve to '/home/user/project/plans/features/auth/login.md'
  })

  it('should throw error if worktree not found', () => {
    // Plan with worktreeId that doesn't exist
    // Should throw 'Worktree not found: ...'
  })

  it('should throw error if repository not found', () => {
    // Plan with repoId that doesn't exist
    // Should throw 'Repository not found: ...'
  })
})

describe('getPlanDisplayName', () => {
  it('should return filename without .md extension', () => {
    // Plan with relativePath: 'auth.md' -> 'auth'
  })

  it('should handle nested paths and return only filename', () => {
    // Plan with relativePath: 'features/auth/login.md' -> 'login'
  })

  it('should preserve filename if no .md extension', () => {
    // Plan with relativePath: 'README' -> 'README'
  })
})
```

### 7. Plan Service CRUD with Persistence Tests

```typescript
describe('PlanService CRUD operations', () => {
  beforeEach(() => {
    // Reset store and mock persistence layer
  })

  describe('create', () => {
    it('should save metadata via persistence layer', async () => {
      // Call create() and verify persistence.savePlanMetadata was called with correct data
    })

    it('should apply optimistic update to store', async () => {
      // Call create() and verify store._applyCreate was called
      // Verify plan appears in store immediately
    })

    it('should generate valid UUID for id', async () => {
      // Call create() and verify returned plan has valid UUID
    })
  })

  describe('update', () => {
    it('should update existing plan via persistence layer', async () => {
      // Add plan to store, call update(), verify persistence.savePlanMetadata called
    })

    it('should update updatedAt timestamp', async () => {
      // Update plan and verify updatedAt changed to recent timestamp
    })

    it('should throw error if plan not found', async () => {
      // Call update() on nonexistent plan and verify error thrown
    })

    it('should preserve fields not included in update', async () => {
      // Update only isRead, verify repoId, worktreeId, relativePath unchanged
    })
  })
})
```

### Test Execution Requirements

1. All tests must use the actual Zod schema from `core/types/plans.ts`
2. Store tests should use the real Zustand store (reset between tests)
3. Service tests should mock the `persistence` layer
4. Path resolution tests should mock `repositoryStore` and `worktreeStore`
5. Use `vitest` or the project's existing test framework
6. Run tests with `npm test` or equivalent and ensure all pass before considering implementation complete

## Notes

**Path Resolution Trade-off:**
Using `repoId + worktreeId + relativePath` instead of `absolutePath` provides:
1. Proper entity relationships (plans belong to repos/worktrees)
2. Enables repository-scoped queries without path prefix matching
3. Survives repository moves without metadata updates
4. Aligns with ThreadMetadata which uses the same pattern

The trade-off is that path resolution requires looking up the repo/worktree to get the base path. The `resolvePlanPath` utility handles this.

**Thread-Plan Relations:**
The plan-thread relationship is managed via the relations table (decision #1). This plan does not add `planId` to ThreadMetadata. See 06-relations.md for the relation system.

**Archive Functionality:**
Plan archival is deferred. When needed, it should:
1. Move the file using the persistence layer
2. Let the file watcher detect the move and emit appropriate events
3. Follow the disk-as-truth pattern (write to disk, then refresh from disk)
