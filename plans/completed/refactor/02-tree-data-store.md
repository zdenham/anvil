# Phase 2: Tree Menu Data Structure

**Parent Plan:** [main-window-refactor.md](../main-window-refactor.md)
**Phase:** 2 of 7
**Status:** Not Started
**Dependencies:** Can start in PARALLEL with Phase 1 (this is data layer, Phase 1 is UI primitives)
**Required By:** Phase 3 (Tree Menu UI), Phase 4 (Layout Assembly)

---

## Overview

This phase establishes the data model for the hierarchical tree view. We define TypeScript types with Zod schemas, create a Zustand store with disk persistence via a service layer, and implement hooks for deriving tree structure from existing entity stores.

**Key deliverables:**
1. Type definitions for tree nodes with discriminated unions and Zod schemas
2. Zustand store for UI state (expansion, selection) with `_apply*` methods only
3. Service layer for disk I/O + store writes
4. Event listeners for cross-window sync
5. Repo/worktree lookup store for efficient name resolution
6. `useTreeData` hook that transforms entities into tree structure

---

## Pre-Implementation Reading

Before writing any code, read and understand these files:

### Required Reading

- [ ] **`docs/patterns/entity-stores.md`** - Entity store pattern (store.ts, service.ts, listeners.ts)
- [ ] **`docs/patterns/disk-as-truth.md`** - Disk as truth pattern
- [ ] **`docs/patterns/zod-boundaries.md`** - Zod at boundaries pattern
- [ ] **`docs/patterns/event-bridge.md`** - Event bridge pattern
- [ ] **`src/lib/persistence.ts`** - Disk persistence layer (readJson, writeJson, glob patterns)
- [ ] **`core/types/threads.ts`** - ThreadMetadata schema (id, repoId, worktreeId, status, name, updatedAt)
- [ ] **`core/types/plans.ts`** - PlanMetadata schema (id, repoId, worktreeId, relativePath, isRead, stale)
- [ ] **`core/types/repositories.ts`** - RepositorySettings and WorktreeState schemas
- [ ] **`src/entities/threads/store.ts`** - Thread store pattern (_apply* methods)
- [ ] **`src/entities/threads/service.ts`** - Thread service pattern (service wraps store)
- [ ] **`src/entities/threads/listeners.ts`** - Thread listeners pattern (event -> service.refresh)
- [ ] **`src/utils/thread-colors.ts`** - StatusDotVariant derivation logic

### Reference (Skim)

- [ ] **`src/entities/repositories/service.ts`** - How repositories/worktrees are loaded
- [ ] **`src/entities/relations/service.ts`** - Plan-thread relation queries
- [ ] **`src/stores/panel-context-store.ts`** - Simple Zustand store example

---

## File Structure

```
src/stores/tree-menu/
├── types.ts       # Type definitions + Zod schemas for persisted state
├── store.ts       # Zustand store with _apply* methods only
├── service.ts     # Disk I/O + store writes
└── listeners.ts   # Event subscriptions

src/stores/
└── repo-worktree-lookup-store.ts  # Cached repo/worktree name lookup

src/hooks/
└── use-tree-data.ts      # Hook for entity -> tree transformation
```

---

## Task Checklist

### 2.1 Define Tree Data Types

- [ ] Create `src/stores/tree-menu/types.ts`
- [ ] Define `TreeMenuPersistedStateSchema` (Zod) for disk validation
- [ ] Define `RepoWorktreeSection` interface
- [ ] Define `TreeItemNode` interface
- [ ] Define `TreeNode` discriminated union type

### 2.2 Create Repo/Worktree Lookup Store

- [ ] Create `src/stores/repo-worktree-lookup-store.ts`
- [ ] Define `RepoWorktreeLookup` interface with Maps for O(1) lookup
- [ ] Implement `hydrateFromSettings()` that reads all repository settings
- [ ] Provide `getRepoName(repoId)` and `getWorktreeName(repoId, worktreeId)` selectors
- [ ] Call hydration after `repoService.hydrate()` in app initialization

### 2.3 Create Tree Menu Store

- [ ] Create `src/stores/tree-menu/store.ts`
- [ ] Implement `TreeMenuState` interface
- [ ] Implement `hydrate(state)` method (receives already-validated state)
- [ ] Implement `_applySetExpanded(sectionId, expanded)` - returns Rollback
- [ ] Implement `_applySetSelectedItem(itemId)` - returns Rollback
- [ ] **NO direct disk I/O in store** - only `_apply*` methods

