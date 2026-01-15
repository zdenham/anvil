# Plan: Move Thread Types to Core for Shared Validation

## Problem

Thread types are defined in `src/entities/threads/types.ts` (frontend) but imported by:
- `core/services/thread/thread-service.ts` - layering violation (`@/` path from core)
- `agents/src/runners/simple-runner-strategy.ts` - duplicated schemas that diverged

This caused a bug where the simple agent wrote metadata without a `turns` array, but the frontend expected it, so threads were never added to the store.

## Solution

Move thread Zod schemas to `core/types/threads.ts` as the single source of truth, following the pattern established by `core/types/tasks.ts`.

## Known Issues to Address

### 1. ThreadStatusType Duplication in core/types/events.ts

`core/types/events.ts` (line 91) defines `ThreadStatusType` as a workaround:
```typescript
export type ThreadStatusType = "idle" | "running" | "completed" | "error" | "paused";
```

This duplicates the `ThreadStatus` type from frontend. After migration:
- Remove `ThreadStatusType` from `core/types/events.ts`
- Import `ThreadStatus` from `@core/types/threads.js` instead
- Update `EventPayloads` interface to use imported `ThreadStatus`

### 2. ThreadTurnSchema Duplication

`agents/src/runners/simple-runner-strategy.ts` defines a duplicate `ThreadTurnSchema` with comment warning: "Must match frontend's ThreadTurnSchema" - DRY violation with drift risk. Must be consolidated during migration.

### 3. SimpleThreadMetadataSchema Stricter Typing

`simple-runner-strategy.ts` uses stricter typing:
- `agentType: z.literal("simple")` (strict) vs core's `agentType: z.string()` (generic)

**Decision:** Keep the generic `z.string()` in the shared `ThreadMetadataSchema` since it must support all agent types ("entrypoint", "execution", "review", "merge", "research", "simple"). The simple runner can narrow the type in its own code if needed, or we can export an `AgentType` enum/union from the shared types.

## Files to Modify

### 1. Create: `core/types/threads.ts`

Move from `src/entities/threads/types.ts`:
- `ThreadStatus` type alias
- `AgentType` type alias
- `ThreadTurnSchema` and `ThreadTurn` type
- `ThreadMetadataSchema` and `ThreadMetadata` type
- `CreateThreadInput` interface
- `UpdateThreadInput` interface
- `getThreadFolderName()` function
- `parseThreadFolderName()` function

### 2. Update: `core/types/index.ts`

Add export:
```typescript
export * from "./threads.js";
```

### 3. Update: `core/types/events.ts`

- Import `ThreadStatus` from `./threads.js`
- Remove duplicate `ThreadStatusType` definition (line 91)
- Update `EventPayloads` interface to use `ThreadStatus`

### 4. Update: `src/entities/threads/types.ts`

Remove the migrated types entirely. Re-export from core for backwards compatibility:
```typescript
export * from "@core/types/threads.js";
```

This allows existing frontend consumers to continue importing from `@/entities/threads/types` without changes, while the actual types live in core.

### 5. Update: `core/services/thread/thread-service.ts`

Change import from:
```typescript
import type { ... } from '@/entities/threads/types';
```
To:
```typescript
import type { ... } from '@core/types/threads.js';
```

### 6. Update: `core/services/resolution-service.ts`

Change import from `@/entities/threads/types` to `@core/types/threads.js`

### 7. Update: `agents/src/runners/simple-runner-strategy.ts`

Remove duplicated schemas (`ThreadTurnSchema`, `SimpleThreadMetadataSchema`) and import from core:
```typescript
import {
  ThreadTurnSchema,
  ThreadMetadataSchema,
  type ThreadMetadata,
  type ThreadTurn,
} from "@core/types/threads.js";
```

### 8. Update: `agents/src/runners/task-runner-strategy.ts`

Change import:
```typescript
import { getThreadFolderName } from "@/entities/threads/types.js";
```
To:
```typescript
import { getThreadFolderName } from "@core/types/threads.js";
```

### 9. Update: `agents/src/orchestration.ts`

Change import:
```typescript
import { getThreadFolderName } from '@/entities/threads/types.js';
```
To:
```typescript
import { getThreadFolderName } from "@core/types/threads.js";
```

