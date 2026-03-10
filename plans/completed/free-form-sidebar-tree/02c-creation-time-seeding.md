# 02c — Creation-Time Visual Settings Seeding

**Layer 1 — parallel with 02a, 02b, 02d. Depends on 01.**

## Summary

Audit all entity creation codepaths and set `visualSettings.parentId` at creation time. Since the tree builder will read *only* `visualSettings.parentId` for placement (no fallback to domain relationships), every entity must have it set correctly on creation.

This sub-plan covers **threads, plans, and PRs**. Terminal seeding is handled in 02a.

## Dependencies

- **01-visual-settings-foundation** — `visualSettings` field must exist on entity schemas, `VisualSettings` type must be importable

## Seeding Rules

| Entity | Domain relationship | Initial `visualSettings.parentId` |
| --- | --- | --- |
| Thread (root) | no `parentThreadId` | worktreeId |
| Thread (sub-agent) | has `parentThreadId` | parentThreadId |
| Plan (root) | no domain `parentId` detected | worktreeId |
| Plan (child) | has domain `parentId` (detected or explicit) | domain parentId |
| Pull Request | none | worktreeId |

## All Creation Paths (Audit)

### Thread Creation Paths

There are **four** distinct codepaths that create thread metadata:

| # | Location | Description | Has `parentThreadId`? |
|---|----------|-------------|----------------------|
| T1 | `core/services/thread/thread-service.ts` — `ThreadService.create()` (line 36) | Core service used by nobody currently (frontend uses T2, agents use T3/T4) | No — `CreateThreadInput` has no `parentThreadId` field |
| T2 | `src/entities/threads/service.ts` — `threadService.create()` (line 185) | Frontend service, writes to disk via optimistic pattern | No |
| T3 | `agents/src/runners/simple-runner-strategy.ts` — `SimpleRunnerStrategy.setup()` new-thread branch (line 374) | Agent runner, writes metadata directly with `writeFileSync` | Optional — reads `config.parentThreadId` |
| T4 | `agents/src/runners/shared.ts` — `runAgentLoop()` PreToolUse hook for Task/Agent tools (line 770) | Sub-agent spawn, writes metadata directly with `writeFileSync` | Always — sets `parentThreadId: context.threadId` |

**Optimistic threads** (T5, T6) do NOT need seeding — they are ephemeral in-memory placeholders overwritten when the disk version arrives from T3/T4:
- `src/entities/threads/service.ts` — `threadService.createOptimistic()` (line 492) — called from `src/lib/thread-creation-service.ts` line 91
- `src/entities/threads/listeners.ts` — `setupThreadListeners()` THREAD_OPTIMISTIC_CREATED handler (line 72) — calls `createOptimistic`

### Plan Creation Paths

There are **three** codepaths that create plan metadata on disk:

| # | Location | Description | Has domain `parentId`? |
|---|----------|-------------|----------------------|
| P1 | `src/entities/plans/service.ts` — `PlanService.create()` (line 193) | Frontend service, called by `ensurePlanExists()` and directly | Yes — computes via `detectParentPlan()` on line 202 |
| P2 | `agents/src/core/persistence.ts` — `MortPersistence.createPlan()` (line 135) | Agent-side persistence, called by `ensurePlanExists()` | No — agent-side does not detect parent plans |
| P3 | `src/entities/plans/service.ts` — `PlanService.ensurePlanExists()` (line 168) | Wrapper that calls P1 for new plans | Delegates to P1 |

### Pull Request Creation Paths

There are **two** codepaths that create PR metadata:

| # | Location | Description |
|---|----------|-------------|
| PR1 | `src/entities/pull-requests/service.ts` — `pullRequestService.create()` (line 55) | Main service, called by PR2, PR3, and PR4 |
| PR2 | `src/entities/pull-requests/pr-lifecycle-handler.ts` — `handlePrOpened()` (line 63) | Webhook handler, calls PR1 |
| PR3 | `src/lib/pr-actions.ts` — `openExistingPr()` (line 70) | User action, calls PR1 |

All PR creation goes through `pullRequestService.create()` (PR1), so seeding there covers all paths.

## Implementation

### 1. Thread — Core Service (`core/services/thread/thread-service.ts`)

**File:** `core/services/thread/thread-service.ts`
**Method:** `ThreadService.create()` at line 36
**Insert after line 65** (after `permissionMode: "implement",` and before `turns: [initialTurn],`):

