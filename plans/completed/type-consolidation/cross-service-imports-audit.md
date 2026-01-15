# Cross-Service Imports Audit Report

## Executive Summary

The codebase has **significant layering violations** where both `core/` and `agents/` directories import types from `src/entities/` (the frontend package). This violates the intended architecture where:

- **core/** = Node.js-compatible shared services (can run in Node or browser)
- **agents/** = Node.js-only agent code
- **src/** = Tauri frontend (should not have backward dependencies)

**10 files in core/ directory** have `@/entities/` imports (5 files in tests, 5 in services).
**4 files in agents/ directory** have `@/entities/` imports.

## Layering Violations Found

### Core Directory - 10 Violations

#### Services (5 violations):

1. **core/services/thread/thread-service.ts**
   - Imports: `ThreadMetadata`, `CreateThreadInput`, `UpdateThreadInput`, `ThreadTurn`, `getThreadFolderName`, `ThreadMetadataSchema`
   - From: `@/entities/threads/types`

2. **core/services/resolution-service.ts**
   - Imports: `ThreadMetadataSchema`, `ThreadMetadata`
   - From: `@/entities/threads/types`

3. **core/services/worktree/allocation-service.ts**
   - Imports: `RepositorySettings`, `WorktreeState` (types only)
   - From: `@/entities/repositories/types`

4. **core/services/worktree/worktree-pool-manager.ts**
   - Imports: `WorktreeState`, `RepositorySettings` (types only)
   - From: `@/entities/repositories/types`

5. **core/services/repository/settings-service.ts**
   - Imports: `RepositorySettings`, `WorktreeClaim` (types), `RepositorySettingsSchema`
   - From: `@/entities/repositories/types`

#### Tests (5 violations):

6. **core/services/thread/thread-service.test.ts** - imports from `@/entities/threads/types`
7. **core/services/__tests__/resolution-service.test.ts** - imports from `@/entities/threads/types`
8. **core/services/repository/settings-service.test.ts** - imports from `@/entities/repositories/types`
9. **core/services/worktree/allocation-service.test.ts** - imports from `@/entities/repositories/types`
10. **core/services/worktree/worktree-pool-manager.test.ts** - imports from `@/entities/repositories/types`

### Agents Directory - 4 Violations

1. **agents/src/orchestration.ts**
   - Imports: `getThreadFolderName`
   - From: `@/entities/threads/types.js`

2. **agents/src/runners/task-runner-strategy.ts**
   - Imports: `getThreadFolderName`
   - From: `@/entities/threads/types.js`

3. **agents/src/testing/services/test-mort-directory.ts**
   - Imports: `RepositorySettings`
   - From: `@/entities/repositories/types.js`

4. **agents/src/orchestration.test.ts**
   - Imports: `RepositorySettings`
   - From: `@/entities/repositories/types.js`

## Types That Need Migration to Core

### From `src/entities/threads/types.ts` → `core/types/threads.ts`

| Type | Used In | Files Affected |
|------|---------|----------------|
| `ThreadMetadata` | core services, agents, frontend | 12+ files |
| `ThreadTurn` | core services, frontend | 5+ files |
| `ThreadStatus` | core events, frontend, agents | 10+ places |
| `CreateThreadInput` | core services | 1 file |
| `UpdateThreadInput` | core services | 1 file |
| `getThreadFolderName()` | core services, agents | 3 files |
| `parseThreadFolderName()` | frontend | 1 file |

### From `src/entities/repositories/types.ts` → `core/types/repositories.ts`

| Type | Used In | Files Affected |
|------|---------|----------------|
| `RepositorySettings` | core services, agents, frontend | 7+ files |
| `WorktreeState` | core services, events | 4 files |
| `WorktreeClaim` | core services | 1 file |
| `TaskBranchInfo` | core services (nested in RepositorySettings) | 1+ files |
| `RepositoryMetadata` | frontend only | Keep in src |

**Note:** `TaskBranchInfo` and `TaskBranchInfoSchema` must be migrated because they are nested inside `RepositorySettingsSchema` (via the `taskBranches` field). Core services that use `RepositorySettings` depend on this type.

## Implementation Plan

### Phase 1: Create Core Type Files

#### 1. Create `core/types/threads.ts`

Move from `src/entities/threads/types.ts`:
- `ThreadMetadata` and `ThreadMetadataSchema`
- `ThreadTurn` and `ThreadTurnSchema`
- `ThreadStatus` type
- `AgentType` type
- `CreateThreadInput` interface
- `UpdateThreadInput` interface
- `getThreadFolderName()` function
- `parseThreadFolderName()` function

#### 2. Create `core/types/repositories.ts`

Move from `src/entities/repositories/types.ts`:
- `RepositorySettings` and `RepositorySettingsSchema`
- `WorktreeClaim` and `WorktreeClaimSchema`
- `WorktreeState` and `WorktreeStateSchema`
- `TaskBranchInfo` and `TaskBranchInfoSchema` (required by RepositorySettingsSchema)

### Phase 2: Update Core Imports

Update all 10 files in `core/` to import from `@core/types/`:

```typescript
// Before
import { ThreadMetadata } from "@/entities/threads/types";
import { RepositorySettings } from "@/entities/repositories/types";

// After
import { ThreadMetadata } from "@core/types/threads.js";
import { RepositorySettings } from "@core/types/repositories.js";
```

### Phase 3: Update Agent Imports

Update all 4 files in `agents/` to import from `@core/types/`:

```typescript
// Before
import { getThreadFolderName } from "@/entities/threads/types.js";

// After
import { getThreadFolderName } from "@core/types/threads.js";
```

### Phase 4: Update Frontend Imports

Update all frontend files to import from `@core/types/` directly:

```typescript
// Before
import { ThreadMetadata } from "@/entities/threads/types";

// After
import { ThreadMetadata } from "@core/types/threads.js";
```

Remove migrated types from `src/entities/threads/types.ts` and `src/entities/repositories/types.ts`. Keep only frontend-specific types (e.g., `RepositoryMetadata`, `Repository`, `RepositoryVersion`).

## Verification

After implementation:

```bash
# Verify no @/ imports in core/
grep -r "import.*@/" core/ --include="*.ts" --include="*.tsx"
# Should return no results

# Verify no @/entities/ imports in agents/
grep -r "import.*@/entities" agents/ --include="*.ts" --include="*.tsx"
# Should return no results

# Type check
pnpm typecheck

# Run tests
pnpm test
```

## Summary Statistics

| Category | Count |
|----------|-------|
| Files with violations | 14 |
| Core service files | 5 |
| Core test files | 5 |
| Agent code files | 2 |
| Agent test files | 2 |
| Types to migrate | 11 |
| Functions to migrate | 2 |
| New core files to create | 2 |

**Note:** Types to migrate includes `TaskBranchInfo` which is a dependency of `RepositorySettingsSchema`.