### 2.4 Create Tree Menu Service

- [ ] Create `src/stores/tree-menu/service.ts`
- [ ] Implement `hydrate()` - reads from disk, validates with Zod, calls `store.hydrate()`
- [ ] Implement `toggleSection(sectionId)` - writes to disk, then applies to store
- [ ] Implement `setSelectedItem(itemId)` - writes to disk, then applies to store
- [ ] Implement `refreshFromDisk()` - re-reads and re-hydrates store

### 2.5 Create Tree Menu Listeners

- [ ] Create `src/stores/tree-menu/listeners.ts`
- [ ] Subscribe to `THREAD_CREATED` - refresh from disk
- [ ] Subscribe to `THREAD_UPDATED` - refresh from disk
- [ ] Subscribe to `THREAD_STATUS_CHANGED` - refresh from disk
- [ ] Subscribe to `PLAN_UPDATED` - refresh from disk
- [ ] Subscribe to `REPOSITORY_UPDATED` - refresh repo/worktree lookup
- [ ] Export `setupTreeMenuListeners()` function
- [ ] Add to `src/entities/index.ts` initialization

### 2.6 Create useTreeData Hook

- [ ] Create `src/hooks/use-tree-data.ts`
- [ ] Implement `buildTreeFromEntities()` transformer function
- [ ] Use `useRepoWorktreeLookupStore` for name resolution (sync, pre-loaded)
- [ ] Use `relationService.getByPlan()` for plan->thread relations
- [ ] Derive `hasRunningThread` from running thread IDs + relations
- [ ] Sort items by `updatedAt` descending within each section
- [ ] Derive `StatusDotVariant` for each item

### 2.7 Create Selector Hooks

- [ ] `useTreeSections()` - returns array of `RepoWorktreeSection[]`
- [ ] `useSelectedTreeItem()` - returns currently selected item or null
- [ ] `useExpandedSections()` - returns expansion state map
- [ ] `useSectionItems(sectionId)` - returns items for a specific section

---

## Implementation Details

### 2.1 Tree Data Types (`src/stores/tree-menu/types.ts`)

```typescript
import { z } from "zod";
import type { StatusDotVariant } from "@/components/ui/status-dot";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted State - Zod schema for disk validation
// Location: ~/.anvil/ui/tree-menu.json
// ═══════════════════════════════════════════════════════════════════════════

export const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
});
export type TreeMenuPersistedState = z.infer<typeof TreeMenuPersistedStateSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Types - Plain TypeScript (not persisted, derived from entities)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Repo/worktree section - a single combined level in the tree.
 * Displayed as "repoName/worktreeName" with horizontal dividers.
 */
export interface RepoWorktreeSection {
  type: "repo-worktree";
  /** Unique identifier: "repoId:worktreeId" */
  id: string;
  /** Display name of the repository */
  repoName: string;
  /** Display name of the worktree (branch name or "main") */
  worktreeName: string;
  /** UUID of the repository */
  repoId: string;
  /** UUID of the worktree */
  worktreeId: string;
  /** Absolute path to the worktree directory */
  worktreePath: string;
  /** Child items (threads and plans) */
  items: TreeItemNode[];
  /** Whether this section is expanded */
  isExpanded: boolean;
}

/**
 * Individual tree item (thread or plan).
 */
export interface TreeItemNode {
  type: "thread" | "plan";
  /** UUID of the thread or plan */
  id: string;
  /** Display title (thread name or plan filename) */
  title: string;
  /** Status for the dot indicator */
  status: StatusDotVariant;
  /** Last update timestamp (for sorting) */
  updatedAt: number;
  /** Parent section identifier */
  sectionId: string;
}

/**
 * Discriminated union for all tree node types.
 */
export type TreeNode = RepoWorktreeSection | TreeItemNode;
```

### 2.2 Repo/Worktree Lookup Store (`src/stores/repo-worktree-lookup-store.ts`)