The `CreateThreadInput` interface at `core/types/threads.ts:79` must first be extended with optional `parentThreadId`:

```typescript
// core/types/threads.ts — extend CreateThreadInput (line 79)
export interface CreateThreadInput {
  id?: string;
  repoId: string;
  worktreeId: string;
  prompt: string;
  parentThreadId?: string;         // <-- ADD
  git?: {
    branch: string;
  };
}
```

Then in the `create()` method, add `visualSettings` to the metadata object:

```typescript
// core/services/thread/thread-service.ts — in create(), after permissionMode line
visualSettings: {
  parentId: input.parentThreadId ?? input.worktreeId,
},
```

This covers path **T1**.

### 2. Thread — Frontend Service (`src/entities/threads/service.ts`)

**File:** `src/entities/threads/service.ts`
**Method:** `threadService.create()` at line 185
**Insert into the metadata object** (after `permissionMode: "implement",` on line 211):

```typescript
visualSettings: {
  parentId: input.worktreeId,
},
```

The frontend `create()` does not receive `parentThreadId` (not in `CreateThreadInput` used here). Root threads always parent to worktree. This covers path **T2**.

### 3. Thread — Agent Runner (`agents/src/runners/simple-runner-strategy.ts`)

**File:** `agents/src/runners/simple-runner-strategy.ts`
**Method:** `SimpleRunnerStrategy.setup()`, new-thread branch starting at line 374
**Insert into the `threadMetadata` object** (after the `parentThreadId` spread on line 408):

```typescript
// After: ...(config.parentThreadId ? { parentThreadId: config.parentThreadId } : {}),
visualSettings: {
  parentId: config.parentThreadId ?? worktreeId,
},
```

This covers path **T3**. The `config.parentThreadId` is available from CLI arg `--parent-thread-id` (parsed at line 227).

### 4. Thread — Sub-Agent Spawn (`agents/src/runners/shared.ts`)

**File:** `agents/src/runners/shared.ts`
**Location:** Inside `runAgentLoop()`, the PreToolUse hook for Task/Agent tools
**Insert into the `childMetadata` object** (after `agentType: agentType,` on line 787, before `permissionMode`):

```typescript
visualSettings: {
  parentId: context.threadId,  // sub-agent → parent thread
},
```

This covers path **T4**. Sub-agents always have a parent thread.

### 5. Plan — Frontend Service (`src/entities/plans/service.ts`)

**File:** `src/entities/plans/service.ts`
**Method:** `PlanService.create()` at line 193
**Insert into the `plan` object** (after `updatedAt: now,` on line 205):

```typescript
visualSettings: {
  parentId: (input.parentId ?? this.detectParentPlan(input.relativePath, input.repoId)) ?? input.worktreeId,
},
```

Note: The existing `parentId` field on line 202 already computes the domain parent. We reuse that same logic but fall back to `worktreeId` for root plans (where `detectParentPlan` returns `undefined`). To avoid computing `detectParentPlan` twice, refactor to compute once:

```typescript
async create(input: CreatePlanInput): Promise<PlanMetadata> {
  const id = generateId();
  const now = Date.now();
  const domainParentId = input.parentId ?? this.detectParentPlan(input.relativePath, input.repoId);

  const plan: PlanMetadata = {
    id,
    repoId: input.repoId,
    worktreeId: input.worktreeId,
    relativePath: input.relativePath,
    parentId: domainParentId,
    isRead: false,
    createdAt: now,
    updatedAt: now,
    visualSettings: {
      parentId: domainParentId ?? input.worktreeId,
    },
  };
  // ... rest unchanged
```

This covers paths **P1** and **P3** (since P3 delegates to P1).

### 6. Plan — Agent Persistence (`agents/src/core/persistence.ts`)

**File:** `agents/src/core/persistence.ts`
**Method:** `MortPersistence.createPlan()` at line 135
**Insert into the `plan` object** (after `updatedAt: now,` on line 149):

```typescript
visualSettings: {
  parentId: input.worktreeId,
},
```

The agent-side does not have parent-plan detection logic. The frontend `refreshParentRelationships()` will correct `parentId` later. For initial seeding, defaulting to `worktreeId` is correct — the plan will be a direct child of the worktree node until the frontend corrects it.

