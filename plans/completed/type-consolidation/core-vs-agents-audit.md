# Type Consolidation Audit: Core vs Agents

## Summary of Findings

The codebase shows a **generally well-structured separation** between `core/types/` and `agents/src/` with proper layering in most cases. However, there are important layering violations and areas where types need consolidation.

## Key Findings

### 1. LAYERING VIOLATIONS - @/ imports in agents/src

The agents package is importing from `@/` (frontend paths), which violates layering:

| File | Line | Import |
|------|------|--------|
| `agents/src/runners/task-runner-strategy.ts` | 26 | `from "@/entities/threads/types.js"` |
| `agents/src/orchestration.ts` | 16 | `from "@/entities/threads/types.js"` |
| `agents/src/orchestration.test.ts` | 5 | `from "@/entities/repositories/types.js"` |
| `agents/src/testing/services/test-anvil-directory.ts` | 6 | `from "@/entities/repositories/types.js"` |

### 2. DUPLICATED TYPE DEFINITIONS

#### WorkflowMode
- **Defined in:** `agents/src/agent-types/merge-types.ts` (line 6)
- **Duplicated from:** `src/entities/settings/types.ts`
- **Note:** File has comment acknowledging intentional duplication
- **Recommendation:** Move to `core/types/` as single source of truth

#### ThreadTurnSchema
- **Defined in:** `agents/src/runners/simple-runner-strategy.ts` (line 37)
- **Should be in:** `core/types/threads.ts`
- **Impact:** Thread metadata schemas must match between agents and frontend

#### TaskMetadataOnDiskSchema
- **Defined in:** `agents/src/core/persistence.ts` (line 56)
- **Related to:** `core/types/tasks.ts::TaskMetadataSchema`
- **Status:** Intentional variant with legacy migration support
- **Recommendation:** Document the relationship, keep as persistence-layer specific

#### SimpleTaskMetadataSchema & SimpleThreadMetadataSchema
- **Defined in:** `agents/src/runners/simple-runner-strategy.ts` (lines 13 & 53)
- **Status:** Agent-specific schemas not in core/types

### 3. PROPERLY CONSOLIDATED TYPES

These are already correctly shared:

- ✅ Task types (TaskStatus, TaskMetadata, Subtask, PendingReview) - in `core/types/tasks.ts`
- ✅ Event types (ThreadState, FileChange, ResultMetrics) - in `core/types/events.ts`
- ✅ Agent output protocol types - in `core/types/events.ts`
- ✅ Resolution types - in `core/types/resolution.ts`

### 4. AGENT-SPECIFIC TYPES (Appropriate to remain local)

These are agent-specific and do NOT need to move to core:

- `ValidationResult`, `ValidationContext`, `AgentValidator` in `agents/src/validators/types.ts`
- `RunnerConfig`, `OrchestrationContext`, `RunnerStrategy` in `agents/src/runners/types.ts`
- `AgentTestOptions`, `AgentRunOutput` in `agents/src/testing/types.ts`
- `MergeContext` in `agents/src/agent-types/merge-types.ts`

## Recommendations

### Priority 1: Eliminate @/ imports from agents

Create `core/types/threads.ts` and `core/types/repositories.ts` for shared types, then update:

```typescript
// Before
import { getThreadFolderName } from "@/entities/threads/types.js";
import { RepositorySettings } from "@/entities/repositories/types.js";

// After
import { getThreadFolderName } from "@core/types/threads.js";
import { RepositorySettings } from "@core/types/repositories.js";
```

### Priority 2: Move WorkflowMode to core/types

Remove duplication in `agents/src/agent-types/merge-types.ts`:

```typescript
// Before (in merge-types.ts)
export type WorkflowMode = "solo" | "team";

// After
import { WorkflowMode } from "@core/types/settings.js";
```

### Priority 3: Consolidate Thread-Related Schemas

Move to `core/types/threads.ts`:
- `ThreadTurnSchema`
- `ThreadMetadataSchema`
- `getThreadFolderName()`
- `parseThreadFolderName()`

### Priority 4: Document TaskMetadataOnDiskSchema

The persistence layer's variant of TaskMetadataSchema is intentional for migration support. Add documentation explaining the relationship.

## Files Requiring Updates

After creating `core/types/threads.ts` and `core/types/repositories.ts`:

1. `agents/src/orchestration.ts` - update imports
2. `agents/src/orchestration.test.ts` - update imports
3. `agents/src/runners/task-runner-strategy.ts` - update imports
4. `agents/src/runners/simple-runner-strategy.ts` - remove duplicated schemas
5. `agents/src/testing/services/test-anvil-directory.ts` - update imports
6. `agents/src/agent-types/merge-types.ts` - remove WorkflowMode duplication