```typescript
import { create } from "zustand";
import { persistence, loadSettings } from "@/lib/persistence";
import { RepositorySettingsSchema, type WorktreeState } from "@core/types/repositories.js";
import { logger } from "@/lib/logger-client";

interface RepoInfo {
  name: string;
  worktrees: Map<string, { name: string; path: string }>;
}

interface RepoWorktreeLookupState {
  /** Map of repoId -> repo info */
  repos: Map<string, RepoInfo>;
  _hydrated: boolean;

  /** Hydrate from all repository settings files */
  hydrate: () => Promise<void>;

  /** Get repository name by ID. Returns "Unknown" if not found. */
  getRepoName: (repoId: string) => string;

  /** Get worktree name by repo ID and worktree ID. Returns "main" if not found. */
  getWorktreeName: (repoId: string, worktreeId: string) => string;

  /** Get worktree path by repo ID and worktree ID. Returns empty string if not found. */
  getWorktreePath: (repoId: string, worktreeId: string) => string;
}

export const useRepoWorktreeLookupStore = create<RepoWorktreeLookupState>((set, get) => ({
  repos: new Map(),
  _hydrated: false,

  hydrate: async () => {
    const repos = new Map<string, RepoInfo>();
    const REPOS_DIR = "repositories";

    try {
      const repoDirs = await persistence.listDir(REPOS_DIR);

      for (const repoSlug of repoDirs) {
        try {
          const settingsPath = `${REPOS_DIR}/${repoSlug}/settings.json`;
          const raw = await persistence.readJson(settingsPath);
          const result = raw ? RepositorySettingsSchema.safeParse(raw) : null;

          if (result?.success) {
            const settings = result.data;
            const worktreeMap = new Map<string, { name: string; path: string }>();

            for (const wt of settings.worktrees) {
              worktreeMap.set(wt.id, { name: wt.name, path: wt.path });
            }

            repos.set(settings.id, {
              name: settings.name,
              worktrees: worktreeMap,
            });
          }
        } catch (err) {
          logger.warn(`[RepoWorktreeLookup] Failed to load settings for ${repoSlug}:`, err);
        }
      }

      set({ repos, _hydrated: true });
      logger.debug(`[RepoWorktreeLookup] Hydrated ${repos.size} repositories`);
    } catch (err) {
      logger.error("[RepoWorktreeLookup] Failed to hydrate:", err);
      set({ _hydrated: true });
    }
  },

  getRepoName: (repoId: string): string => {
    return get().repos.get(repoId)?.name ?? "Unknown";
  },

  getWorktreeName: (repoId: string, worktreeId: string): string => {
    const repo = get().repos.get(repoId);
    return repo?.worktrees.get(worktreeId)?.name ?? "main";
  },

  getWorktreePath: (repoId: string, worktreeId: string): string => {
    const repo = get().repos.get(repoId);
    return repo?.worktrees.get(worktreeId)?.path ?? "";
  },
}));
```

### 2.3 Tree Menu Store (`src/stores/tree-menu/store.ts`)

```typescript
import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { TreeMenuPersistedState } from "./types";

interface TreeMenuState {
  /** Expansion state for each section, keyed by section id */
  expandedSections: Record<string, boolean>;
  /** Currently selected thread or plan id */
  selectedItemId: string | null;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

interface TreeMenuActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: TreeMenuPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetExpanded: (sectionId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
}

export const useTreeMenuStore = create<TreeMenuState & TreeMenuActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  expandedSections: {},
  selectedItemId: null,
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (state: TreeMenuPersistedState) => {
    set({
      expandedSections: state.expandedSections,
      selectedItemId: state.selectedItemId,
      _hydrated: true,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applySetExpanded: (sectionId: string, expanded: boolean): Rollback => {
    const prev = get().expandedSections[sectionId];
    set((state) => ({
      expandedSections: {
        ...state.expandedSections,
        [sectionId]: expanded,
      },
    }));
    return () =>
      set((state) => ({
        expandedSections: prev !== undefined
          ? { ...state.expandedSections, [sectionId]: prev }
          : (() => {
              const { [sectionId]: _, ...rest } = state.expandedSections;
              return rest;
            })(),
      }));
  },

  _applySetSelectedItem: (itemId: string | null): Rollback => {
    const prev = get().selectedItemId;
    set({ selectedItemId: itemId });
    return () => set({ selectedItemId: prev });
  },
}));

/**
 * Get current tree menu state (non-reactive, for use outside React).
 */
export function getTreeMenuState(): Pick<TreeMenuState, "expandedSections" | "selectedItemId"> {
  const { expandedSections, selectedItemId } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId };
}
```