This covers path **P2**.

**Note:** The `PlanMetadata` interface in `agents/src/core/persistence.ts` (line 43) is a local type, not the core Zod schema. It must be extended with `visualSettings`:

```typescript
// agents/src/core/persistence.ts — extend local PlanMetadata interface (line 43)
interface PlanMetadata {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
  phaseInfo?: PhaseInfo;
  visualSettings?: { parentId?: string; sortKey?: string };  // <-- ADD
}
```

### 7. Pull Request — Service (`src/entities/pull-requests/service.ts`)

**File:** `src/entities/pull-requests/service.ts`
**Method:** `pullRequestService.create()` at line 55
**Insert into the `metadata` object** (after `updatedAt: now,` on line 75):

```typescript
visualSettings: {
  parentId: input.worktreeId,
},
```

This covers paths **PR1**, **PR2**, and **PR3** (all go through this method).

## Key Files Summary

| File | Change | Lines |
| --- | --- | --- |
| `core/types/threads.ts` | Add `parentThreadId?` to `CreateThreadInput` | ~79 |
| `core/services/thread/thread-service.ts` | Add `visualSettings` to `create()` metadata object | ~65 |
| `src/entities/threads/service.ts` | Add `visualSettings` to `create()` metadata object | ~211 |
| `agents/src/runners/simple-runner-strategy.ts` | Add `visualSettings` to `threadMetadata` in `setup()` new-thread branch | ~408 |
| `agents/src/runners/shared.ts` | Add `visualSettings` to `childMetadata` in sub-agent PreToolUse hook | ~787 |
| `src/entities/plans/service.ts` | Add `visualSettings` to `plan` in `create()`, refactor `detectParentPlan` call | ~197-206 |
| `agents/src/core/persistence.ts` | Extend local `PlanMetadata` interface, add `visualSettings` to `createPlan()` | ~43, ~149 |
| `src/entities/pull-requests/service.ts` | Add `visualSettings` to `metadata` in `create()` | ~75 |

## Gotchas

1. **Optimistic threads do NOT need seeding.** They are ephemeral in-memory placeholders. The real metadata arrives from the agent runner (T3/T4) via disk refresh. Seeding optimistic threads would be harmless but unnecessary.

2. **Agent-side plan creation lacks parent detection.** `MortPersistence.createPlan()` does not call `detectParentPlan()`. The initial `visualSettings.parentId` defaults to `worktreeId`. The frontend's `refreshParentRelationships()` (called on hydration and file changes) will correct this. This is acceptable because the plan appears in the sidebar under the worktree initially, then moves to its correct parent when the frontend processes it.

3. **`planService.update()` marks as unread** (line 245: `isRead: input.isRead ?? false`). When calling `planService.update()` for visualSettings changes in later sub-plans (03+), always pass `isRead: existingPlan.isRead` to preserve read state. This is NOT a concern for this sub-plan since we are only modifying `create()` methods, not `update()`.

4. **The `parentId` field on plans is a DOMAIN relationship** (file-hierarchy-based). The `visualSettings.parentId` is a VISUAL relationship (tree position). They start the same but can diverge after drag-and-drop.

## Acceptance Criteria

- [x] Every newly created thread has `visualSettings.parentId` set

- [x] Every newly created plan has `visualSettings.parentId` set

- [x] Every newly created PR has `visualSettings.parentId` set

- [x] Sub-agent threads get `visualSettings.parentId` = parent thread ID

- [x] Child plans get `visualSettings.parentId` = domain parent plan ID (or worktreeId if root)

- [x] Root entities get `visualSettings.parentId` = worktree ID

- [x] `CreateThreadInput` in `core/types/threads.ts` includes optional `parentThreadId`

- [x] Agent-side `PlanMetadata` interface in `agents/src/core/persistence.ts` includes `visualSettings`

## Phases

- [x] Extend `CreateThreadInput` with `parentThreadId`, then seed `visualSettings` in all four thread creation paths (T1-T4)

- [x] Seed `visualSettings` in both plan creation paths (P1 frontend service, P2 agent persistence) — extend agent-side `PlanMetadata` interface

- [x] Seed `visualSettings` in `pullRequestService.create()` (covers all PR creation paths)

- [x] Verify by creating entities and checking metadata.json on disk — confirm `visualSettings.parentId` is present

<!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
