# 01 — Visual Settings Foundation

**Layer 0 — blocks all other sub-plans.**

## Summary

Define the shared `VisualSettingsSchema` and add an optional `visualSettings` field to every persistable entity type: `WorktreeState`, `ThreadMetadata`, `PlanMetadata`, `PullRequestMetadata`, `TerminalSession`. Extend existing update input types. Create a shared `updateVisualSettings()` dispatcher.

## Dependencies

None — this is the foundation.

## Key Files

| File | Change |
| --- | --- |
| `core/types/visual-settings.ts` | **New** — `VisualSettingsSchema`, `VisualSettings` type |
| `core/types/index.ts` | Re-export `visual-settings.js` |
| `core/types/threads.ts` | Add `visualSettings` to `ThreadMetadataBaseSchema` (line 26); add to `UpdateThreadInput` (line 90) |
| `core/types/plans.ts` | Add `visualSettings` to `PlanMetadataSchema` (line 26); add to `UpdatePlanInput` (line 55) |
| `core/types/pull-request.ts` | Add `visualSettings` to `PullRequestMetadataSchema` (line 19) |
| `core/types/repositories.ts` | Add `visualSettings` to `WorktreeStateSchema` (line 29) |
| `src/entities/terminal-sessions/types.ts` | Add `visualSettings` to `TerminalSessionSchema` (line 10) |
| `src/entities/pull-requests/service.ts` | Add `"visualSettings"` to the `Pick<>` in `update()` (line 126) |
| `src/lib/visual-settings.ts` | **New** — shared `updateVisualSettings()` dispatcher |

## Current Schema Shapes (Verified)

### `ThreadMetadataBaseSchema` (`core/types/threads.ts:26`)

- Fields: `id`, `repoId`, `worktreeId`, `status`, `turns`, `git`, `changedFilePaths`, `isRead`, `markedUnreadAt`, `pid`, `name`, `createdAt`, `updatedAt`, `_isOptimistic`, `parentThreadId`, `parentToolUseId`, `agentType`, `lastCallUsage`, `cumulativeUsage`, `permissionMode`
- Has `.transform()` applied (`ThreadMetadataSchema = ThreadMetadataBaseSchema.transform(...)` at line 63)
- `UpdateThreadInput` is a plain interface (not Zod) at line 90 — extend with `visualSettings`

### `PlanMetadataSchema` (`core/types/plans.ts:26`)

- Fields: `id`, `repoId`, `worktreeId`, `relativePath`, `parentId`, `isFolder`, `isRead`, `markedUnreadAt`, `stale`, `lastVerified`, `createdAt`, `updatedAt`, `phaseInfo`
- `UpdatePlanInput` is a plain interface at line 55 — extend with `visualSettings`

### `PullRequestMetadataSchema` (`core/types/pull-request.ts:19`)

- Fields: `id`, `prNumber`, `repoId`, `worktreeId`, `repoSlug`, `headBranch`, `baseBranch`, `autoAddressEnabled`, `gatewayChannelId`, `isViewed`, `createdAt`, `updatedAt`
- `pullRequestService.update()` at `src/entities/pull-requests/service.ts:124` uses `Partial<Pick<PullRequestMetadata, "worktreeId" | "autoAddressEnabled" | "gatewayChannelId" | "isViewed">>` — add `"visualSettings"` to the union

### `WorktreeStateSchema` (`core/types/repositories.ts:29`)

- Fields: `id`, `path`, `name`, `createdAt`, `lastAccessedAt`, `currentBranch`, `isRenamed`
- Lives inside `RepositorySettings.worktrees[]` array (line 83: `worktrees: z.array(WorktreeStateSchema).default([])`)
- Persisted at `~/.mort/repositories/{repo-slug}/settings.json`
- Updates go through `loadSettings(slug)` / `saveSettings(slug, settings)` from `src/lib/app-data-store.ts`
- No dedicated worktree update method exists in `src/entities/worktrees/service.ts` — all operations go through Rust invoke commands

### `TerminalSessionSchema` (`src/entities/terminal-sessions/types.ts:10`)

- Fields: `id`, `worktreeId`, `worktreePath`, `lastCommand`, `createdAt`, `isAlive`, `isArchived`
- **Currently runtime-only** — no disk persistence. `id` is `String(numericPtyId)` from Rust backend
- Terminal service at `src/entities/terminal-sessions/service.ts` uses store's `updateSession(id, updates: Partial<TerminalSession>)` for in-memory updates

## Implementation

### 1. Create `VisualSettingsSchema` (`core/types/visual-settings.ts`)

Create this **new file**:

```typescript
import { z } from "zod";

export const VisualSettingsSchema = z.object({
  /** Visual tree parent ID. Undefined = tree root (worktrees) or worktree root (new items). */
  parentId: z.string().optional(),
  /** Lexicographic sort key for ordering within parent. Undefined = sort by createdAt. */
  sortKey: z.string().optional(),
});

export type VisualSettings = z.infer<typeof VisualSettingsSchema>;
```

### 2. Re-export from `core/types/index.ts`