### 2.4 Tree Menu Service (`src/stores/tree-menu/service.ts`)

```typescript
import { persistence } from "@/lib/persistence";
import { logger } from "@/lib/logger-client";
import { useTreeMenuStore } from "./store";
import { TreeMenuPersistedStateSchema, type TreeMenuPersistedState } from "./types";

const UI_STATE_PATH = "ui/tree-menu.json";

/**
 * Helper to get persisted state from store.
 */
function getPersistedState(): TreeMenuPersistedState {
  const { expandedSections, selectedItemId } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId };
}

export const treeMenuService = {
  /**
   * Hydrates the tree menu store from disk.
   * Should be called once at app initialization.
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await persistence.readJson(UI_STATE_PATH);
      if (raw) {
        const result = TreeMenuPersistedStateSchema.safeParse(raw);
        if (result.success) {
          useTreeMenuStore.getState().hydrate(result.data);
          logger.debug("[treeMenuService] Hydrated from disk");
          return;
        }
        logger.warn("[treeMenuService] Invalid persisted state, using defaults:", result.error);
      }
      // No data or invalid - use defaults
      useTreeMenuStore.getState().hydrate({
        expandedSections: {},
        selectedItemId: null,
      });
      logger.debug("[treeMenuService] No persisted state found, using defaults");
    } catch (err) {
      logger.error("[treeMenuService] Failed to hydrate:", err);
      useTreeMenuStore.getState().hydrate({
        expandedSections: {},
        selectedItemId: null,
      });
    }
  },

  /**
   * Toggles a section's expansion state.
   * Writes to disk first, then updates store.
   */
  async toggleSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? true;
    const newExpanded = !current;

    // Write to disk first (disk as truth)
    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      expandedSections: {
        ...useTreeMenuStore.getState().expandedSections,
        [sectionId]: newExpanded,
      },
    };

    try {
      await persistence.ensureDir("ui");
      await persistence.writeJson(UI_STATE_PATH, newState);
      // Apply to store after successful disk write
      useTreeMenuStore.getState()._applySetExpanded(sectionId, newExpanded);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist toggle:", err);
      throw err;
    }
  },

  /**
   * Expands a section.
   */
  async expandSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().expandedSections[sectionId];
    if (current === true) return; // Already expanded

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      expandedSections: {
        ...useTreeMenuStore.getState().expandedSections,
        [sectionId]: true,
      },
    };

    try {
      await persistence.ensureDir("ui");
      await persistence.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetExpanded(sectionId, true);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist expand:", err);
      throw err;
    }
  },

  /**
   * Collapses a section.
   */
  async collapseSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().expandedSections[sectionId];
    if (current === false) return; // Already collapsed

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      expandedSections: {
        ...useTreeMenuStore.getState().expandedSections,
        [sectionId]: false,
      },
    };

    try {
      await persistence.ensureDir("ui");
      await persistence.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetExpanded(sectionId, false);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist collapse:", err);
      throw err;
    }
  },

  /**
   * Sets the selected item.
   * Writes to disk first, then updates store.
   */
  async setSelectedItem(itemId: string | null): Promise<void> {
    const current = useTreeMenuStore.getState().selectedItemId;
    if (current === itemId) return; // No change

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      selectedItemId: itemId,
    };

    try {
      await persistence.ensureDir("ui");
      await persistence.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetSelectedItem(itemId);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist selection:", err);
      throw err;
    }
  },

  /**
   * Refreshes the store from disk.
   * Used when cross-window sync events arrive.
   */
  async refreshFromDisk(): Promise<void> {
    await this.hydrate();
  },
};
```

### 2.5 Tree Menu Listeners (`src/stores/tree-menu/listeners.ts`)