### 10. Update: `agents/src/lib/events.ts`

After `core/types/events.ts` is updated, this file may need to import `ThreadStatus` instead of `ThreadStatusType`.

### 11. Update test files

- `core/services/thread/thread-service.test.ts`
- `core/services/__tests__/resolution-service.test.ts`

Change imports to use `@core/types/threads.js`

## Complete List of Thread Type Consumers

The following files import from `src/entities/threads/types.ts` or use thread types:

### Core Layer (must import from @core/types/threads.js after migration)
| File | Types Used |
|------|------------|
| `core/services/thread/thread-service.ts` | `ThreadMetadata`, `ThreadTurn`, `CreateThreadInput`, `ThreadMetadataSchema`, `getThreadFolderName` |
| `core/services/thread/thread-service.test.ts` | `CreateThreadInput`, `ThreadMetadata` |
| `core/services/resolution-service.ts` | `ThreadMetadataSchema`, `ThreadMetadata` |
| `core/services/__tests__/resolution-service.test.ts` | `ThreadMetadata` |
| `core/types/events.ts` | `ThreadStatusType` (duplicate - consolidate) |

### Agents Layer (must import from @core/types/threads.js after migration)
| File | Types Used |
|------|------------|
| `agents/src/runners/simple-runner-strategy.ts` | Duplicated `ThreadTurnSchema`, `SimpleThreadMetadataSchema` (remove) |
| `agents/src/runners/task-runner-strategy.ts` | `getThreadFolderName` |
| `agents/src/orchestration.ts` | `getThreadFolderName` |
| `agents/src/lib/events.ts` | `ThreadStatusType` (from core/types/events.ts) |

### Frontend Layer (can continue importing from @/entities/threads/types via re-export)
| File | Types Used |
|------|------------|
| `src/entities/threads/store.ts` | `ThreadMetadata`, `ThreadStatus` |
| `src/entities/threads/service.ts` | `ThreadMetadataSchema`, `CreateThreadInput`, `ThreadMetadata`, `ThreadTurn`, `ThreadStatus` |
| `src/entities/tasks/service.ts` | `ThreadMetadataSchema`, `parseThreadFolderName`, `ThreadMetadata` |
| `src/entities/index.ts` | Re-exports all from `./threads/types` |
| `src/lib/tauri-commands.ts` | `ThreadStatus`, `ThreadMetadata` |
| `src/hooks/use-task-threads.ts` | `ThreadMetadata` |
| `src/components/workspace/workspace-sidebar.tsx` | `ThreadMetadata` |
| `src/components/workspace/threads-list.tsx` | `ThreadMetadata` |
| `src/components/workspace/left-menu.tsx` | `ThreadMetadata` |

### Test Files (frontend)
| File | Types Used |
|------|------------|
| `src/test/factories/thread.ts` | `ThreadMetadata`, `ThreadTurn` |
| `src/test/factories/index.ts` | Re-exports `createThreadTurn` |
| `src/test/helpers/stores.ts` | `ThreadMetadata` |
| `src/test/helpers/queries.ts` | Uses thread status helpers |
| `src/test/helpers/index.ts` | Re-exports thread helpers |
| `src/test/mocks/tauri-api.ts` | `MockThreadStatus`, `MockThreadMetadata` (local types) |
| `src/test/helpers/virtual-fs.ts` | `MockThreadMetadata` |

### Components with Local ThreadStatus Definitions (no import needed)
These files define their own local `ThreadStatus` type for UI purposes:
- `src/components/thread/thread-view.tsx` - Local type includes "loading"
- `src/components/thread/status-announcement.tsx` - Local type includes "loading"
- `src/components/workspace/chat-pane.tsx` - Local type includes "loading"
- `src/components/simple-task/simple-task-window.tsx` - Maps entity ThreadStatus to UI type

**Note:** These UI components intentionally have a different `ThreadStatus` that includes "loading" (a UI-only state). They should NOT be changed to import from core.

## Verification

1. Build agents package:
   ```bash
   pnpm --filter @mort/agents build
   ```

2. Run type check:
   ```bash
   pnpm typecheck
   ```

3. Run tests:
   ```bash
   pnpm test
   ```

4. Manual test: Create a simple task and verify the thread appears in the UI (the original bug scenario)