Add the following line at the end of `core/types/index.ts` (after the `comments.js` re-export on line 71):

```typescript
// Visual settings - sidebar tree positioning
export * from "./visual-settings.js";
```

This follows the existing `export *` barrel pattern used for all other core type modules.

### 3. Add `visualSettings` to each Zod schema

Each addition is a single field line inside the `z.object({...})`. Import `VisualSettingsSchema` from `./visual-settings.js`.

**`core/types/threads.ts`** — Add import and field:

```typescript
// Add to imports at top (line 2):
import { VisualSettingsSchema } from './visual-settings.js';

// Add after permissionMode field (after line 56, inside the z.object):
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
```

The field goes after the `permissionMode` field (line 56) and before the closing `});` of `ThreadMetadataBaseSchema`.

**`core/types/plans.ts`** — Add import and field:

```typescript
// Add to imports (after line 1):
import { VisualSettingsSchema } from './visual-settings.js';

// Add after phaseInfo field (after line 39, inside the z.object):
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
```

The field goes after `phaseInfo` (line 39) and before the closing `});` of `PlanMetadataSchema`.

**`core/types/pull-request.ts`** — Add import and field:

```typescript
// Add to imports (after line 1):
import { VisualSettingsSchema } from './visual-settings.js';

// Add after updatedAt field (after line 49, inside the z.object):
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
```

The field goes after `updatedAt` (line 49) and before the closing `});` of `PullRequestMetadataSchema`.

**`core/types/repositories.ts`** — Add import and field:

```typescript
// Add to imports (after line 1):
import { VisualSettingsSchema } from './visual-settings.js';

// Add after isRenamed field (after line 43, inside the z.object):
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
```

The field goes after `isRenamed` (line 43) and before the closing `});` of `WorktreeStateSchema`.

**`src/entities/terminal-sessions/types.ts`** — Add import and field:

```typescript
// Add to imports (after line 5):
import { VisualSettingsSchema } from "@core/types/visual-settings.js";

// Add after isArchived field (after line 24, inside the z.object):
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
```

The field goes after `isArchived` (line 24) and before the closing `});` of `TerminalSessionSchema`.

### 4. Extend update input types

**`core/types/threads.ts`** — Extend `UpdateThreadInput` (line 90):

Add `visualSettings` to the existing interface. The import of `VisualSettingsSchema` was already added in step 3. Use the `VisualSettings` type:

```typescript
// In UpdateThreadInput interface, add after permissionMode field (line 102):
  visualSettings?: z.infer<typeof VisualSettingsSchema>;
```

The full `UpdateThreadInput` interface becomes:

```typescript
export interface UpdateThreadInput {
  status?: ThreadStatus;
  turns?: ThreadTurn[];
  git?: {
    branch: string;
    initialCommitHash?: string;
    commitHash?: string;
  };
  isRead?: boolean;
  pid?: number | null;
  changedFilePaths?: string[];
  name?: string;
  permissionMode?: "plan" | "implement" | "approve";
  visualSettings?: z.infer<typeof VisualSettingsSchema>;
}
```

**`core/types/plans.ts`** — Extend `UpdatePlanInput` (line 55):

```typescript
// In UpdatePlanInput interface, add after phaseInfo field (line 59):
  visualSettings?: z.infer<typeof VisualSettingsSchema>;
```

The full `UpdatePlanInput` interface becomes:

```typescript
export interface UpdatePlanInput {
  isRead?: boolean;
  parentId?: string;
  isFolder?: boolean;
  phaseInfo?: PhaseInfo;
  visualSettings?: z.infer<typeof VisualSettingsSchema>;
}
```

### 5. Extend service update types

**`src/entities/pull-requests/service.ts:124`** — Add `"visualSettings"` to the `Pick<>`:

```typescript
// Before (lines 126-129):
    updates: Partial<
      Pick<
        PullRequestMetadata,
        "worktreeId" | "autoAddressEnabled" | "gatewayChannelId" | "isViewed"
      >
    >,

// After:
    updates: Partial<
      Pick<
        PullRequestMetadata,
        "worktreeId" | "autoAddressEnabled" | "gatewayChannelId" | "isViewed" | "visualSettings"
      >
    >,
```

**Terminal service** (`src/entities/terminal-sessions/service.ts`): No change needed. The existing `updateSession(id, updates: Partial<TerminalSession>)` store method already accepts partial updates, and `visualSettings` will be included via the updated `TerminalSession` type.

**Thread service** (`src/entities/threads/service.ts`): No change needed. The `update()` method at line 258 already spreads `updates: UpdateThreadInput` into the thread object.

**Plan service** (`src/entities/plans/service.ts`): No change needed. The `update()` method at line 235 already spreads `input: UpdatePlanInput` into `updates`.

### 6. `updateVisualSettings()` dispatcher (`src/lib/visual-settings.ts`)

Create this **new file**:

```typescript
import type { VisualSettings } from "@core/types/visual-settings.js";
import { logger } from "@/lib/logger-client";

type VisualEntityType = "thread" | "plan" | "pull-request" | "terminal" | "folder" | "worktree";

/**
 * Updates visualSettings on any entity type.
 * Single entry point for DnD drop handler and "Move to..." context menu.
 */
export async function updateVisualSettings(
  entityType: VisualEntityType,
  entityId: string,
  patch: Partial<VisualSettings>,
): Promise<void> {
  switch (entityType) {
    case "thread": {
      const { threadService } = await import("@/entities/threads/service");
      const thread = threadService.get(entityId);
      if (!thread) throw new Error(`Thread not found: ${entityId}`);
      const merged: VisualSettings = { ...thread.visualSettings, ...patch };
      await threadService.update(entityId, { visualSettings: merged });
      break;
    }
    case "plan": {
      const { planService } = await import("@/entities/plans/service");
      const plan = planService.get(entityId);
      if (!plan) throw new Error(`Plan not found: ${entityId}`);
      const merged: VisualSettings = { ...plan.visualSettings, ...patch };
      // IMPORTANT: planService.update() marks as unread unless isRead is explicit.
      // Always pass isRead: plan.isRead to preserve the current read state.
      await planService.update(entityId, { visualSettings: merged, isRead: plan.isRead });
      break;
    }
    case "pull-request": {
      const { pullRequestService } = await import("@/entities/pull-requests/service");
      const pr = pullRequestService.get(entityId);
      if (!pr) throw new Error(`PR not found: ${entityId}`);
      const merged: VisualSettings = { ...pr.visualSettings, ...patch };
      await pullRequestService.update(entityId, { visualSettings: merged });
      break;
    }
    case "terminal": {
      const { useTerminalSessionStore } = await import("@/entities/terminal-sessions/store");
      const session = useTerminalSessionStore.getState().getSession(entityId);
      if (!session) throw new Error(`Terminal not found: ${entityId}`);
      const merged: VisualSettings = { ...session.visualSettings, ...patch };
      useTerminalSessionStore.getState().updateSession(entityId, { visualSettings: merged });
      // Note: Disk write will be handled by 02a-terminal-persistence
      break;
    }
    case "folder": {
      // Placeholder — implemented in 02b-folder-entity
      logger.warn("[updateVisualSettings] folder entity not yet implemented");
      break;
    }
    case "worktree": {
      // Placeholder — implemented in 03-unified-tree-model
      // Will need to: find repo slug by iterating repos, load settings.json,
      // find worktree in array, merge visualSettings, save settings.json
      logger.warn("[updateVisualSettings] worktree entity not yet implemented");
      break;
    }
  }
}
```

### 7. Gotcha: `planService.update()` marks as unread

`planService.update()` at `src/entities/plans/service.ts:245` has: `isRead: input.isRead ?? false`. This means ANY update marks the plan as unread unless `isRead` is explicitly passed. When calling `planService.update()` for visualSettings changes, **always** pass `isRead: existingPlan.isRead` to preserve the current read state. This is already handled in the dispatcher above.

## Verification

After implementation, run these commands to verify:

```bash
# Type check
cd /Users/zac/.mort/repositories/mortician/ivory-dragonfly && pnpm tsc --noEmit

# Run tests
cd /Users/zac/.mort/repositories/mortician/ivory-dragonfly && pnpm test
```

Key things to verify:
- Existing entity JSON files without `visualSettings` still parse cleanly (since all additions use `.optional()`)
- No type errors from downstream consumers of the modified types
- All existing tests pass unchanged

## Acceptance Criteria

- [x] `VisualSettingsSchema` exists in `core/types/visual-settings.ts` with `parentId` and `sortKey` fields

- [x] Re-export added to `core/types/index.ts`

- [x] All five entity schemas include `visualSettings: VisualSettingsSchema.optional()`

- [x] `UpdateThreadInput` includes `visualSettings?: z.infer<typeof VisualSettingsSchema>`

- [x] `UpdatePlanInput` includes `visualSettings?: z.infer<typeof VisualSettingsSchema>`

- [x] PR `update()` method's `Pick<>` type includes `"visualSettings"`

- [ ] Existing entity JSON without `visualSettings` still parses cleanly (tested via existing test suite)

- [x] `updateVisualSettings()` dispatcher exists in `src/lib/visual-settings.ts`

- [ ] TypeScript compiles: `pnpm tsc --noEmit`

- [ ] Existing tests pass: `pnpm test`

## Phases

- [x] Create `VisualSettingsSchema` and `VisualSettings` type in `core/types/visual-settings.ts`; add `export * from "./visual-settings.js"` to `core/types/index.ts`

- [x] Add `visualSettings: VisualSettingsSchema.optional()` field to all five entity Zod schemas (`ThreadMetadataBaseSchema`, `PlanMetadataSchema`, `PullRequestMetadataSchema`, `WorktreeStateSchema`, `TerminalSessionSchema`); extend `UpdateThreadInput` and `UpdatePlanInput` interfaces; add `"visualSettings"` to PR service `Pick<>` type

- [x] Create `updateVisualSettings()` dispatcher in `src/lib/visual-settings.ts`

- [ ] Verify existing JSON fixtures still parse and tests pass (`pnpm test`, `pnpm tsc --noEmit`)

<!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