```typescript
import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "@/entities/events.js";
import { treeMenuService } from "./service.js";
import { useRepoWorktreeLookupStore } from "../repo-worktree-lookup-store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup tree menu event listeners.
 * Events trigger disk re-reads to ensure consistency across windows.
 */
export function setupTreeMenuListeners(): void {
  // Thread events - tree structure may have changed
  eventBus.on(EventName.THREAD_CREATED, async () => {
    try {
      // Thread store handles the thread data - we just need to ensure our
      // UI state is fresh if another window modified it
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread created:", e);
    }
  });

  eventBus.on(EventName.THREAD_UPDATED, async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread updated:", e);
    }
  });

  eventBus.on(EventName.THREAD_STATUS_CHANGED, async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on thread status changed:", e);
    }
  });

  // Plan events - tree structure may have changed
  eventBus.on(EventName.PLAN_UPDATED, async () => {
    try {
      await treeMenuService.refreshFromDisk();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh on plan updated:", e);
    }
  });

  // Repository events - repo/worktree lookup needs refresh
  eventBus.on(EventName.REPOSITORY_UPDATED, async () => {
    try {
      // Refresh the lookup cache when repository settings change
      await useRepoWorktreeLookupStore.getState().hydrate();
    } catch (e) {
      logger.error("[TreeMenuListener] Failed to refresh repo lookup:", e);
    }
  });
}
```

### 2.6 useTreeData Hook (`src/hooks/use-tree-data.ts`)

```typescript
import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { relationService } from "@/entities/relations/service";
import { getThreadStatusVariant, getPlanStatusVariant } from "@/utils/thread-colors";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { RepoWorktreeSection, TreeItemNode } from "@/stores/tree-menu/types";

/**
 * Builds tree structure from entity stores.
 * Groups threads and plans by their repo/worktree association.
 * Sorts items within each section by updatedAt descending.
 *
 * @param threads - All threads from store
 * @param plans - All plans from store
 * @param expandedSections - Expansion state from tree menu store
 * @param runningThreadIds - Set of thread IDs with running status
 * @param getRepoName - Function to resolve repo name from ID
 * @param getWorktreeName - Function to resolve worktree name from IDs
 * @param getWorktreePath - Function to resolve worktree path from IDs
 */
export function buildTreeFromEntities(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>,
  getRepoName: (repoId: string) => string,
  getWorktreeName: (repoId: string, worktreeId: string) => string,
  getWorktreePath: (repoId: string, worktreeId: string) => string
): RepoWorktreeSection[] {
  // Group items by "repoId:worktreeId"
  const sectionMap = new Map<string, {
    repoId: string;
    worktreeId: string;
    repoName: string;
    worktreeName: string;
    worktreePath: string;
    items: TreeItemNode[];
    latestUpdate: number;
  }>();

  // Helper to get or create section
  const getSection = (repoId: string, worktreeId: string) => {
    const sectionId = `${repoId}:${worktreeId}`;
    if (!sectionMap.has(sectionId)) {
      sectionMap.set(sectionId, {
        repoId,
        worktreeId,
        repoName: getRepoName(repoId),
        worktreeName: getWorktreeName(repoId, worktreeId),
        worktreePath: getWorktreePath(repoId, worktreeId),
        items: [],
        latestUpdate: 0,
      });
    }
    return sectionMap.get(sectionId)!;
  };

  // Process threads
  for (const thread of threads) {
    const status = getThreadStatusVariant(thread);
    const section = getSection(thread.repoId, thread.worktreeId);
    const sectionId = `${thread.repoId}:${thread.worktreeId}`;

    section.items.push({
      type: "thread",
      id: thread.id,
      title: thread.name ?? "New Thread",
      status,
      updatedAt: thread.updatedAt,
      sectionId,
    });

    if (thread.updatedAt > section.latestUpdate) {
      section.latestUpdate = thread.updatedAt;
    }
  }

  // Process plans
  for (const plan of plans) {
    // Determine if any thread related to this plan is running
    const relations = relationService.getByPlan(plan.id);
    const relatedThreadIds = relations.map((r) => r.threadId);
    const hasRunningThread = relatedThreadIds.some((id) => runningThreadIds.has(id));

    const status = getPlanStatusVariant(plan.isRead, hasRunningThread, plan.stale);
    const section = getSection(plan.repoId, plan.worktreeId);
    const sectionId = `${plan.repoId}:${plan.worktreeId}`;

    // Extract filename from relativePath
    const filename = plan.relativePath.split("/").pop() ?? plan.relativePath;

    section.items.push({
      type: "plan",
      id: plan.id,
      title: filename,
      status,
      updatedAt: plan.updatedAt,
      sectionId,
    });

    if (plan.updatedAt > section.latestUpdate) {
      section.latestUpdate = plan.updatedAt;
    }
  }

  // Convert to array and sort
  const sections: RepoWorktreeSection[] = [];
  for (const [sectionId, data] of sectionMap) {
    // Sort items by updatedAt descending (most recent first)
    data.items.sort((a, b) => b.updatedAt - a.updatedAt);

    sections.push({
      type: "repo-worktree",
      id: sectionId,
      repoName: data.repoName,
      worktreeName: data.worktreeName,
      repoId: data.repoId,
      worktreeId: data.worktreeId,
      worktreePath: data.worktreePath,
      items: data.items,
      isExpanded: expandedSections[sectionId] ?? true, // Default to expanded
    });
  }

  // Sort sections by most recent item update
  sections.sort((a, b) => {
    const aLatest = sectionMap.get(a.id)?.latestUpdate ?? 0;
    const bLatest = sectionMap.get(b.id)?.latestUpdate ?? 0;
    return bLatest - aLatest;
  });

  return sections;
}

/**
 * Hook that provides tree data derived from entity stores.
 * Automatically updates when threads, plans, or expansion state changes.
 *
 * Uses pre-loaded repo/worktree lookup store for synchronous name resolution.
 * The lookup store is hydrated at app init, so by the time React renders,
 * all lookups are synchronous O(1) Map accesses.
 */
export function useTreeData(): RepoWorktreeSection[] {
  // Entity stores - reactive subscriptions
  const threads = useThreadStore((state) => state._threadsArray);
  const plans = usePlanStore((state) => state.getAll());
  const expandedSections = useTreeMenuStore((state) => state.expandedSections);

  // Lookup functions - from pre-hydrated store (synchronous)
  const getRepoName = useRepoWorktreeLookupStore((state) => state.getRepoName);
  const getWorktreeName = useRepoWorktreeLookupStore((state) => state.getWorktreeName);
  const getWorktreePath = useRepoWorktreeLookupStore((state) => state.getWorktreePath);

  // Get running thread IDs for plan status derivation
  const runningThreadIds = useMemo(() => {
    return new Set(threads.filter((t) => t.status === "running").map((t) => t.id));
  }, [threads]);

  return useMemo(() => {
    return buildTreeFromEntities(
      threads,
      plans,
      expandedSections,
      runningThreadIds,
      getRepoName,
      getWorktreeName,
      getWorktreePath
    );
  }, [threads, plans, expandedSections, runningThreadIds, getRepoName, getWorktreeName, getWorktreePath]);
}

/**
 * Hook for getting the currently selected tree item.
 */
export function useSelectedTreeItem(): TreeItemNode | null {
  const selectedItemId = useTreeMenuStore((state) => state.selectedItemId);
  const sections = useTreeData();

  return useMemo(() => {
    if (!selectedItemId) return null;
    for (const section of sections) {
      const item = section.items.find((i) => i.id === selectedItemId);
      if (item) return item;
    }
    return null;
  }, [selectedItemId, sections]);
}

/**
 * Hook for getting items in a specific section.
 */
export function useSectionItems(sectionId: string): TreeItemNode[] {
  const sections = useTreeData();
  return useMemo(() => {
    const section = sections.find((s) => s.id === sectionId);
    return section?.items ?? [];
  }, [sections, sectionId]);
}

/**
 * Hook for getting expansion state.
 */
export function useExpandedSections(): Record<string, boolean> {
  return useTreeMenuStore((state) => state.expandedSections);
}
```

