# Phase 4: New Layout Assembly

## Overview

This phase assembles the new main window layout by integrating components from Phases 1-3. We create the `TreePanelHeader` with icon buttons, wire up the `ContentPaneContainer` to manage panes by UUID, implement the content panes store with `~/.mort/` disk persistence following the Entity Stores pattern (service layer for I/O), and perform a complete rewrite of `main-window-layout.tsx`.

**Dependencies:** Phases 1-3 must be complete before starting this phase.
- Phase 1: `ContentPane`, `ContentPaneView` type, `ResizablePanel`, tree primitives
- Phase 2: `useTreeMenuStore`, tree data types, entity mapping
- Phase 3: `TreeMenu` component, `RepoWorktreeSection`, tree items

**Blocked by:** This phase cannot run in parallel with Phases 1-3.

**Required by:** Phase 5 (deprecation cleanup)

---

## Files to Read First

Before implementing, read these files to understand current patterns:

| File | Purpose |
|------|---------|
| `/Users/zac/Documents/juice/mort/mortician/src/components/main-window/main-window-layout.tsx` | Current layout (will be rewritten) |
| `/Users/zac/Documents/juice/mort/mortician/src/components/main-window/sidebar.tsx` | Current sidebar with header icons pattern |
| `/Users/zac/Documents/juice/mort/mortician/src/lib/persistence.ts` | Disk persistence API |
| `/Users/zac/Documents/juice/mort/mortician/src/entities/threads/store.ts` | Zustand store patterns |
| `/Users/zac/Documents/juice/mort/mortician/src/entities/threads/service.ts` | Service layer patterns |
| `/Users/zac/Documents/juice/mort/mortician/src/entities/threads/listeners.ts` | Event listener patterns |
| `/Users/zac/Documents/juice/mort/mortician/src/components/inbox/empty-inbox-state.tsx` | Empty state to reuse |
| `/Users/zac/Documents/juice/mort/mortician/src/components/ui/status-legend.tsx` | StatusLegend component |
| `/Users/zac/Documents/juice/mort/mortician/src/components/content-pane/types.ts` | Phase 1 ContentPaneView type |
| `/Users/zac/Documents/juice/mort/mortician/docs/patterns/entity-stores.md` | Store pattern documentation |

---

## Target File Structure

Following the Entity Stores pattern with proper separation of concerns:

```
src/stores/content-panes/
├── types.ts              # Types + Zod schemas for disk validation
├── store.ts              # Zustand store (_apply* methods only)
├── service.ts            # Disk I/O + store writes
└── listeners.ts          # Event subscriptions (THREAD_ARCHIVED, PLAN_ARCHIVED)

src/stores/layout/
├── types.ts              # Types + Zod schemas for disk validation
├── store.ts              # Zustand store (_apply* methods only)
├── service.ts            # Disk I/O + store writes (debounced for resize)
└── index.ts              # Barrel export

src/components/
├── tree-menu/
│   └── tree-panel-header.tsx       # NEW: Header with icon buttons
├── content-pane/
│   └── content-pane-container.tsx  # NEW: Manages panes by UUID
└── main-window/
    └── main-window-layout.tsx      # REWRITE: New layout structure
```

---

## Task Checklist

### 4.1 Create Content Panes Store (Service Pattern)

- [ ] Create `src/stores/content-panes/types.ts` with Zod schemas
- [ ] Create `src/stores/content-panes/store.ts` with `_apply*` methods only
- [ ] Create `src/stores/content-panes/service.ts` for disk I/O
- [ ] Create `src/stores/content-panes/listeners.ts` for event subscriptions
- [ ] Create `src/stores/content-panes/index.ts` barrel export
- [ ] Import `ContentPaneView` from Phase 1's `@/components/content-pane/types`
- [ ] Add `ContentPanesPersistedStateSchema` Zod schema for disk validation
- [ ] Implement disk persistence to `~/.mort/ui/content-panes.json`
- [ ] Add default pane creation on first launch
- [ ] Add listeners for `THREAD_ARCHIVED` and `PLAN_ARCHIVED` events

### 4.2 Create Layout Store (Service Pattern)

- [ ] Create `src/stores/layout/types.ts` with Zod schemas
- [ ] Create `src/stores/layout/store.ts` with `_apply*` methods only
- [ ] Create `src/stores/layout/service.ts` for disk I/O with **debounced resize persistence**
- [ ] Create `src/stores/layout/index.ts` barrel export
- [ ] Add `LayoutPersistedStateSchema` Zod schema for disk validation
- [ ] Implement persistence to `~/.mort/ui/layout.json`
- [ ] Add debounced `persistWidth()` (200ms) for panel resize operations

### 4.3 Create TreePanelHeader Component

- [ ] Create `src/components/tree-menu/tree-panel-header.tsx`
- [ ] Add icon buttons: Settings, Logs, Terminal, New (dropdown)
- [ ] Wire Settings icon to `contentPanesService.setActivePaneView({ type: "settings" })`
- [ ] Wire Logs icon to `contentPanesService.setActivePaneView({ type: "logs" })`
- [ ] Wire Terminal icon (placeholder for terminal integration)
- [ ] Wire New button with dropdown (New Thread, New Worktree)
- [ ] Add MORT logo and title
- [ ] Style to match existing sidebar header

### 4.4 Create ContentPaneContainer Component

- [ ] Create `src/components/content-pane/content-pane-container.tsx`
- [ ] Subscribe to `useContentPanesStore` for active pane
- [ ] Render appropriate content based on `ContentPaneView` type
- [ ] Handle empty state (show `EmptyInboxState` / onboarding guide)
- [ ] Render `ThreadContent` for thread views
- [ ] Render `PlanContent` for plan views
- [ ] Render `SettingsPage` for settings view
- [ ] Render `LogsPage` for logs view
- [ ] Add placeholder for terminal view

### 4.5 Rewrite main-window-layout.tsx

- [ ] Remove old tab-based navigation system
- [ ] Remove old `Sidebar` component usage
- [ ] Use Phase 1's `ResizablePanel` with `persistKey` approach
- [ ] Import `TreePanelHeader`, `TreeMenu`, `StatusLegend`
- [ ] Import `ContentPaneContainer`
- [ ] Implement new layout structure (see Target Layout below)
- [ ] Wire tree selection to content pane state via service
- [ ] Keep `BuildModeIndicator` at root level
- [ ] Initialize stores and listeners on mount

### 4.6 Wire Tree Selection to Content Pane

