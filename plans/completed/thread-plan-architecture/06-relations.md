# 06: Thread-Plan Relations

**Dependencies:** 04-thread-refactor.md, 05-plan-entity.md
**Can run parallel with:** None (needs both thread and plan entities)

## Goal

Implement the many-to-many relationship system between threads and plans using a dedicated relations table (per Decision #1: no `planId` on ThreadMetadata).

## Storage Format (Decision #7)

**Location:** `~/.mort/plan-thread-edges/`

**File naming:** `{planId}-{threadId}.json`

**File schema:**
```typescript
interface PlanThreadRelation {
  planId: string
  threadId: string
  type: 'created' | 'modified' | 'mentioned'
  archived: boolean  // Set true when thread or plan is archived
  createdAt: number  // Unix milliseconds
  updatedAt: number  // Unix milliseconds
}
```

**Relation types:**
- `created` - thread created this plan file
- `modified` - thread modified this plan file
- `mentioned` - thread referenced this plan (in user message or context)

## Relation Type Precedence (Decision #13)

Relation types have precedence: `created` > `modified` > `mentioned`

**Rules:**
- A relation can only upgrade, never downgrade
- `mentioned` can upgrade to `modified` or `created`
- `modified` can upgrade to `created`
- `created` cannot change (highest precedence)
- Only one relation per thread-plan pair exists; the type reflects the highest-precedence action

```
mentioned → modified → created
   ↑           ↑          ↑
(lowest)   (middle)   (highest)
```

**Allowed transitions:**
- mentioned → modified (upgrade)
- mentioned → created (upgrade)
- modified → created (upgrade)

**Disallowed transitions:**
- created → modified (downgrade)
- created → mentioned (downgrade)
- modified → mentioned (downgrade)

## Tasks

### 1. Add relation types to core types

Add to `core/types/relations.ts`:

```typescript
export type RelationType = 'created' | 'modified' | 'mentioned'

export interface PlanThreadRelation {
  planId: string
  threadId: string
  type: RelationType
  archived: boolean
  createdAt: number
  updatedAt: number
}

// Precedence helper
export const RELATION_TYPE_PRECEDENCE: Record<RelationType, number> = {
  mentioned: 1,
  modified: 2,
  created: 3,
}
```

### 2. Add relation events to core types (Decision #9)

Add to `core/types/events.ts`:

```typescript
// Relation events
RELATION_CREATED = 'RELATION_CREATED',
RELATION_UPDATED = 'RELATION_UPDATED',

// Agent-emitted events (Decision #17)
THREAD_FILE_CREATED = 'THREAD_FILE_CREATED',
THREAD_FILE_MODIFIED = 'THREAD_FILE_MODIFIED',
USER_MESSAGE_SENT = 'USER_MESSAGE_SENT',
```

Event payloads:
```typescript
interface RelationCreatedPayload {
  planId: string
  threadId: string
  type: RelationType
}

interface RelationUpdatedPayload {
  planId: string
  threadId: string
  type: RelationType
  previousType: RelationType
}

interface ThreadFileCreatedPayload {
  threadId: string
  filePath: string
}

interface ThreadFileModifiedPayload {
  threadId: string
  filePath: string
}

interface UserMessageSentPayload {
  threadId: string
  message: string
}
```

### 3. Create relation store

Create `src/entities/relations/store.ts`:

Follow the existing entity store pattern (see `src/entities/plans/store.ts`):

```typescript
import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { PlanThreadRelation } from "@core/types/relations.js";

interface RelationStoreState {
  // All relations (key: `${planId}-${threadId}`)
  relations: Record<string, PlanThreadRelation>;

  // Cached array (prevents Object.values() infinite loops in React)
  _relationsArray: PlanThreadRelation[];

  // Hydration flag
  _hydrated: boolean;
}

interface RelationStoreActions {
  /** Hydration (called once at app start) */
  hydrate: (relations: Record<string, PlanThreadRelation>) => void;

  /** Selectors */
  getAll: () => PlanThreadRelation[];
  get: (planId: string, threadId: string) => PlanThreadRelation | undefined;
  getByPlan: (planId: string) => PlanThreadRelation[];
  getByThread: (threadId: string) => PlanThreadRelation[];
  getByPlanIncludingArchived: (planId: string) => PlanThreadRelation[];
  getByThreadIncludingArchived: (threadId: string) => PlanThreadRelation[];

  /** Optimistic apply methods - return rollback functions */
  _applyCreate: (relation: PlanThreadRelation) => Rollback;
  _applyUpdate: (planId: string, threadId: string, updates: Partial<PlanThreadRelation>) => Rollback;
  _applyDelete: (planId: string, threadId: string) => Rollback;
}

export const useRelationStore = create<RelationStoreState & RelationStoreActions>(
  (set, get) => ({
    // State
    relations: {},
    _relationsArray: [],
    _hydrated: false,

    // Hydration
    hydrate: (relations) => {
      set({
        _hydrated: true,
        relations,
        _relationsArray: Object.values(relations),
      });
    },

    // Selectors
    getAll: () => get()._relationsArray.filter(r => !r.archived),

    get: (planId, threadId) => {
      const key = `${planId}-${threadId}`;
      return get().relations[key];
    },

    getByPlan: (planId) =>
      get()._relationsArray.filter(r => r.planId === planId && !r.archived),

    getByThread: (threadId) =>
      get()._relationsArray.filter(r => r.threadId === threadId && !r.archived),

    getByPlanIncludingArchived: (planId) =>
      get()._relationsArray.filter(r => r.planId === planId),

    getByThreadIncludingArchived: (threadId) =>
      get()._relationsArray.filter(r => r.threadId === threadId),

    // Optimistic apply methods
    _applyCreate: (relation) => {
      const key = `${relation.planId}-${relation.threadId}`;
      set((state) => {
        const newRelations = { ...state.relations, [key]: relation };
        return {
          relations: newRelations,
          _relationsArray: Object.values(newRelations),
        };
      });
      return () =>
        set((state) => {
          const { [key]: _, ...rest } = state.relations;
          return {
            relations: rest,
            _relationsArray: Object.values(rest),
          };
        });
    },

    _applyUpdate: (planId, threadId, updates) => {
      const key = `${planId}-${threadId}`;
      const previous = get().relations[key];
      if (!previous) return () => {};

      const updated = { ...previous, ...updates };
      set((state) => {
        const newRelations = { ...state.relations, [key]: updated };
        return {
          relations: newRelations,
          _relationsArray: Object.values(newRelations),
        };
      });
      return () =>
        set((state) => {
          const restoredRelations = { ...state.relations, [key]: previous };
          return {
            relations: restoredRelations,
            _relationsArray: Object.values(restoredRelations),
          };
        });
    },

    _applyDelete: (planId, threadId) => {
      const key = `${planId}-${threadId}`;
      const previous = get().relations[key];
      if (!previous) return () => {};

      set((state) => {
        const { [key]: _, ...rest } = state.relations;
        return {
          relations: rest,
          _relationsArray: Object.values(rest),
        };
      });
      return () =>
        set((state) => {
          const restoredRelations = { ...state.relations, [key]: previous };
          return {
            relations: restoredRelations,
            _relationsArray: Object.values(restoredRelations),
          };
        });
    },
  })
);
```

### 4. Create relation service

Create `src/entities/relations/service.ts`:

**Per Decision #6:** Use the existing `persistence` layer directly. Do NOT create a `RelationStorageService` class.

```typescript
import { persistence } from "@/lib/persistence";
import { optimistic } from "@/lib/optimistic";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { useRelationStore } from "./store";
import type { PlanThreadRelation, RelationType } from "@core/types/relations.js";
import { RELATION_TYPE_PRECEDENCE } from "@core/types/relations.js";

const RELATIONS_DIR = "plan-thread-edges";

function getRelationPath(planId: string, threadId: string): string {
  return `${RELATIONS_DIR}/${planId}-${threadId}.json`;
}

function makeKey(planId: string, threadId: string): string {
  return `${planId}-${threadId}`;
}

function canUpgrade(currentType: RelationType, newType: RelationType): boolean {
  return RELATION_TYPE_PRECEDENCE[newType] > RELATION_TYPE_PRECEDENCE[currentType];
}

class RelationService {
  /**
   * Create or upgrade a relation.
   * Per Decision #13: Relations can only upgrade (mentioned → modified → created), never downgrade.
   */
  async createOrUpgrade(params: {
    threadId: string;
    planId: string;
    type: RelationType;
  }): Promise<PlanThreadRelation> {
    const { threadId, planId, type } = params;
    const store = useRelationStore.getState();
    const existing = store.get(planId, threadId);

    if (existing) {
      // Only upgrade, never downgrade
      if (canUpgrade(existing.type, type)) {
        return this.updateType(planId, threadId, type);
      }
      // Return existing if no upgrade needed
      return existing;
    }

    // Create new relation
    const now = Date.now();
    const relation: PlanThreadRelation = {
      planId,
      threadId,
      type,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    const filePath = getRelationPath(planId, threadId);

    await optimistic(
      store._applyCreate(relation),
      () => persistence.writeJson(filePath, relation)
    );

    eventBus.emit(EventName.RELATION_CREATED, { planId, threadId, type });

    return relation;
  }

  /**
   * Update the type of an existing relation.
   * Per Decision #13: Only upgrades are allowed.
   */
  async updateType(
    planId: string,
    threadId: string,
    newType: RelationType
  ): Promise<PlanThreadRelation> {
    const store = useRelationStore.getState();
    const existing = store.get(planId, threadId);

    if (!existing) {
      throw new Error(`Relation not found: ${planId}-${threadId}`);
    }

    if (!canUpgrade(existing.type, newType)) {
      // Cannot downgrade - return existing unchanged
      return existing;
    }

    const previousType = existing.type;
    const updates = { type: newType, updatedAt: Date.now() };
    const filePath = getRelationPath(planId, threadId);

    await optimistic(
      store._applyUpdate(planId, threadId, updates),
      async () => {
        const raw = await persistence.readJson(filePath);
        const merged = { ...raw, ...updates };
        await persistence.writeJson(filePath, merged);
      }
    );

    eventBus.emit(EventName.RELATION_UPDATED, { planId, threadId, type: newType, previousType });

    return { ...existing, ...updates };
  }

  /**
   * Archive relations for a thread.
   * Per Decision #14: Relations are preserved when threads are archived.
   * Sets archived=true but does NOT delete.
   */
  async archiveByThread(threadId: string): Promise<void> {
    const store = useRelationStore.getState();
    const relations = store.getByThread(threadId);

    for (const relation of relations) {
      const filePath = getRelationPath(relation.planId, relation.threadId);
      const updates = { archived: true, updatedAt: Date.now() };

      await optimistic(
        store._applyUpdate(relation.planId, relation.threadId, updates),
        async () => {
          const raw = await persistence.readJson(filePath);
          const merged = { ...raw, ...updates };
          await persistence.writeJson(filePath, merged);
        }
      );
    }
  }

  /**
   * Archive relations for a plan.
   * Per Decision #14: Relations are preserved when plans are archived.
   */
  async archiveByPlan(planId: string): Promise<void> {
    const store = useRelationStore.getState();
    const relations = store.getByPlan(planId);

    for (const relation of relations) {
      const filePath = getRelationPath(relation.planId, relation.threadId);
      const updates = { archived: true, updatedAt: Date.now() };

      await optimistic(
        store._applyUpdate(relation.planId, relation.threadId, updates),
        async () => {
          const raw = await persistence.readJson(filePath);
          const merged = { ...raw, ...updates };
          await persistence.writeJson(filePath, merged);
        }
      );
    }
  }

  /**
   * Query relations by plan (active only).
   */
  getByPlan(planId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByPlan(planId);
  }

  /**
   * Query relations by thread (active only).
   */
  getByThread(threadId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByThread(threadId);
  }

  /**
   * Query relations by plan including archived (for history).
   */
  getByPlanIncludingArchived(planId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByPlanIncludingArchived(planId);
  }

  /**
   * Query relations by thread including archived (for history).
   */
  getByThreadIncludingArchived(threadId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByThreadIncludingArchived(threadId);
  }

  /**
   * Hydrate store from disk at app startup.
   */
  async hydrate(): Promise<void> {
    const files = await persistence.listFiles(RELATIONS_DIR);
    const relations: Record<string, PlanThreadRelation> = {};

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await persistence.readJson(`${RELATIONS_DIR}/${file}`);
        if (raw && raw.planId && raw.threadId) {
          const key = makeKey(raw.planId, raw.threadId);
          relations[key] = raw as PlanThreadRelation;
        }
      } catch (error) {
        // Skip invalid files
        console.warn(`Failed to load relation file: ${file}`, error);
      }
    }

    useRelationStore.getState().hydrate(relations);
  }
}

export const relationService = new RelationService();
```

### 5. Create relation detection

Create `src/entities/relations/detection.ts`:

```typescript
import { planService } from "../plans/service";
import { relationService } from "./service";
import { useThreadStore } from "../threads/store";
import { repositoryStore } from "../repositories/store";
import type { RelationType } from "@core/types/relations.js";
import path from "path";

class RelationDetector {
  /**
   * Called when a file is created/modified by a thread.
   * Checks if the file is a plan file and creates/upgrades the relation.
   */
  async onFileChange(
    threadId: string,
    filePath: string,
    changeType: 'created' | 'modified'
  ): Promise<void> {
    // Get the thread to find its repoId
    const thread = useThreadStore.getState().getThread(threadId);
    if (!thread) return;

    // Find the plan using relative path lookup
    const plan = await this.findPlanByAbsolutePath(thread.repoId, filePath);
    if (plan) {
      await relationService.createOrUpgrade({
        threadId,
        planId: plan.id,
        type: changeType,  // 'created' or 'modified'
      });
    }
  }

  /**
   * Called when user sends a message.
   * Detects plan references and creates 'mentioned' relations.
   */
  async onUserMessage(
    threadId: string,
    message: string
  ): Promise<void> {
    const thread = useThreadStore.getState().getThread(threadId);
    if (!thread) return;

    const referencedPlans = await this.detectPlanReferences(thread.repoId, message);
    for (const plan of referencedPlans) {
      await relationService.createOrUpgrade({
        threadId,
        planId: plan.id,
        type: 'mentioned',
      });
    }
  }

  /**
   * Find a plan by its absolute file path.
   * Converts the absolute path to a relative path and uses findByRelativePath.
   */
  private async findPlanByAbsolutePath(repoId: string, absolutePath: string) {
    // Get repository settings to find the plans directory
    const repo = repositoryStore.getState().getRepository(repoId);
    if (!repo) return undefined;

    // Check if the path is within the plans directory
    const plansDir = path.join(repo.sourcePath, repo.plansDirectory);
    if (!absolutePath.startsWith(plansDir)) return undefined;

    // Extract the relative path
    const relativePath = absolutePath.slice(plansDir.length).replace(/^\//, '');

    // Use the new findByRelativePath method
    return planService.findByRelativePath(repoId, relativePath);
  }

  /**
   * Detect plan references in a message.
   * Looks for:
   * - Plan file paths (e.g., "plans/feature-x.md")
   * - Plan names mentioned in text
   */
  private async detectPlanReferences(repoId: string, message: string) {
    const { usePlanStore } = await import("../plans/store");
    const allPlans = usePlanStore.getState().getByRepository(repoId);
    const referenced = [];

    for (const plan of allPlans) {
      // Check for relative path references
      if (plan.relativePath && message.includes(plan.relativePath)) {
        referenced.push(plan);
        continue;
      }

      // Check for plan filename (e.g., "feature-x.md")
      const filename = plan.relativePath?.split("/").pop();
      if (filename && message.includes(filename)) {
        referenced.push(plan);
      }
    }

    return referenced;
  }
}

export const relationDetector = new RelationDetector();
```

### 6. Create relation listeners

Create `src/entities/relations/listeners.ts`:

**Per Decision #17:** Events are emitted by the agent runner, not the frontend.

```typescript
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { relationDetector } from "./detection";
import { relationService } from "./service";

/**
 * Set up event listeners for automatic relation management.
 *
 * The agent runner emits:
 * - THREAD_FILE_CREATED - when a thread creates a file
 * - THREAD_FILE_MODIFIED - when a thread modifies a file
 * - USER_MESSAGE_SENT - when user sends a message to a thread
 *
 * The relation service listens and creates/updates relations
 * when file paths match plan files.
 */
export function setupRelationListeners(): void {
  // When thread creates a file (emitted by agent runner)
  eventBus.on(EventName.THREAD_FILE_CREATED, async ({ threadId, filePath }) => {
    await relationDetector.onFileChange(threadId, filePath, 'created');
  });

  // When thread modifies a file (emitted by agent runner)
  eventBus.on(EventName.THREAD_FILE_MODIFIED, async ({ threadId, filePath }) => {
    await relationDetector.onFileChange(threadId, filePath, 'modified');
  });

  // When user sends message to thread (emitted by agent runner)
  eventBus.on(EventName.USER_MESSAGE_SENT, async ({ threadId, message }) => {
    await relationDetector.onUserMessage(threadId, message);
  });

  // When thread is archived, archive its relations
  eventBus.on(EventName.THREAD_ARCHIVED, async ({ threadId }) => {
    await relationService.archiveByThread(threadId);
  });

  // When plan is archived, archive its relations
  eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }) => {
    await relationService.archiveByPlan(planId);
  });
}
```

### 7. Add relation queries to thread/plan services

Update `src/entities/threads/service.ts`:

```typescript
import { relationService } from "../relations/service";
import { usePlanStore } from "../plans/store";

// Add method to ThreadService class:
async getRelatedPlans(threadId: string): Promise<PlanMetadata[]> {
  const relations = relationService.getByThread(threadId);
  const planStore = usePlanStore.getState();
  return relations
    .map(r => planStore.getPlan(r.planId))
    .filter((p): p is PlanMetadata => p !== undefined);
}
```

Update `src/entities/plans/service.ts`:

```typescript
import { relationService } from "../relations/service";
import { useThreadStore } from "../threads/store";

// Add methods to PlanService class:
async getRelatedThreads(planId: string): Promise<ThreadMetadata[]> {
  const relations = relationService.getByPlan(planId);
  const threadStore = useThreadStore.getState();
  return relations
    .map(r => threadStore.getThread(r.threadId))
    .filter((t): t is ThreadMetadata => t !== undefined);
}

async getRelatedThreadsIncludingArchived(planId: string): Promise<ThreadMetadata[]> {
  const relations = relationService.getByPlanIncludingArchived(planId);
  const threadStore = useThreadStore.getState();
  return relations
    .map(r => threadStore.getThread(r.threadId))
    .filter((t): t is ThreadMetadata => t !== undefined);
}
```

### 8. Create entity index

Create `src/entities/relations/index.ts`:

```typescript
export { useRelationStore } from './store';
export { relationService } from './service';
export { relationDetector } from './detection';
export { setupRelationListeners } from './listeners';
export type { PlanThreadRelation, RelationType } from '@core/types/relations.js';
```

### 9. Wire into entity system

Update `src/entities/index.ts`:

```typescript
import { setupRelationListeners } from "./relations/listeners";
import { relationService } from "./relations/service";

// In setupEntityListeners():
export function setupEntityListeners(): void {
  // ... existing listeners
  setupRelationListeners();
}

// In hydrateEntities():
export async function hydrateEntities(): Promise<void> {
  // ... existing hydration
  await relationService.hydrate();
}
```

### 10. Create React hooks for UI

**Note:** This plan (06-relations) owns all relation hooks. The UI inbox plan (07-ui-inbox) should import these hooks rather than defining duplicates.

Create `src/entities/relations/hooks.ts`:

```typescript
import { useMemo } from "react";
import { useRelationStore } from "./store";
import { usePlanStore } from "../plans/store";
import { useThreadStore } from "../threads/store";
import type { PlanMetadata } from "../plans/types";
import type { ThreadMetadata } from "../threads/types";

/**
 * Hook to get plans related to a thread.
 */
export function useRelatedPlans(threadId: string): PlanMetadata[] {
  const relations = useRelationStore((state) =>
    state._relationsArray.filter((r) => r.threadId === threadId && !r.archived)
  );
  const plans = usePlanStore((state) => state.plans);

  return useMemo(() => {
    return relations
      .map((r) => plans[r.planId])
      .filter((p): p is PlanMetadata => p !== undefined);
  }, [relations, plans]);
}

/**
 * Hook to get threads related to a plan.
 */
export function useRelatedThreads(planId: string): ThreadMetadata[] {
  const relations = useRelationStore((state) =>
    state._relationsArray.filter((r) => r.planId === planId && !r.archived)
  );
  const threads = useThreadStore((state) => state.threads);

  return useMemo(() => {
    return relations
      .map((r) => threads[r.threadId])
      .filter((t): t is ThreadMetadata => t !== undefined);
  }, [relations, threads]);
}

/**
 * Hook to get threads related to a plan, including archived.
 * Useful for showing "threads that touched this plan" history.
 */
export function useRelatedThreadsIncludingArchived(planId: string): ThreadMetadata[] {
  const relations = useRelationStore((state) =>
    state._relationsArray.filter((r) => r.planId === planId)
  );
  const threads = useThreadStore((state) => state.threads);

  return useMemo(() => {
    return relations
      .map((r) => threads[r.threadId])
      .filter((t): t is ThreadMetadata => t !== undefined);
  }, [relations, threads]);
}
```

Export from index:

```typescript
// In src/entities/relations/index.ts
export { useRelatedPlans, useRelatedThreads, useRelatedThreadsIncludingArchived } from './hooks';
```

## Plan Unread Status on Modification

**Key behavior:** When a thread **modifies** a plan, the plan should be marked as unread (unless the user is currently viewing it).

This ensures users are notified when plans they've read have been updated.

### Implementation

Add to `src/entities/relations/listeners.ts`:

```typescript
import { planService } from "../plans/service";

// When a relation is created with type 'modified', mark the plan as unread
// Note: planService.markUnread is defined in 05-plan-entity.md
eventBus.on(EventName.RELATION_CREATED, async ({ planId, type }) => {
  if (type === 'modified') {
    await planService.markUnread(planId);
  }
});

// When a relation is upgraded to 'modified', mark the plan as unread
eventBus.on(EventName.RELATION_UPDATED, async ({ planId, type, previousType }) => {
  if (type === 'modified' && previousType !== 'modified') {
    await planService.markUnread(planId);
  }
});
```

### Status Transitions

```
Plan Status State Machine:

                ┌─────────────────────────┐
                │                         │
    create ─────►   UNREAD               │
                │   (isRead: false)       │
                │                         │
                └──────────┬──────────────┘
                           │
                user views │
                           ▼
                ┌─────────────────────────┐
                │                         │
                │   READ                  │◄──── user marks read
                │   (isRead: true)        │
                │                         │
                └──────────┬──────────────┘
                           │
       thread modifies     │ user marks unread
                │          │
                ▼          ▼
                ┌─────────────────────────┐
                │                         │
                │   UNREAD                │
                │   (isRead: false)       │
                │                         │
                └─────────────────────────┘

Running Indicator (orthogonal to read/unread):
- Plan shows "running" indicator if ANY associated thread has status === 'running'
- This is a transient visual state, not persisted
```

---

## Agent Runner Integration (Decision #17)

The agent runner must emit the following events for relation detection to work:

**In `agents/src/runners/shared.ts` or equivalent:**

```typescript
// In PostToolUse hook when Write/Edit tool creates a file:
if (toolWasWrite && fileDidNotExistBefore) {
  emitEvent(EventName.THREAD_FILE_CREATED, { threadId, filePath: absolutePath });
}

// In PostToolUse hook when Write/Edit tool modifies a file:
if (toolWasWrite && fileExistedBefore) {
  emitEvent(EventName.THREAD_FILE_MODIFIED, { threadId, filePath: absolutePath });
}

// When user sends a message (in message handling):
emitEvent(EventName.USER_MESSAGE_SENT, { threadId, message: userMessage });
```

These events are then received by the frontend via the event bridge and processed by the relation listeners.

## Acceptance Criteria

- [ ] `PlanThreadRelation` type defined in `core/types/relations.ts`
- [ ] Relation events added to `core/types/events.ts`
- [ ] Relation store created with `Record<>` pattern (not `Map<>`)
- [ ] Relation store has `_relationsArray` and `_hydrated` flag
- [ ] Relation store has optimistic apply methods returning `Rollback` functions
- [ ] Relation service uses `persistence` layer directly (no `RelationStorageService`)
- [ ] Relation type precedence enforced (can only upgrade, never downgrade)
- [ ] Archive sets `archived: true` but does NOT delete relations (Decision #14)
- [ ] Detection system identifies plan references in file changes
- [ ] Detection system identifies plan references in user messages
- [ ] Listeners wire events to detection/service
- [ ] React hooks created: `useRelatedPlans`, `useRelatedThreads`, `useRelatedThreadsIncludingArchived`
- [ ] Thread service has `getRelatedPlans` method
- [ ] Plan service has `getRelatedThreads` and `getRelatedThreadsIncludingArchived` methods
- [ ] Entity system wired (listeners setup, hydration included)
- [ ] TypeScript compiles
- [ ] Relations persisted to `~/.mort/plan-thread-edges/{planId}-{threadId}.json`
- [ ] **Plans marked unread when modified** - RELATION_CREATED with type='modified' marks plan as unread
- [ ] **Plans marked unread on upgrade** - RELATION_UPDATED upgrading to 'modified' marks plan as unread

## Programmatic Testing Plan

The implementation agent must create and pass all of the following automated tests before considering this plan complete.

### 1. Unit Tests: Relation Type Precedence (`src/entities/relations/__tests__/precedence.test.ts`)

```typescript
describe('Relation Type Precedence', () => {
  describe('canUpgrade helper', () => {
    it('should allow mentioned → modified upgrade', () => {});
    it('should allow mentioned → created upgrade', () => {});
    it('should allow modified → created upgrade', () => {});
    it('should NOT allow modified → mentioned downgrade', () => {});
    it('should NOT allow created → modified downgrade', () => {});
    it('should NOT allow created → mentioned downgrade', () => {});
    it('should NOT allow same-type "upgrades" (mentioned → mentioned)', () => {});
  });

  describe('RELATION_TYPE_PRECEDENCE constant', () => {
    it('should have mentioned < modified < created ordering', () => {});
  });
});
```

### 2. Unit Tests: Relation Store (`src/entities/relations/__tests__/store.test.ts`)

```typescript
describe('RelationStore', () => {
  beforeEach(() => {
    // Reset store state between tests
  });

  describe('hydrate', () => {
    it('should set _hydrated flag to true', () => {});
    it('should populate relations record from input', () => {});
    it('should populate _relationsArray cache', () => {});
  });

  describe('getAll', () => {
    it('should return only non-archived relations', () => {});
    it('should return empty array when no relations exist', () => {});
  });

  describe('get', () => {
    it('should return relation by planId and threadId', () => {});
    it('should return undefined for non-existent relation', () => {});
  });

  describe('getByPlan', () => {
    it('should return all non-archived relations for a plan', () => {});
    it('should not include archived relations', () => {});
    it('should return empty array for plan with no relations', () => {});
  });

  describe('getByThread', () => {
    it('should return all non-archived relations for a thread', () => {});
    it('should not include archived relations', () => {});
    it('should return empty array for thread with no relations', () => {});
  });

  describe('getByPlanIncludingArchived', () => {
    it('should return all relations including archived', () => {});
  });

  describe('getByThreadIncludingArchived', () => {
    it('should return all relations including archived', () => {});
  });

  describe('_applyCreate', () => {
    it('should add relation to store', () => {});
    it('should update _relationsArray cache', () => {});
    it('should return rollback function that removes the relation', () => {});
  });

  describe('_applyUpdate', () => {
    it('should update existing relation', () => {});
    it('should update _relationsArray cache', () => {});
    it('should return rollback function that restores previous state', () => {});
    it('should return no-op rollback if relation does not exist', () => {});
  });

  describe('_applyDelete', () => {
    it('should remove relation from store', () => {});
    it('should update _relationsArray cache', () => {});
    it('should return rollback function that restores the relation', () => {});
    it('should return no-op rollback if relation does not exist', () => {});
  });
});
```

### 3. Unit Tests: Relation Service (`src/entities/relations/__tests__/service.test.ts`)

```typescript
describe('RelationService', () => {
  beforeEach(() => {
    // Mock persistence layer
    // Reset store state
  });

  describe('createOrUpgrade', () => {
    it('should create new relation when none exists', () => {});
    it('should persist relation to correct file path', () => {});
    it('should emit RELATION_CREATED event for new relation', () => {});
    it('should upgrade mentioned to modified', () => {});
    it('should upgrade mentioned to created', () => {});
    it('should upgrade modified to created', () => {});
    it('should NOT downgrade created to modified', () => {});
    it('should NOT downgrade created to mentioned', () => {});
    it('should NOT downgrade modified to mentioned', () => {});
    it('should emit RELATION_UPDATED event on upgrade', () => {});
    it('should return existing relation unchanged on attempted downgrade', () => {});
    it('should set correct timestamps on create', () => {});
    it('should update updatedAt timestamp on upgrade', () => {});
  });

  describe('updateType', () => {
    it('should throw error if relation does not exist', () => {});
    it('should upgrade relation type', () => {});
    it('should return unchanged relation on attempted downgrade', () => {});
    it('should persist update to file', () => {});
  });

  describe('archiveByThread', () => {
    it('should set archived=true on all relations for thread', () => {});
    it('should NOT delete the relation files', () => {});
    it('should update updatedAt timestamp', () => {});
    it('should handle thread with no relations gracefully', () => {});
  });

  describe('archiveByPlan', () => {
    it('should set archived=true on all relations for plan', () => {});
    it('should NOT delete the relation files', () => {});
    it('should update updatedAt timestamp', () => {});
    it('should handle plan with no relations gracefully', () => {});
  });

  describe('getByPlan', () => {
    it('should return non-archived relations for plan', () => {});
  });

  describe('getByThread', () => {
    it('should return non-archived relations for thread', () => {});
  });

  describe('hydrate', () => {
    it('should load all relation files from plan-thread-edges directory', () => {});
    it('should skip non-JSON files', () => {});
    it('should skip invalid JSON files without crashing', () => {});
    it('should skip files missing required fields', () => {});
    it('should hydrate store with loaded relations', () => {});
  });
});
```

### 4. Unit Tests: Relation Detection (`src/entities/relations/__tests__/detection.test.ts`)

```typescript
describe('RelationDetector', () => {
  beforeEach(() => {
    // Mock plan store with test plans
    // Mock relation service
  });

  describe('onFileChange', () => {
    it('should create "created" relation when thread creates a plan file', () => {});
    it('should create "modified" relation when thread modifies a plan file', () => {});
    it('should not create relation for non-plan files', () => {});
    it('should detect plan files by absolute path', () => {});
  });

  describe('onUserMessage', () => {
    it('should create "mentioned" relation when message contains plan absolute path', () => {});
    it('should create "mentioned" relation when message contains plan relative path', () => {});
    it('should create "mentioned" relation when message contains plan filename', () => {});
    it('should create relations for multiple plans mentioned in one message', () => {});
    it('should not create relation when no plans are referenced', () => {});
  });

  describe('detectPlanReferences (private, test via onUserMessage)', () => {
    it('should detect absolute path references', () => {});
    it('should detect relative path references', () => {});
    it('should detect filename-only references', () => {});
  });
});
```

### 5. Unit Tests: Relation Listeners (`src/entities/relations/__tests__/listeners.test.ts`)

```typescript
describe('RelationListeners', () => {
  beforeEach(() => {
    // Mock event bus
    // Mock relation detector
    // Mock relation service
    setupRelationListeners();
  });

  describe('THREAD_FILE_CREATED event', () => {
    it('should call relationDetector.onFileChange with "created" type', () => {});
  });

  describe('THREAD_FILE_MODIFIED event', () => {
    it('should call relationDetector.onFileChange with "modified" type', () => {});
  });

  describe('USER_MESSAGE_SENT event', () => {
    it('should call relationDetector.onUserMessage', () => {});
  });

  describe('THREAD_ARCHIVED event', () => {
    it('should call relationService.archiveByThread', () => {});
  });

  describe('PLAN_ARCHIVED event', () => {
    it('should call relationService.archiveByPlan', () => {});
  });

  describe('RELATION_CREATED event (plan unread behavior)', () => {
    it('should call planService.markUnread when type is "modified"', () => {});
    it('should NOT call planService.markUnread when type is "mentioned"', () => {});
    it('should NOT call planService.markUnread when type is "created"', () => {});
  });

  describe('RELATION_UPDATED event (plan unread behavior)', () => {
    it('should call planService.markUnread when upgrading to "modified"', () => {});
    it('should NOT call planService.markUnread when upgrading to "created" (already modified)', () => {});
    it('should NOT call planService.markUnread when previousType was already "modified"', () => {});
  });
});
```

### 6. Unit Tests: React Hooks (`src/entities/relations/__tests__/hooks.test.ts`)

```typescript
describe('Relation Hooks', () => {
  beforeEach(() => {
    // Set up test data in stores
  });

  describe('useRelatedPlans', () => {
    it('should return plans related to a thread', () => {});
    it('should not include plans from archived relations', () => {});
    it('should return empty array for thread with no relations', () => {});
    it('should update when relations change', () => {});
  });

  describe('useRelatedThreads', () => {
    it('should return threads related to a plan', () => {});
    it('should not include threads from archived relations', () => {});
    it('should return empty array for plan with no relations', () => {});
    it('should update when relations change', () => {});
  });

  describe('useRelatedThreadsIncludingArchived', () => {
    it('should return threads including those with archived relations', () => {});
    it('should update when relations change', () => {});
  });
});
```

### 7. Integration Tests: Thread/Plan Service Extensions (`src/entities/__tests__/relation-integration.test.ts`)

```typescript
describe('Relation Integration', () => {
  beforeEach(() => {
    // Set up test plans, threads, and relations
  });

  describe('ThreadService.getRelatedPlans', () => {
    it('should return PlanMetadata objects for related plans', () => {});
    it('should filter out plans that no longer exist', () => {});
  });

  describe('PlanService.getRelatedThreads', () => {
    it('should return ThreadMetadata objects for related threads', () => {});
    it('should filter out threads that no longer exist', () => {});
  });

  describe('PlanService.getRelatedThreadsIncludingArchived', () => {
    it('should include threads from archived relations', () => {});
  });
});
```

### 8. Integration Tests: Entity System Wiring (`src/entities/__tests__/entity-system.test.ts`)

```typescript
describe('Entity System - Relations', () => {
  describe('setupEntityListeners', () => {
    it('should call setupRelationListeners', () => {});
  });

  describe('hydrateEntities', () => {
    it('should call relationService.hydrate', () => {});
  });
});
```

### 9. Integration Tests: File Persistence (`src/entities/relations/__tests__/persistence.test.ts`)

```typescript
describe('Relation Persistence', () => {
  beforeEach(() => {
    // Set up temp directory for test files
  });

  afterEach(() => {
    // Clean up temp directory
  });

  it('should persist relation to ~/.mort/plan-thread-edges/{planId}-{threadId}.json', () => {});
  it('should write valid JSON with all required fields', () => {});
  it('should read persisted relations on hydrate', () => {});
  it('should update existing file on relation upgrade', () => {});
  it('should update file on archive (not delete)', () => {});
});
```

### 10. Type Tests (`core/types/__tests__/relations.test.ts`)

```typescript
describe('Relation Types', () => {
  it('should export RelationType union type', () => {
    // Type-level test: ensure the type is correctly defined
    const validTypes: RelationType[] = ['created', 'modified', 'mentioned'];
  });

  it('should export PlanThreadRelation interface with all required fields', () => {
    // Type-level test: ensure all fields are present
    const relation: PlanThreadRelation = {
      planId: 'plan-1',
      threadId: 'thread-1',
      type: 'created',
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  it('should export RELATION_TYPE_PRECEDENCE constant', () => {
    expect(RELATION_TYPE_PRECEDENCE.mentioned).toBe(1);
    expect(RELATION_TYPE_PRECEDENCE.modified).toBe(2);
    expect(RELATION_TYPE_PRECEDENCE.created).toBe(3);
  });
});
```

### Test Execution Requirements

1. All tests must pass with `npm test` or equivalent test runner command
2. Tests should use the project's existing test framework and patterns
3. Mock the persistence layer appropriately to avoid file system side effects in unit tests
4. Integration tests may use a temporary directory for actual file operations
5. Ensure proper cleanup in `afterEach` blocks to prevent test pollution
6. Tests must verify both the happy path and error handling scenarios
7. The implementation is not complete until ALL specified tests pass