---

## App Initialization Sequence

Add to `src/entities/index.ts`:

```typescript
import { setupTreeMenuListeners } from "@/stores/tree-menu/listeners";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

export async function initializeEntities(): Promise<void> {
  // ... existing hydrations ...

  // After repositories are hydrated, build the lookup cache
  await repoService.hydrate();
  await useRepoWorktreeLookupStore.getState().hydrate();

  // Then hydrate tree menu UI state
  await treeMenuService.hydrate();
}

export function setupEntityListeners(): void {
  // ... existing listeners ...
  setupTreeMenuListeners();
}
```

---

## Acceptance Criteria

- [ ] **Types compile:** `src/stores/tree-menu/types.ts` exports all types without errors
- [ ] **Zod validation:** Persisted state is validated with Zod schema on hydration
- [ ] **Store hydrates:** On app startup, `treeMenuService.hydrate()` loads state from `~/.anvil/ui/tree-menu.json`
- [ ] **Expansion persists:** Collapsing a section and restarting the app preserves the collapsed state
- [ ] **Selection persists:** Selecting an item and restarting the app preserves the selection
- [ ] **No direct disk I/O in store:** Store only has `_apply*` methods; service handles all disk operations
- [ ] **Listeners respond to events:** `THREAD_CREATED`, `THREAD_UPDATED`, `PLAN_UPDATED` trigger refreshes
- [ ] **Tree builds correctly:** `useTreeData()` returns sections with items grouped by repo/worktree
- [ ] **Repo/worktree names resolved:** Items show actual repository and worktree names (not "Unknown")
- [ ] **Items sorted:** Items within each section are sorted by `updatedAt` descending
- [ ] **Sections sorted:** Sections are sorted by most recently updated item
- [ ] **Status variants correct:** Thread items show running/unread/read status correctly
- [ ] **Plan status correct:** Plan items show stale/running/unread/read status correctly (using real `hasRunningThread`)
- [ ] **Thread names:** Thread items display AI-generated name or "New Thread" placeholder
- [ ] **Plan names:** Plan items display filename extracted from relativePath
- [ ] **Live updates:** Adding a new thread immediately appears in the tree without manual refresh
- [ ] **Cross-window sync:** Changes in one window appear in other windows via event listeners

