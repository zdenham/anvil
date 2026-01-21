# 02 - Plan Store and Service

**Dependencies:** 01-core-types
**Parallelizable with:** 03-detection, 04-entity-relationships

## Design Decisions

- **Storage Location**: Plans are stored in `plans/{id}/metadata.json` within the `.mort` data directory
- **Persistence Pattern**: Use `persistence.readJson/writeJson/glob` (NOT `window.api` - that pattern doesn't exist in this codebase)
- **Store Pattern**: Use plain Zustand without immer middleware (matching existing thread/task stores)
- **UUID Generation**: Use native `crypto.randomUUID()` (NOT uuid package)
- **isRead Default**: New plans are created with `isRead: false` (unread)
- **Read Status on Update**: Any plan update or creation marks it as unread
- **One Plan Per Thread**: Currently supporting one plan per thread (may expand to many-to-many in future)

## Overview

Create the Zustand store and service layer for Plan entities, following existing patterns from threads/tasks.

## Implementation Steps

### 1. Create Plan Store

**File:** `src/entities/plans/store.ts`

Follow the pattern from `src/entities/threads/store.ts` (plain Zustand, no immer):

```typescript
import { create } from "zustand";
import type { PlanMetadata } from "./types";

interface PlanStoreState {
  plans: Record<string, PlanMetadata>;
  _hydrated: boolean;
  _plansArray: PlanMetadata[];
}

interface PlanStoreActions {
  // Hydration
  hydrate: (plans: Record<string, PlanMetadata>) => void;

  // Getters
  getAll: () => PlanMetadata[];
  getPlan: (id: string) => PlanMetadata | undefined;
  getByRepository: (repositoryName: string) => PlanMetadata[];
  getUnreadPlans: () => PlanMetadata[];
  findByPath: (repositoryName: string, path: string) => PlanMetadata | undefined;

  // Read status
  markPlanAsRead: (id: string) => void;
  markPlanAsUnread: (id: string) => void;

  // Optimistic updates (return Rollback function for optimistic utility)
  _applyCreate: (plan: PlanMetadata) => () => void;
  _applyUpdate: (id: string, updates: Partial<PlanMetadata>) => () => void;
  _applyDelete: (id: string) => () => void;
}

export type PlanStoreState = PlanStoreState & PlanStoreActions;

export const usePlanStore = create<PlanStoreState & PlanStoreActions>((set, get) => ({
  plans: {},
  _hydrated: false,
  _plansArray: [],

  hydrate: (plans) => {
    const plansArray = Object.values(plans);
    set({
      _hydrated: true,
      plans,
      _plansArray: plansArray,
    });
  },

  getAll: () => get()._plansArray,

  getPlan: (id) => get().plans[id],

  getByRepository: (repositoryName) =>
    get()._plansArray.filter((p) => p.repositoryName === repositoryName),

  getUnreadPlans: () => get()._plansArray.filter((p) => !p.isRead),

  findByPath: (repositoryName, path) =>
    get()._plansArray.find(
      (p) => p.repositoryName === repositoryName && p.path === path
    ),

  markPlanAsRead: (id) => {
    const plan = get().plans[id];
    if (plan) {
      const updated = { ...plan, isRead: true };
      set((state) => ({
        plans: { ...state.plans, [id]: updated },
        _plansArray: Object.values({ ...state.plans, [id]: updated }),
      }));
    }
  },

  markPlanAsUnread: (id) => {
    const plan = get().plans[id];
    if (plan) {
      const updated = { ...plan, isRead: false };
      set((state) => ({
        plans: { ...state.plans, [id]: updated },
        _plansArray: Object.values({ ...state.plans, [id]: updated }),
      }));
    }
  },

  _applyCreate: (plan) => {
    set((state) => ({
      plans: { ...state.plans, [plan.id]: plan },
      _plansArray: [...state._plansArray, plan],
    }));
    // Return rollback function
    return () => {
      set((state) => {
        const { [plan.id]: _, ...rest } = state.plans;
        return {
          plans: rest,
          _plansArray: state._plansArray.filter((p) => p.id !== plan.id),
        };
      });
    };
  },

  _applyUpdate: (id, updates) => {
    const previous = get().plans[id];
    if (!previous) return () => {};

    const updated = { ...previous, ...updates };
    set((state) => ({
      plans: { ...state.plans, [id]: updated },
      _plansArray: Object.values({ ...state.plans, [id]: updated }),
    }));
    // Return rollback function
    return () => {
      set((state) => ({
        plans: { ...state.plans, [id]: previous },
        _plansArray: Object.values({ ...state.plans, [id]: previous }),
      }));
    };
  },

  _applyDelete: (id) => {
    const previous = get().plans[id];
    if (!previous) return () => {};

    set((state) => {
      const { [id]: _, ...rest } = state.plans;
      return {
        plans: rest,
        _plansArray: state._plansArray.filter((p) => p.id !== id),
      };
    });
    // Return rollback function
    return () => {
      set((state) => ({
        plans: { ...state.plans, [id]: previous },
        _plansArray: [...state._plansArray, previous],
      }));
    };
  },
}));
```

### 2. Create Plan Service

**File:** `src/entities/plans/service.ts`

Uses `persistence` module (NOT window.api):

```typescript
import { persistence } from "@/lib/persistence";
import { optimistic } from "@/lib/optimistic";
import { usePlanStore } from "./store";
import { PlanMetadataSchema } from "./types";
import type { PlanMetadata, CreatePlanInput, UpdatePlanInput } from "./types";

const PLANS_DIRECTORY = "plans";

class PlanService {
  /**
   * Hydrate store from plans/*/metadata.json
   */
  async hydrate(): Promise<void> {
    const pattern = `${PLANS_DIRECTORY}/*/metadata.json`;
    const metadataFiles = await persistence.glob(pattern);

    const plans: Record<string, PlanMetadata> = {};

    for (const filePath of metadataFiles) {
      try {
        const data = await persistence.readJson(filePath);
        const result = PlanMetadataSchema.safeParse(data);

        if (result.success) {
          plans[result.data.id] = result.data;
        } else {
          console.warn(`Invalid plan metadata at ${filePath}:`, result.error);
        }
      } catch (err) {
        console.warn(`Failed to read plan metadata at ${filePath}:`, err);
      }
    }

    usePlanStore.getState().hydrate(plans);
  }

  /**
   * Find existing plan by repository + path
   */
  findByPath(repositoryName: string, path: string): PlanMetadata | undefined {
    return usePlanStore.getState().findByPath(repositoryName, path);
  }

  /**
   * Idempotent plan creation - looks up by path first
   * If plan exists, marks it as unread (content was updated)
   */
  async ensurePlanExists(
    repositoryName: string,
    path: string
  ): Promise<PlanMetadata> {
    const existing = this.findByPath(repositoryName, path);
    if (existing) {
      // Plan file was updated, mark as unread
      await this.markAsUnread(existing.id);
      return usePlanStore.getState().getPlan(existing.id)!;
    }
    return this.create({ repositoryName, path });
  }

  /**
   * Create a new plan
   */
  async create(input: CreatePlanInput): Promise<PlanMetadata> {
    const title = input.title || this.extractTitleFromPath(input.path);
    const now = Date.now();

    const plan: PlanMetadata = {
      id: crypto.randomUUID(),
      path: input.path,
      repositoryName: input.repositoryName,
      title,
      isRead: false, // Always start unread
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic update with rollback
    const rollback = usePlanStore.getState()._applyCreate(plan);

    try {
      // Persist to disk
      await persistence.writeJson(
        `${PLANS_DIRECTORY}/${plan.id}/metadata.json`,
        plan
      );
    } catch (err) {
      rollback();
      throw err;
    }

    return plan;
  }

  /**
   * Update plan metadata
   */
  async update(id: string, input: UpdatePlanInput): Promise<void> {
    const updates = {
      ...input,
      updatedAt: Date.now(),
      // Any update marks as unread unless explicitly setting isRead
      isRead: input.isRead ?? false,
    };

    // Optimistic update with rollback
    const rollback = usePlanStore.getState()._applyUpdate(id, updates);

    try {
      const plan = usePlanStore.getState().getPlan(id);
      if (plan) {
        await persistence.writeJson(
          `${PLANS_DIRECTORY}/${id}/metadata.json`,
          plan
        );
      }
    } catch (err) {
      rollback();
      throw err;
    }
  }

  /**
   * Delete a plan
   */
  async delete(id: string): Promise<void> {
    // Optimistic update with rollback
    const rollback = usePlanStore.getState()._applyDelete(id);

    try {
      await persistence.remove(`${PLANS_DIRECTORY}/${id}`);
    } catch (err) {
      rollback();
      throw err;
    }
  }

  /**
   * Mark plan as read
   */
  async markAsRead(id: string): Promise<void> {
    usePlanStore.getState().markPlanAsRead(id);

    const plan = usePlanStore.getState().getPlan(id);
    if (plan) {
      await persistence.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        plan
      );
    }
  }

  /**
   * Mark plan as unread
   */
  async markAsUnread(id: string): Promise<void> {
    usePlanStore.getState().markPlanAsUnread(id);

    const plan = usePlanStore.getState().getPlan(id);
    if (plan) {
      await persistence.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        plan
      );
    }
  }

  /**
   * Get plan content from the actual file in the repository
   * Requires looking up the repository's source path first
   */
  async getPlanContent(planId: string): Promise<string | null> {
    const plan = usePlanStore.getState().getPlan(planId);
    if (!plan) return null;

    // Need to resolve the repository's source path
    // The plan.path is relative to repo root, need absolute path
    const repoSourcePath = await this.getRepositorySourcePath(
      plan.repositoryName
    );
    if (!repoSourcePath) return null;

    const absolutePath = `${repoSourcePath}/${plan.path}`;

    try {
      return await persistence.readText(absolutePath);
    } catch {
      return null;
    }
  }

  /**
   * Get repository source path from repo service
   * TODO: Import from repoService once available
   */
  private async getRepositorySourcePath(
    repositoryName: string
  ): Promise<string | null> {
    // This will need to use repoService.getByName() or similar
    // For now, this is a placeholder that needs integration
    const { repoService } = await import("@/entities/repositories");
    const repo = repoService.getByName(repositoryName);
    return repo?.sourcePath ?? null;
  }

  /**
   * Extract title from path (e.g., "plans/my-feature.md" -> "My Feature")
   */
  private extractTitleFromPath(path: string): string {
    const filename = path.split("/").pop() || path;
    const nameWithoutExt = filename.replace(/\.md$/, "");
    return nameWithoutExt
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}

export const planService = new PlanService();
```

### 3. Create Types Re-export

**File:** `src/entities/plans/types.ts`

```typescript
export type {
  PlanMetadata,
  CreatePlanInput,
  UpdatePlanInput,
} from "@core/types/plans.js";

export { PlanMetadataSchema } from "@core/types/plans.js";
```

### 4. Create Index Barrel

**File:** `src/entities/plans/index.ts`

```typescript
export * from "./types";
export * from "./store";
export { planService } from "./service";
```

## Validation Criteria

- [ ] Store follows existing patterns from threads/tasks (no immer)
- [ ] Service uses `persistence` module (not window.api)
- [ ] Uses `crypto.randomUUID()` for ID generation
- [ ] Optimistic updates return rollback functions
- [ ] `findByPath` and `ensurePlanExists` work correctly
- [ ] `ensurePlanExists` marks existing plans as unread when called
- [ ] New plans are created with `isRead: false`
- [ ] Plans are stored in `plans/{id}/metadata.json`
- [ ] TypeScript compiles without errors
- [ ] Can import from `src/entities/plans`