- [ ] Use Phase 3's signature: `onItemSelect(itemType: "thread" | "plan", itemId: string)`
- [ ] Call `contentPanesService.setActivePaneView()` with appropriate view
- [ ] For threads: `{ type: "thread", threadId: itemId }`
- [ ] For plans: `{ type: "plan", planId: itemId }`
- [ ] Service handles persistence automatically

### 4.7 Handle Navigation Events

- [ ] Update "navigate" event listener for new architecture
- [ ] Map "settings" navigation to `contentPanesService.setActivePaneView({ type: "settings" })`
- [ ] Map "logs" navigation to `contentPanesService.setActivePaneView({ type: "logs" })`
- [ ] Remove "inbox" and "worktrees" navigation handlers

### 4.8 Setup Store Initialization

- [ ] Create initialization function in `main-window-layout.tsx`
- [ ] Hydrate stores in correct order with error isolation
- [ ] Each store hydrates independently (failure of one doesn't block others)
- [ ] Log initialization status for debugging
- [ ] Ensure `_hydrated` flags are set consistently

---

## Implementation Details

### 4.1 Content Panes Types (`src/stores/content-panes/types.ts`)

```typescript
import { z } from "zod";
import type { ContentPaneView } from "@/components/content-pane/types";

// ═══════════════════════════════════════════════════════════════════════════
// Re-export ContentPaneView from Phase 1 (single source of truth)
// ═══════════════════════════════════════════════════════════════════════════

export type { ContentPaneView } from "@/components/content-pane/types";

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for Disk Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for validating ContentPaneView when reading from disk.
 * Matches the ContentPaneView type from Phase 1.
 */
export const ContentPaneViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("empty") }),
  z.object({ type: z.literal("thread"), threadId: z.string() }),
  z.object({ type: z.literal("plan"), planId: z.string() }),
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("logs") }),
  z.object({ type: z.literal("terminal"), terminalId: z.string() }),
]);

/**
 * Schema for a single content pane.
 */
export const ContentPaneSchema = z.object({
  id: z.string(),
  view: ContentPaneViewSchema,
});

/**
 * Schema for the persisted state read from disk.
 * Used to validate ~/.mort/ui/content-panes.json
 */
export const ContentPanesPersistedStateSchema = z.object({
  panes: z.record(z.string(), ContentPaneSchema),
  activePaneId: z.string().nullable(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TypeScript Types (derived from schemas)
// ═══════════════════════════════════════════════════════════════════════════

export type ContentPane = z.infer<typeof ContentPaneSchema>;
export type ContentPanesPersistedState = z.infer<typeof ContentPanesPersistedStateSchema>;

/**
 * Full store state (persisted + runtime flags)
 */
export interface ContentPanesState extends ContentPanesPersistedState {
  _hydrated: boolean;
}
```

### 4.1 Content Panes Store (`src/stores/content-panes/store.ts`)

```typescript
import { create } from "zustand";
import type { ContentPanesState, ContentPane, ContentPaneView } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Store Actions (internal _apply* methods only)
// ═══════════════════════════════════════════════════════════════════════════

interface ContentPanesActions {
  /** Apply hydrated state from disk */
  _applyHydrate: (state: Omit<ContentPanesState, "_hydrated">) => void;

  /** Apply pane creation */
  _applyCreate: (pane: ContentPane, setActive?: boolean) => () => void;

  /** Apply pane deletion */
  _applyDelete: (paneId: string) => () => void;

  /** Apply pane view update */
  _applySetView: (paneId: string, view: ContentPaneView) => () => void;

  /** Apply active pane change */
  _applySetActive: (paneId: string | null) => () => void;

  /** Mark as hydrated (for error recovery) */
  _applyMarkHydrated: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════════════════

export const useContentPanesStore = create<ContentPanesState & ContentPanesActions>(
  (set, get) => ({
    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────
    panes: {},
    activePaneId: null,
    _hydrated: false,

    // ─────────────────────────────────────────────────────────────────────────
    // Internal _apply* Methods (called by service only)
    // ─────────────────────────────────────────────────────────────────────────

    _applyHydrate: (state) => {
      set({
        panes: state.panes,
        activePaneId: state.activePaneId,
        _hydrated: true,
      });
    },

    _applyMarkHydrated: () => {
      set({ _hydrated: true });
    },

    _applyCreate: (pane, setActive = true) => {
      const prev = get();
      set((state) => ({
        panes: { ...state.panes, [pane.id]: pane },
        activePaneId: setActive ? pane.id : state.activePaneId,
      }));

      // Return rollback function for optimistic updates
      return () => {
        set({
          panes: prev.panes,
          activePaneId: prev.activePaneId,
        });
      };
    },

    _applyDelete: (paneId) => {
      const prev = get();
      set((state) => {
        const { [paneId]: removed, ...remainingPanes } = state.panes;

        // If deleting active pane, switch to another
        let newActivePaneId = state.activePaneId;
        if (state.activePaneId === paneId) {
          const remainingIds = Object.keys(remainingPanes);
          newActivePaneId = remainingIds.length > 0 ? remainingIds[0] : null;
        }

        return {
          panes: remainingPanes,
          activePaneId: newActivePaneId,
        };
      });

      return () => {
        set({
          panes: prev.panes,
          activePaneId: prev.activePaneId,
        });
      };
    },

    _applySetView: (paneId, view) => {
      const prev = get();
      const pane = prev.panes[paneId];
      if (!pane) {
        return () => {}; // No-op rollback
      }

      set((state) => ({
        panes: {
          ...state.panes,
          [paneId]: { ...state.panes[paneId], view },
        },
      }));

      return () => {
        set((state) => ({
          panes: {
            ...state.panes,
            [paneId]: pane,
          },
        }));
      };
    },

    _applySetActive: (paneId) => {
      const prev = get();
      set({ activePaneId: paneId });
      return () => {
        set({ activePaneId: prev.activePaneId });
      };
    },
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/** Hook to get the active pane's view */
export function useActivePaneView(): ContentPaneView | null {
  return useContentPanesStore((state) => {
    if (!state.activePaneId) return null;
    return state.panes[state.activePaneId]?.view ?? null;
  });
}

/** Hook to check if store is hydrated */
export function useContentPanesHydrated(): boolean {
  return useContentPanesStore((state) => state._hydrated);
}

/** Hook to get the active pane */
export function useActivePane(): ContentPane | null {
  return useContentPanesStore((state) => {
    if (!state.activePaneId) return null;
    return state.panes[state.activePaneId] ?? null;
  });
}
```

### 4.1 Content Panes Service (`src/stores/content-panes/service.ts`)

```typescript
import { persistence } from "@/lib/persistence";
import { logger } from "@/lib/logger-client";
import { useContentPanesStore } from "./store";
import {
  ContentPanesPersistedStateSchema,
  type ContentPane,
  type ContentPaneView,
  type ContentPanesPersistedState,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const PERSISTENCE_PATH = "ui/content-panes.json";

// ═══════════════════════════════════════════════════════════════════════════
// Service (all disk I/O + store writes go through here)
// ═══════════════════════════════════════════════════════════════════════════

export const contentPanesService = {
  /**
   * Hydrate store from disk on app startup.
   * Uses Zod to validate persisted state.
   */
  async hydrate(): Promise<void> {
    const store = useContentPanesStore.getState();

    try {
      const raw = await persistence.readJson<unknown>(PERSISTENCE_PATH);

      if (raw) {
        const result = ContentPanesPersistedStateSchema.safeParse(raw);

        if (result.success) {
          const data = result.data;

          // Validate activePaneId references an existing pane
          let validActivePaneId = data.activePaneId;
          if (validActivePaneId && !data.panes[validActivePaneId]) {
            logger.warn("[ContentPanesService] activePaneId references non-existent pane, resetting", {
              activePaneId: validActivePaneId,
            });
            const paneIds = Object.keys(data.panes);
            validActivePaneId = paneIds.length > 0 ? paneIds[0] : null;
          }

          store._applyHydrate({
            panes: data.panes,
            activePaneId: validActivePaneId,
          });

          logger.info("[ContentPanesService] Hydrated from disk", {
            paneCount: Object.keys(data.panes).length,
            activePaneId: validActivePaneId,
          });
          return;
        } else {
          logger.error("[ContentPanesService] Invalid persisted state, creating default", {
            errors: result.error.issues,
          });
        }
      }

      // First launch or invalid state - create default pane
      await this.createDefaultPane();

    } catch (error) {
      logger.error("[ContentPanesService] Failed to hydrate:", error);
      // Create default pane on error
      await this.createDefaultPane();
    }
  },

  /**
   * Create a default pane for first launch or error recovery.
   */
  async createDefaultPane(): Promise<string> {
    const paneId = crypto.randomUUID();
    const pane: ContentPane = {
      id: paneId,
      view: { type: "empty" },
    };

    useContentPanesStore.getState()._applyCreate(pane, true);
    useContentPanesStore.getState()._applyMarkHydrated();

    await this.persist();
    logger.info("[ContentPanesService] Created default pane", { paneId });

    return paneId;
  },

  /**
   * Create a new pane with optional initial view.
   * Returns the new pane's UUID.
   */
  async createPane(view: ContentPaneView = { type: "empty" }): Promise<string> {
    const paneId = crypto.randomUUID();
    const pane: ContentPane = { id: paneId, view };

    useContentPanesStore.getState()._applyCreate(pane, true);
    await this.persist();

    return paneId;
  },

  /**
   * Close a pane by ID.
   */
  async closePane(paneId: string): Promise<void> {
    useContentPanesStore.getState()._applyDelete(paneId);
    await this.persist();
  },

  /**
   * Set the view for a specific pane.
   */
  async setPaneView(paneId: string, view: ContentPaneView): Promise<void> {
    const store = useContentPanesStore.getState();
    if (!store.panes[paneId]) {
      logger.warn("[ContentPanesService] setPaneView: pane not found", { paneId });
      return;
    }

    store._applySetView(paneId, view);
    await this.persist();
  },

  /**
   * Set the active pane.
   */
  async setActivePane(paneId: string): Promise<void> {
    const store = useContentPanesStore.getState();
    if (!store.panes[paneId]) {
      logger.warn("[ContentPanesService] setActivePane: pane not found", { paneId });
      return;
    }

    store._applySetActive(paneId);
    await this.persist();
  },

  /**
   * Set view on the active pane (convenience method).
   * Creates a new pane if none exists.
   */
  async setActivePaneView(view: ContentPaneView): Promise<void> {
    const store = useContentPanesStore.getState();

    if (!store.activePaneId) {
      // No active pane - create one
      await this.createPane(view);
      return;
    }

    await this.setPaneView(store.activePaneId, view);
  },

  /**
   * Get the active pane (convenience getter).
   */
  getActivePane(): ContentPane | null {
    const state = useContentPanesStore.getState();
    if (!state.activePaneId) return null;
    return state.panes[state.activePaneId] ?? null;
  },

  /**
   * Handle entity deletion by resetting pane if it shows the deleted entity.
   * Called by listeners when THREAD_ARCHIVED or PLAN_ARCHIVED events fire.
   */
  async handleEntityDeleted(entityType: "thread" | "plan", entityId: string): Promise<void> {
    const store = useContentPanesStore.getState();
    let needsPersist = false;

    for (const [paneId, pane] of Object.entries(store.panes)) {
      if (
        (entityType === "thread" && pane.view.type === "thread" && pane.view.threadId === entityId) ||
        (entityType === "plan" && pane.view.type === "plan" && pane.view.planId === entityId)
      ) {
        store._applySetView(paneId, { type: "empty" });
        needsPersist = true;
        logger.info("[ContentPanesService] Reset pane showing deleted entity", {
          paneId,
          entityType,
          entityId,
        });
      }
    }

    if (needsPersist) {
      await this.persist();
    }
  },

  /**
   * Persist current state to disk.
   * Note: For UI state, we persist after mutation (acceptable per disk-as-truth pattern
   * since no events are emitted for UI state changes).
   */
  async persist(): Promise<void> {
    const state = useContentPanesStore.getState();
    const toSave: ContentPanesPersistedState = {
      panes: state.panes,
      activePaneId: state.activePaneId,
    };

    try {
      await persistence.writeJson(PERSISTENCE_PATH, toSave);
    } catch (error) {
      logger.error("[ContentPanesService] Failed to persist state:", error);
    }
  },
};
```

### 4.1 Content Panes Listeners (`src/stores/content-panes/listeners.ts`)

```typescript
import { eventBus } from "@/lib/event-bridge";
import { EventName } from "@/lib/event-bridge";
import { contentPanesService } from "./service";
import { logger } from "@/lib/logger-client";

/**
 * Setup listeners for content panes store.
 * Handles entity deletion events to reset panes showing deleted items.
 */
export function setupContentPanesListeners(): void {
  // When a thread is archived, reset any pane showing it
  eventBus.on(EventName.THREAD_ARCHIVED, async ({ threadId }) => {
    logger.debug("[ContentPanesListeners] THREAD_ARCHIVED", { threadId });
    await contentPanesService.handleEntityDeleted("thread", threadId);
  });

  // When a plan is archived, reset any pane showing it
  eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }) => {
    logger.debug("[ContentPanesListeners] PLAN_ARCHIVED", { planId });
    await contentPanesService.handleEntityDeleted("plan", planId);
  });

  logger.info("[ContentPanesListeners] Listeners registered");
}
```

### 4.1 Content Panes Index (`src/stores/content-panes/index.ts`)

```typescript
// Types
export type {
  ContentPaneView,
  ContentPane,
  ContentPanesState,
  ContentPanesPersistedState,
} from "./types";

export {
  ContentPaneViewSchema,
  ContentPaneSchema,
  ContentPanesPersistedStateSchema,
} from "./types";

// Store
export {
  useContentPanesStore,
  useActivePaneView,
  useContentPanesHydrated,
  useActivePane,
} from "./store";

// Service
export { contentPanesService } from "./service";

// Listeners
export { setupContentPanesListeners } from "./listeners";
```

### 4.2 Layout Types (`src/stores/layout/types.ts`)

```typescript
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for Disk Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for the persisted layout state.
 * Used to validate ~/.mort/ui/layout.json
 */
export const LayoutPersistedStateSchema = z.object({
  treePanelWidth: z.number().min(0).max(1000).default(280),
  treePanelVisible: z.boolean().default(true),
});

// ═══════════════════════════════════════════════════════════════════════════
// TypeScript Types
// ═══════════════════════════════════════════════════════════════════════════

export type LayoutPersistedState = z.infer<typeof LayoutPersistedStateSchema>;

/**
 * Full store state (persisted + runtime flags)
 */
export interface LayoutState extends LayoutPersistedState {
  _hydrated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_TREE_PANEL_WIDTH = 280;
export const MIN_TREE_PANEL_WIDTH = 180;
export const MAX_TREE_PANEL_WIDTH = 400;
export const SNAP_TO_CLOSE_THRESHOLD = 100;
```

### 4.2 Layout Store (`src/stores/layout/store.ts`)

```typescript
import { create } from "zustand";
import type { LayoutState, LayoutPersistedState } from "./types";
import { DEFAULT_TREE_PANEL_WIDTH } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Store Actions (internal _apply* methods only)
// ═══════════════════════════════════════════════════════════════════════════

interface LayoutActions {
  /** Apply hydrated state from disk */
  _applyHydrate: (state: LayoutPersistedState) => void;

  /** Apply tree panel width change */
  _applySetWidth: (width: number) => () => void;

  /** Apply tree panel visibility change */
  _applySetVisible: (visible: boolean) => () => void;

  /** Mark as hydrated (for error recovery) */
  _applyMarkHydrated: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════════════════

export const useLayoutStore = create<LayoutState & LayoutActions>((set, get) => ({
  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────
  treePanelWidth: DEFAULT_TREE_PANEL_WIDTH,
  treePanelVisible: true,
  _hydrated: false,

  // ─────────────────────────────────────────────────────────────────────────
  // Internal _apply* Methods (called by service only)
  // ─────────────────────────────────────────────────────────────────────────

  _applyHydrate: (state) => {
    set({
      treePanelWidth: state.treePanelWidth,
      treePanelVisible: state.treePanelVisible,
      _hydrated: true,
    });
  },

  _applyMarkHydrated: () => {
    set({ _hydrated: true });
  },

  _applySetWidth: (width) => {
    const prev = get().treePanelWidth;
    set({ treePanelWidth: width, treePanelVisible: true });
    return () => set({ treePanelWidth: prev });
  },

  _applySetVisible: (visible) => {
    const prev = get().treePanelVisible;
    set({ treePanelVisible: visible });
    return () => set({ treePanelVisible: prev });
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/** Hook to check if layout store is hydrated */
export function useLayoutHydrated(): boolean {
  return useLayoutStore((state) => state._hydrated);
}
```

### 4.2 Layout Service (`src/stores/layout/service.ts`)

```typescript
import { persistence } from "@/lib/persistence";
import { logger } from "@/lib/logger-client";
import { useLayoutStore } from "./store";
import {
  LayoutPersistedStateSchema,
  type LayoutPersistedState,
  MIN_TREE_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
  SNAP_TO_CLOSE_THRESHOLD,
  DEFAULT_TREE_PANEL_WIDTH,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const PERSISTENCE_PATH = "ui/layout.json";
const RESIZE_DEBOUNCE_MS = 200;

// ═══════════════════════════════════════════════════════════════════════════
// Debounce Helper
// ═══════════════════════════════════════════════════════════════════════════

let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersist(): void {
  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer);
  }
  resizeDebounceTimer = setTimeout(async () => {
    await layoutService.persist();
    resizeDebounceTimer = null;
  }, RESIZE_DEBOUNCE_MS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════

export const layoutService = {
  /**
   * Hydrate store from disk on app startup.
   * Uses Zod to validate persisted state.
   */
  async hydrate(): Promise<void> {
    const store = useLayoutStore.getState();

    try {
      const raw = await persistence.readJson<unknown>(PERSISTENCE_PATH);

      if (raw) {
        const result = LayoutPersistedStateSchema.safeParse(raw);

        if (result.success) {
          store._applyHydrate(result.data);
          logger.info("[LayoutService] Hydrated from disk", result.data);
          return;
        } else {
          logger.error("[LayoutService] Invalid persisted state, using defaults", {
            errors: result.error.issues,
          });
        }
      }

      // No saved state or invalid - use defaults
      store._applyMarkHydrated();
      logger.info("[LayoutService] No saved layout, using defaults");

    } catch (error) {
      logger.error("[LayoutService] Failed to hydrate:", error);
      store._applyMarkHydrated();
    }
  },

  /**
   * Set tree panel width with snap-to-close behavior.
   * Debounces persistence for drag operations.
   */
  setTreePanelWidth(width: number): void {
    const store = useLayoutStore.getState();

    // Snap to close if below threshold
    if (width < SNAP_TO_CLOSE_THRESHOLD) {
      store._applySetVisible(false);
      debouncedPersist();
      return;
    }

    // Clamp to min/max
    const clampedWidth = Math.max(
      MIN_TREE_PANEL_WIDTH,
      Math.min(MAX_TREE_PANEL_WIDTH, width)
    );

    store._applySetWidth(clampedWidth);
    debouncedPersist();
  },

  /**
   * Set tree panel visibility.
   */
  async setTreePanelVisible(visible: boolean): Promise<void> {
    useLayoutStore.getState()._applySetVisible(visible);
    await this.persist();
  },

  /**
   * Toggle tree panel visibility.
   */
  async toggleTreePanel(): Promise<void> {
    const visible = useLayoutStore.getState().treePanelVisible;
    await this.setTreePanelVisible(!visible);
  },

  /**
   * Persist current state to disk.
   */
  async persist(): Promise<void> {
    const state = useLayoutStore.getState();
    const toSave: LayoutPersistedState = {
      treePanelWidth: state.treePanelWidth,
      treePanelVisible: state.treePanelVisible,
    };

    try {
      await persistence.writeJson(PERSISTENCE_PATH, toSave);
    } catch (error) {
      logger.error("[LayoutService] Failed to persist state:", error);
    }
  },
};
```

### 4.2 Layout Index (`src/stores/layout/index.ts`)

```typescript
// Types
export type { LayoutState, LayoutPersistedState } from "./types";
export {
  LayoutPersistedStateSchema,
  DEFAULT_TREE_PANEL_WIDTH,
  MIN_TREE_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
  SNAP_TO_CLOSE_THRESHOLD,
} from "./types";

// Store
export { useLayoutStore, useLayoutHydrated } from "./store";

// Service
export { layoutService } from "./service";
```

### 4.3 TreePanelHeader Component (`src/components/tree-menu/tree-panel-header.tsx`)

```tsx
import { useState } from "react";
import { Cog, ScrollText, Terminal, Plus, FolderGit2, MessageSquarePlus } from "lucide-react";
import { MortLogo } from "../ui/mort-logo";
import { Tooltip } from "../ui/tooltip";
import { contentPanesService } from "@/stores/content-panes";

interface TreePanelHeaderProps {
  /** Optional: Called when a new thread is requested */
  onNewThread?: () => void;
  /** Optional: Called when a new worktree is requested */
  onNewWorktree?: () => void;
}

export function TreePanelHeader({ onNewThread, onNewWorktree }: TreePanelHeaderProps) {
  const [showNewMenu, setShowNewMenu] = useState(false);

  const handleSettingsClick = () => {
    contentPanesService.setActivePaneView({ type: "settings" });
  };

  const handleLogsClick = () => {
    contentPanesService.setActivePaneView({ type: "logs" });
  };

  const handleTerminalClick = () => {
    // TODO: Integrate with terminal-ui-integration.md
    // This is a placeholder - terminal ID management will be implemented
    // when terminal integration is complete
    const terminalId = crypto.randomUUID();
    contentPanesService.setActivePaneView({ type: "terminal", terminalId });
  };

  const handleNewThread = () => {
    setShowNewMenu(false);
    onNewThread?.();
  };

  const handleNewWorktree = () => {
    setShowNewMenu(false);
    onNewWorktree?.();
  };

  return (
    <div className="px-3 py-1.5 border-b border-surface-800 flex items-center gap-2.5">
      {/* Logo and title */}
      <MortLogo size={4} />
      <h1 className="font-semibold text-surface-100 font-mono text-sm">MORT</h1>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Icon buttons */}
      <div className="flex items-center gap-0.5">
        <Tooltip content="Settings" side="bottom">
          <button
            onClick={handleSettingsClick}
            className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Settings"
          >
            <Cog size={12} />
          </button>
        </Tooltip>

        <Tooltip content="Logs" side="bottom">
          <button
            onClick={handleLogsClick}
            className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Logs"
          >
            <ScrollText size={12} />
          </button>
        </Tooltip>

        <Tooltip content="Terminal" side="bottom">
          <button
            onClick={handleTerminalClick}
            className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Terminal"
          >
            <Terminal size={12} />
          </button>
        </Tooltip>

        {/* New dropdown */}
        <div className="relative">
          <Tooltip content="New..." side="bottom">
            <button
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
              aria-label="New"
              aria-expanded={showNewMenu}
              aria-haspopup="menu"
            >
              <Plus size={12} />
            </button>
          </Tooltip>

          {showNewMenu && (
            <>
              {/* Backdrop to close menu */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowNewMenu(false)}
              />

              {/* Dropdown menu */}
              <div
                className="absolute right-0 top-full mt-1 z-20 bg-surface-900 border border-surface-700 rounded-lg shadow-lg py-1 min-w-[140px]"
                role="menu"
              >
                <button
                  onClick={handleNewThread}
                  className="w-full px-3 py-1.5 text-left text-sm text-surface-200 hover:bg-surface-800 flex items-center gap-2"
                  role="menuitem"
                >
                  <MessageSquarePlus size={14} />
                  New Thread
                </button>
                <button
                  onClick={handleNewWorktree}
                  className="w-full px-3 py-1.5 text-left text-sm text-surface-200 hover:bg-surface-800 flex items-center gap-2"
                  role="menuitem"
                >
                  <FolderGit2 size={14} />
                  New Worktree
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 4.4 ContentPaneContainer Component (`src/components/content-pane/content-pane-container.tsx`)

```tsx
import { useActivePaneView, useContentPanesHydrated } from "@/stores/content-panes";
import { useLayoutHydrated } from "@/stores/layout";
import { EmptyInboxState } from "../inbox/empty-inbox-state";
import { ThreadContent } from "./thread-content";     // From Phase 1
import { PlanContent } from "./plan-content";         // From Phase 1
import { SettingsPage } from "../main-window/settings-page";
import { LogsPage } from "../main-window/logs-page";
import { logger } from "@/lib/logger-client";

/**
 * ContentPaneContainer manages rendering the active content pane.
 *
 * In the future, this will support multiple panes (splits/tabs).
 * For now, it renders a single pane based on the active pane's view.
 */
export function ContentPaneContainer() {
  const contentPanesHydrated = useContentPanesHydrated();
  const layoutHydrated = useLayoutHydrated();
  const view = useActivePaneView();

  // Wait for both stores to hydrate to prevent flash
  const hydrated = contentPanesHydrated && layoutHydrated;

  if (!hydrated) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-900">
        <div className="text-surface-500 text-sm">Loading...</div>
      </div>
    );
  }

  // Handle empty/null view
  if (!view || view.type === "empty") {
    return (
      <div className="flex-1 overflow-auto bg-surface-900">
        <EmptyInboxState />
      </div>
    );
  }

  // Render based on view type
  switch (view.type) {
    case "thread":
      return (
        <div className="flex-1 overflow-hidden bg-surface-900">
          <ThreadContent threadId={view.threadId} />
        </div>
      );

    case "plan":
      return (
        <div className="flex-1 overflow-hidden bg-surface-900">
          <PlanContent planId={view.planId} />
        </div>
      );

    case "settings":
      return (
        <div className="flex-1 overflow-auto bg-surface-900">
          <SettingsPage />
        </div>
      );

    case "logs":
      return (
        <div className="flex-1 overflow-hidden bg-surface-900">
          <LogsPage />
        </div>
      );

    case "terminal":
      // Placeholder for terminal integration
      // See plans/terminal-ui-integration.md
      return (
        <div className="flex-1 flex items-center justify-center bg-surface-900">
          <div className="text-surface-500 text-sm">
            Terminal view coming soon (ID: {view.terminalId})
          </div>
        </div>
      );

    default:
      logger.warn("[ContentPaneContainer] Unknown view type:", view);
      return (
        <div className="flex-1 overflow-auto bg-surface-900">
          <EmptyInboxState />
        </div>
      );
  }
}
```

### 4.5 Main Window Layout Rewrite (`src/components/main-window/main-window-layout.tsx`)

```tsx
import { useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { ResizablePanel } from "../ui/resizable-panel";
import { TreePanelHeader } from "../tree-menu/tree-panel-header";
import { TreeMenu } from "../tree-menu/tree-menu";
import { StatusLegend } from "@/components/ui/status-legend";
import { ContentPaneContainer } from "../content-pane/content-pane-container";
import { BuildModeIndicator } from "../ui/BuildModeIndicator";
import {
  contentPanesService,
  setupContentPanesListeners,
} from "@/stores/content-panes";
import {
  useLayoutStore,
  layoutService,
  MIN_TREE_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
} from "@/stores/layout";
import { useTreeMenuStore } from "@/stores/tree-menu-store";
import { logger } from "@/lib/logger-client";

/**
 * MainWindowLayout - The new main window structure with:
 * - Resizable tree panel (left) containing header, tree menu, and status legend
 * - Content pane container (right) displaying thread/plan/settings/logs
 */
export function MainWindowLayout() {
  const listenersInitialized = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Store subscriptions
  // ─────────────────────────────────────────────────────────────────────────
  const treePanelWidth = useLayoutStore((s) => s.treePanelWidth);
  const treePanelVisible = useLayoutStore((s) => s.treePanelVisible);

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization on mount
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const initialize = async () => {
      // Setup listeners once (before hydration)
      if (!listenersInitialized.current) {
        setupContentPanesListeners();
        listenersInitialized.current = true;
      }

      // Hydrate stores independently - each can fail without blocking others
      const hydrationResults = await Promise.allSettled([
        contentPanesService.hydrate(),
        layoutService.hydrate(),
        useTreeMenuStore.getState().hydrate?.(),
      ]);

      // Log any hydration failures
      hydrationResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const storeNames = ["contentPanes", "layout", "treeMenu"];
          logger.error(`[MainWindowLayout] Failed to hydrate ${storeNames[index]}:`, result.reason);
        }
      });

      logger.info("[MainWindowLayout] Initialization complete");
    };

    initialize();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Tree selection handler
  // Matches Phase 3 signature: (itemType, itemId)
  // ─────────────────────────────────────────────────────────────────────────
  const handleTreeItemSelect = useCallback(
    (itemType: "thread" | "plan", itemId: string) => {
      logger.info("[MainWindowLayout] Tree item selected:", { itemType, itemId });

      if (itemType === "thread") {
        contentPanesService.setActivePaneView({ type: "thread", threadId: itemId });
      } else {
        contentPanesService.setActivePaneView({ type: "plan", planId: itemId });
      }
    },
    []
  );

  // ─────────────────────────────────────────────────────────────────────────
  // New item handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleNewThread = useCallback(() => {
    // TODO: Implement new thread creation
    // This should trigger spotlight or a creation dialog
    logger.info("[MainWindowLayout] New thread requested");
  }, []);

  const handleNewWorktree = useCallback(() => {
    // TODO: Implement new worktree creation
    logger.info("[MainWindowLayout] New worktree requested");
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Panel resize handler (calls service for debounced persistence)
  // ─────────────────────────────────────────────────────────────────────────
  const handlePanelResize = useCallback((newWidth: number) => {
    layoutService.setTreePanelWidth(newWidth);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Panel close handler (snap-to-close)
  // ─────────────────────────────────────────────────────────────────────────
  const handlePanelClose = useCallback(() => {
    layoutService.setTreePanelVisible(false);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation events from native macOS menu
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<string>("navigate", (event) => {
      const target = event.payload;
      logger.info("[MainWindowLayout] Navigate event:", target);

      switch (target) {
        case "settings":
          contentPanesService.setActivePaneView({ type: "settings" });
          break;
        case "logs":
          contentPanesService.setActivePaneView({ type: "logs" });
          break;
        default:
          // Ignore deprecated navigation targets (inbox, worktrees)
          logger.warn("[MainWindowLayout] Unknown navigation target:", target);
      }
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {
        // Component unmounted before promise resolved - safe to ignore
      });
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-surface-900">
      {/* Tree Panel (Resizable) */}
      {treePanelVisible && (
        <ResizablePanel
          position="left"
          minWidth={MIN_TREE_PANEL_WIDTH}
          maxWidth={MAX_TREE_PANEL_WIDTH}
          defaultWidth={treePanelWidth}
          persistKey="tree-panel-width"
          onClose={handlePanelClose}
        >
          <div className="flex flex-col h-full bg-surface-950 border-r border-surface-800">
            {/* Header with icon buttons */}
            <TreePanelHeader
              onNewThread={handleNewThread}
              onNewWorktree={handleNewWorktree}
            />

            {/* Tree menu (scrollable) */}
            <div className="flex-1 overflow-auto">
              <TreeMenu onItemSelect={handleTreeItemSelect} />
            </div>

            {/* Status legend (fixed at bottom) */}
            <div className="px-3 py-2 border-t border-surface-800">
              <StatusLegend />
            </div>
          </div>
        </ResizablePanel>
      )}

      {/* Content Pane Container */}
      <ContentPaneContainer />

      {/* Build mode indicator (always visible, uses absolute positioning) */}
      <BuildModeIndicator />
    </div>
  );
}
```

---

## State Persistence Pattern

All UI state follows the established `~/.mort/` disk persistence pattern with proper separation of concerns:

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Data Flow                                        │
│                                                                              │
│   Component                  Service                  Store                  │
│   ─────────                  ───────                  ─────                  │
│                                                                              │
│   onClick() ─────────────> setActivePaneView() ───> _applySetView()         │
│                                   │                       │                  │
│                                   │                       ▼                  │
│                                   │              Zustand state update        │
│                                   │                       │                  │
│                                   ▼                       │                  │
│                            persist() ◄────────────────────┘                  │
│                                   │                                          │
│                                   ▼                                          │
│                        persistence.writeJson()                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Components never write to stores directly** - They call service methods
2. **Services handle disk I/O** - Read/validate/write with Zod
3. **Stores expose `_apply*` methods** - Internal methods for state updates
4. **Listeners handle events** - React to entity changes (e.g., deletions)

### Persistence Flow

1. **Startup:** Services call `hydrate()` which reads disk, validates with Zod, updates store
2. **User Action:** Component calls service method
3. **Service:** Updates store via `_apply*` method, then persists to disk
4. **Event:** Listener calls service to handle entity changes

### File Locations

| Store | Persistence Path |
|-------|-----------------|
| `contentPanesService` | `~/.mort/ui/content-panes.json` |
| `layoutService` | `~/.mort/ui/layout.json` |
| `useTreeMenuStore` | `~/.mort/ui/tree-menu.json` (from Phase 2) |

### Example Persisted State

**`~/.mort/ui/content-panes.json`:**
```json
{
  "panes": {
    "abc-123-uuid": {
      "id": "abc-123-uuid",
      "view": { "type": "thread", "threadId": "thread-456" }
    }
  },
  "activePaneId": "abc-123-uuid"
}
```

**`~/.mort/ui/layout.json`:**
```json
{
  "treePanelWidth": 280,
  "treePanelVisible": true
}
```

---

## Wiring Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MainWindowLayout                                                         │
│                                                                          │
│   useEffect (mount)                                                      │
│   └─> setupContentPanesListeners() (once)                               │
│   └─> hydrate all stores (independent, error-isolated)                  │
│                                                                          │
│   ┌───────────────────────┬──────────────────────────────────────────┐  │
│   │ ResizablePanel        │ ContentPaneContainer                     │  │
│   │ (treePanelVisible)    │                                          │  │
│   │ position="left"       │   useActivePaneView()                    │  │
│   │ persistKey="tree-..." │   useContentPanesHydrated()              │  │
│   │                       │   useLayoutHydrated()                    │  │
│   │ ┌───────────────────┐ │   └─> renders based on view.type         │  │
│   │ │ TreePanelHeader   │ │       ├─> empty: EmptyInboxState         │  │
│   │ │                   │ │       ├─> thread: ThreadContent          │  │
│   │ │ [Settings] ───────┼─┼──> contentPanesService.setActivePaneView│  │
│   │ │ [Logs]    ───────┼─┼──> contentPanesService.setActivePaneView │  │
│   │ │ [Terminal]────────┼─┼──> contentPanesService.setActivePaneView│  │
│   │ │ [New ▾]           │ │       └─> plan: PlanContent              │  │
│   │ └───────────────────┘ │                                          │  │
│   │                       │                                          │  │
│   │ ┌───────────────────┐ │                                          │  │
│   │ │ TreeMenu          │ │                                          │  │
│   │ │                   │ │                                          │  │
│   │ │ onItemSelect ─────┼─┼──> handleTreeItemSelect(itemType, itemId)│  │
│   │ │ (itemType, itemId)│ │    └─> contentPanesService.setActive...  │  │
│   │ └───────────────────┘ │                                          │  │
│   │                       │                                          │  │
│   │ ┌───────────────────┐ │                                          │  │
│   │ │ StatusLegend      │ │                                          │  │
│   │ └───────────────────┘ │                                          │  │
│   └───────────────────────┴──────────────────────────────────────────┘  │
│                                                                          │
│   onClose ──> layoutService.setTreePanelVisible(false)                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Services & Stores                                                        │
│                                                                          │
│   contentPanesService               layoutService                        │
│   ├─ hydrate()                      ├─ hydrate()                        │
│   ├─ createPane()                   ├─ setTreePanelWidth() [debounced]  │
│   ├─ closePane()                    ├─ setTreePanelVisible()            │
│   ├─ setPaneView()                  ├─ toggleTreePanel()                │
│   ├─ setActivePaneView()            └─ persist()                        │
│   ├─ handleEntityDeleted()                                              │
│   └─ persist()                                                          │
│                                                                          │
│   useContentPanesStore              useLayoutStore                       │
│   ├─ panes: Record<UUID, Pane>      ├─ treePanelWidth                   │
│   ├─ activePaneId                   ├─ treePanelVisible                 │
│   ├─ _hydrated                      ├─ _hydrated                        │
│   ├─ _applyHydrate()                ├─ _applyHydrate()                  │
│   ├─ _applyCreate()                 ├─ _applySetWidth()                 │
│   ├─ _applyDelete()                 └─ _applySetVisible()               │
│   ├─ _applySetView()                                                    │
│   └─ _applySetActive()                                                  │
│                                                                          │
│   Persistence: ~/.mort/ui/content-panes.json                            │
│   Persistence: ~/.mort/ui/layout.json                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Event Listeners (setupContentPanesListeners)                             │
│                                                                          │
│   THREAD_ARCHIVED ──> contentPanesService.handleEntityDeleted("thread") │
│   PLAN_ARCHIVED   ──> contentPanesService.handleEntityDeleted("plan")   │
│                                                                          │
│   handleEntityDeleted():                                                 │
│   └─> For each pane showing deleted entity:                             │
│       └─> _applySetView(paneId, { type: "empty" })                      │
│       └─> persist()                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Edge Cases to Handle

### Empty State
- When app launches with no threads/plans: Show `EmptyInboxState` (onboarding guide)
- When active pane has `{ type: "empty" }`: Show onboarding guide
- When active pane references deleted thread/plan: Listener resets to empty via service

### Panel Resize
- **Debounced persistence**: 200ms debounce prevents excessive disk writes during drag
- **Snap to close**: Below 100px threshold, panel hides
- **Clamp to bounds**: Width constrained to min (180px) and max (400px)
- Service handles all persistence logic

### First Launch
- No `~/.mort/ui/` files exist
- Service creates default pane with `{ type: "empty" }`
- Default panel width (280px) used from constants
- Initial state written to disk after hydration

### Store Initialization
- Each store hydrates independently via `Promise.allSettled`
- Failure in one store doesn't block others
- Each store sets `_hydrated: true` even on error (with defaults)
- Listeners registered before hydration to catch any events during startup

### Navigation Events
- Ignore deprecated targets ("inbox", "worktrees")
- Log warning for unknown targets
- Handle "settings" and "logs" from native menu via service

### Entity Deletion Detection
- Listeners subscribe to `THREAD_ARCHIVED` and `PLAN_ARCHIVED` events
- Service iterates all panes to find those showing deleted entity
- Affected panes reset to `{ type: "empty" }`
- Changes persisted to disk

---

## Acceptance Criteria

- [ ] **Content panes store follows Entity Stores pattern**
  - Separate types.ts, store.ts, service.ts, listeners.ts files
  - Store only has `_apply*` methods
  - Service handles all disk I/O
  - Zod validation on disk reads

- [ ] **Content panes persist to `~/.mort/ui/content-panes.json`**
  - Pane state survives app restart
  - Active pane ID is restored
  - Invalid activePaneId references are corrected on load

- [ ] **Layout store follows Entity Stores pattern**
  - Separate types.ts, store.ts, service.ts files
  - Debounced persistence for resize operations
  - Zod validation on disk reads

- [ ] **Layout persists to `~/.mort/ui/layout.json`**
  - Panel width survives app restart
  - Panel visibility survives app restart

- [ ] **TreePanelHeader displays all icon buttons**
  - Settings icon opens settings via service
  - Logs icon opens logs via service
  - Terminal icon creates terminal pane (placeholder)
  - New dropdown shows thread/worktree options

- [ ] **Tree selection uses correct Phase 3 signature**
  - `onItemSelect(itemType: "thread" | "plan", itemId: string)`
  - Calls service to update content pane

- [ ] **Entity deletion resets affected panes**
  - THREAD_ARCHIVED event triggers check
  - PLAN_ARCHIVED event triggers check
  - Panes showing deleted entity reset to empty

- [ ] **Empty state shows onboarding guide**
  - On first launch
  - When no item is selected
  - When viewed entity is deleted
  - Reuses existing `EmptyInboxState` component

- [ ] **Panel resize works correctly**
  - Smooth drag resize
  - Snaps to close below ~100px
  - Respects min/max constraints
  - Width persists with 200ms debounce

- [ ] **Store initialization is robust**
  - Each store hydrates independently
  - Failures logged but don't block other stores
  - `_hydrated` flags set consistently

- [ ] **Navigation events work**
  - Native menu "Settings" opens settings pane
  - Native menu "Logs" opens logs pane
  - Deprecated menu items ignored with warning

- [ ] **No regressions**
  - BuildModeIndicator still visible
  - Existing thread/plan views render correctly
  - Settings and Logs pages work as before

---

## Testing Notes

### Manual Testing Checklist

1. **Fresh install test:**
   - Delete `~/.mort/ui/` directory
   - Launch app
   - Verify default pane created
   - Verify onboarding guide shown
   - Verify `~/.mort/ui/content-panes.json` created

2. **Persistence test:**
   - Select a thread
   - Resize panel
   - Quit and relaunch
   - Verify same thread selected
   - Verify panel width preserved

3. **Tree navigation test:**
   - Click thread in tree
   - Verify content pane updates
   - Click plan in tree
   - Verify content pane updates
   - Click Settings icon
   - Verify settings shown

4. **Panel resize test:**
   - Drag panel edge to resize
   - Verify smooth resize
   - Verify no excessive disk writes (check console)
   - Drag below 100px
   - Verify panel hides
   - Verify persisted after restart

5. **Native menu test:**
   - Use View > Settings menu item
   - Verify settings pane opens
   - Use View > Logs menu item
   - Verify logs pane opens

6. **Entity deletion test:**
   - Select a thread in content pane
   - Archive that thread (via quick actions or other means)
   - Verify content pane resets to empty state
   - Same test for plans

7. **Corrupted state recovery:**
   - Manually corrupt `~/.mort/ui/content-panes.json`
   - Launch app
   - Verify default pane created (graceful recovery)
   - Check console for Zod validation errors logged

---

## Dependencies on Previous Phases

This phase assumes the following components exist from earlier phases:

### From Phase 1
- `ResizablePanel` component with `position`, `persistKey`, `onClose` props
- `ThreadContent` component (extracted from control panel)
- `PlanContent` component (extracted from control panel)
- `ContentPaneView` type in `src/components/content-pane/types.ts`

### From Phase 2
- `useTreeMenuStore` with expansion state and selection
- Tree data types (`TreeNode`, `RepoWorktreeSection`, etc.)
- `useTreeData` hook for entity-to-tree mapping
- Optional `hydrate()` method on tree menu store

### From Phase 3
- `TreeMenu` component with `onItemSelect(itemType, itemId)` signature
- `RepoWorktreeSection` component
- `ThreadItem` and `PlanItem` components

---

## Files Modified/Created Summary

| File | Action | Description |
|------|--------|-------------|
| `src/stores/content-panes/types.ts` | CREATE | Types + Zod schemas |
| `src/stores/content-panes/store.ts` | CREATE | Zustand store with _apply* methods |
| `src/stores/content-panes/service.ts` | CREATE | Disk I/O + business logic |
| `src/stores/content-panes/listeners.ts` | CREATE | Event subscriptions |
| `src/stores/content-panes/index.ts` | CREATE | Barrel export |
| `src/stores/layout/types.ts` | CREATE | Types + Zod schemas |
| `src/stores/layout/store.ts` | CREATE | Zustand store with _apply* methods |
| `src/stores/layout/service.ts` | CREATE | Disk I/O with debounce |
| `src/stores/layout/index.ts` | CREATE | Barrel export |
| `src/components/tree-menu/tree-panel-header.tsx` | CREATE | Header with icon buttons |
| `src/components/content-pane/content-pane-container.tsx` | CREATE | Pane rendering container |
| `src/components/main-window/main-window-layout.tsx` | REWRITE | Complete layout overhaul |

---

## Next Phase

After Phase 4 is complete, proceed to **Phase 5: Deprecation & Cleanup** which will:
- Remove `unified-inbox.tsx` and related inbox components
- Remove `worktrees-page.tsx` (full page)
- Remove old `sidebar.tsx`
- Clean up unused types and imports
