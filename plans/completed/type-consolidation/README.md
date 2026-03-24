# Type Consolidation Audit

This directory contains audit reports identifying type duplication and layering violations across the codebase.

## Summary of Findings

### Critical Issues

| Issue | Severity | Files Affected |
|-------|----------|----------------|
| `@/` imports in `core/` | High | 10 files |
| `@/` imports in `agents/` | High | 5 files |
| Thread types not in core | High | 13+ consumers |
| Repository types not in core | Medium | 7+ consumers |
| WorkspaceSettings schema divergence | **Critical** | 2 files (different fields!) |
| ThreadTurnSchema duplication | High | 2 files (agents + frontend) |
| Schema duplication in simple-runner-strategy.ts | High | 3 schemas duplicated |

### Root Cause

Types defined in `src/entities/` are imported by `core/` and `agents/`, creating layering violations. The frontend should not be a dependency of shared services.

## Audit Reports

1. **[shared-thread-types.md](./shared-thread-types.md)** - Original plan for thread type consolidation
2. **[core-vs-frontend-audit.md](./core-vs-frontend-audit.md)** - Types shared between core and frontend
3. **[core-vs-agents-audit.md](./core-vs-agents-audit.md)** - Types shared between core and agents
4. **[cross-service-imports-audit.md](./cross-service-imports-audit.md)** - All layering violations
5. **[zod-schema-audit.md](./zod-schema-audit.md)** - Zod schema inventory and duplication check

## Recommended Actions

### Phase 1: Create Core Type Files

```
core/types/
├── threads.ts      # NEW - ThreadMetadata, ThreadTurn, etc.
├── repositories.ts # NEW - RepositorySettings, WorktreeState, etc.
├── tasks.ts        # EXISTS - already consolidated
├── events.ts       # EXISTS - already consolidated
└── resolution.ts   # EXISTS - already consolidated
```

### Phase 2: Migrate Types

**To `core/types/threads.ts`:**
- `ThreadMetadata` + schema
- `ThreadTurn` + schema
- `ThreadStatus` type
- `AgentType` type
- `CreateThreadInput`, `UpdateThreadInput` interfaces
- `getThreadFolderName()`, `parseThreadFolderName()` functions

**To `core/types/repositories.ts`:**
- `RepositorySettings` + schema
- `WorktreeState` + schema
- `WorktreeClaim` + schema
- `TaskBranchInfo` + schema (nested inside RepositorySettingsSchema, must migrate together)

### Phase 3: Update All Imports

Update all consumers to import from `@core/types/` instead of `@/entities/`:

**Core (10 files):**
- 5 service files
- 5 test files

**Agents (5 files):**
- 3 code files (orchestration.ts, task-runner-strategy.ts, test-anvil-directory.ts)
- 2 test files (orchestration.test.ts, exports.test.ts)

**Agents schema deduplication (simple-runner-strategy.ts):**
- Remove local `ThreadTurnSchema` - import from `@core/types/threads.js`
- Remove local `SimpleThreadMetadataSchema` - derive from core's `ThreadMetadataSchema`
- Remove local `SimpleTaskMetadataSchema` - derive from core's `TaskMetadataSchema`

**Frontend (all files importing moved types):**
- Update to use `@core/types/threads.js` and `@core/types/repositories.js`
- Remove migrated types from `src/entities/threads/types.ts` and `src/entities/repositories/types.ts`
- Keep only frontend-specific types in entity files

## Verification

```bash
# Verify no @/ imports in core/
grep -r "from ['\"]@/" core/ --include="*.ts" | grep -v "@core"

# Verify no @/entities/ imports in agents/
grep -r "from ['\"]@/entities" agents/ --include="*.ts"

# Type check
pnpm typecheck

# Run tests
pnpm test
```

## What's Already Good

- Task types properly consolidated in `core/types/tasks.ts`
- Event types properly consolidated in `core/types/events.ts`
- Proper use of `z.infer<>` for type derivation throughout
- Schemas positioned at trust boundaries

## Known Schema Duplications (Require Consolidation)

The codebase has **41 Zod schemas across 18 files**, with the following duplications:

| Schema | Files | Issue |
|--------|-------|-------|
| `WorkspaceSettingsSchema` | `src/entities/settings/types.ts`, `src/lib/workspace-settings-service.ts` | **CRITICAL: Different fields** - entities version has `workflowMode`, lib version is missing it |
| `ThreadTurnSchema` | `src/entities/threads/types.ts`, `agents/src/runners/simple-runner-strategy.ts` | Duplicated with comment warning about drift |
| `SimpleThreadMetadataSchema` | `agents/src/runners/simple-runner-strategy.ts` | Uses stricter `agentType: z.literal("simple")` vs generic string |
| `SimpleTaskMetadataSchema` | `agents/src/runners/simple-runner-strategy.ts` | Local schema duplicating core patterns |

### Immediate Fix Required

The `WorkspaceSettingsSchema` divergence is a **live bug** that could cause:
- Runtime validation failures when loading settings with `workflowMode`
- Silent data loss when saving settings through `workspace-settings-service.ts`

**Fix:** Remove duplicate schema from `src/lib/workspace-settings-service.ts` and import from `@/entities/settings/types`.