---

## Testing Checklist

### Manual Testing

- [ ] Start app with no `~/.anvil/ui/tree-menu.json` - store initializes with defaults
- [ ] Toggle section expansion - state persists to disk
- [ ] Restart app - expansion state is restored
- [ ] Create a new thread - appears in correct section immediately
- [ ] Thread finishes running - status dot changes from green to blue/grey
- [ ] Thread is marked as read - status dot changes to grey
- [ ] Plan file is deleted - status dot changes to amber (stale)
- [ ] Plan has running thread - status dot shows running indicator
- [ ] Multiple repos - each repo/worktree gets its own section with correct names
- [ ] Open two windows - changes in one reflect in the other

### Console Verification

```javascript
// Verify store state
useTreeMenuStore.getState()
// => { expandedSections: {...}, selectedItemId: "...", _hydrated: true }

// Verify lookup store
useRepoWorktreeLookupStore.getState().getRepoName("some-uuid")
// => "My Repository" (not "Unknown")

// Verify tree data (in React DevTools or component)
useTreeData()
// => [{ type: "repo-worktree", id: "uuid1:uuid2", repoName: "...", items: [...] }, ...]
```

---

## Edge Cases

1. **Thread with no name:** Display "New Thread" until AI generates name
2. **Plan with nested path:** Extract only filename (e.g., `auth/login.md` -> `login.md`)
3. **Empty section:** Section with no items still renders (for UX, can collapse)
4. **Rapid updates:** Multiple threads updating quickly - Zustand batches updates automatically
5. **Corrupted persisted state:** `hydrate()` catches Zod validation errors and uses defaults
6. **Missing repo/worktree:** If thread references deleted repo, display "Unknown"/"main" (graceful degradation)
7. **Plan with no related threads:** `hasRunningThread` is false, status derived from `isRead` and `stale` only
8. **Disk write failure:** Service methods throw errors, UI remains in previous state

---

## Notes

- The `buildTreeFromEntities` function is pure for testability
- Repo/worktree lookup store is hydrated at app init, so all lookups in hooks are synchronous
- The service layer handles all disk I/O; store only has `_apply*` methods (per Entity Stores Pattern)
- Listeners refresh from disk on events (per Disk as Truth pattern)
- Default expansion state is `true` (expanded) for new sections
- The `relationService.getByPlan()` call is synchronous (relations are already in memory)

---

## Related Files

- `docs/patterns/entity-stores.md` - Store pattern reference
- `docs/patterns/disk-as-truth.md` - Disk persistence philosophy
- `docs/patterns/zod-boundaries.md` - Zod validation rules
- `docs/data-models.md` - Core entity relationships
- `src/lib/persistence.ts` - Disk I/O layer
- `src/entities/threads/store.ts` - Pattern reference for Zustand stores
- `src/entities/threads/service.ts` - Pattern reference for service layer
- `src/entities/threads/listeners.ts` - Pattern reference for event listeners
- `src/entities/relations/service.ts` - Plan-thread relation queries
- `src/utils/thread-colors.ts` - Status variant derivation
- `agents/src/services/thread-naming-service.ts` - AI thread naming (external)
