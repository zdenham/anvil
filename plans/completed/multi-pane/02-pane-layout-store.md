# Pane Layout Store

## Overview

Create the Zustand store and service for managing the pane layout tree. Follows the existing service + store pattern used throughout the codebase.

**Dependencies**: 01-data-model.md
**Parallel with**: None

---

## Implementation

### 1. Store Definition

**`src/stores/pane-layout/store.ts`**

```typescript
import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { PaneLayout, PaneLayoutPersistedState } from "./types";
import { createDefaultLayout } from "./defaults";

// ═══════════════════════════════════════════════════════════════════════════
// State Interface
// ═══════════════════════════════════════════════════════════════════════════

interface PaneLayoutState {
  /** The layout tree */
  layout: PaneLayout;
  /** Currently focused pane ID */
  activePaneId: string | null;
  /** Whether store has been hydrated from disk */
  _hydrated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions Interface
// ═══════════════════════════════════════════════════════════════════════════

interface PaneLayoutActions {
  /** Hydration (called by service after disk read + validation) */
  hydrate: (state: PaneLayoutPersistedState) => void;

  /** Optimistic apply methods - called by service after disk write */
  _applySetLayout: (layout: PaneLayout) => Rollback;
  _applySetActivePane: (paneId: string | null) => Rollback;
  _applyUpdateLayout: (layout: PaneLayout, activePaneId?: string | null) => Rollback;
}

// ═══════════════════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════════════════

export const usePaneLayoutStore = create<PaneLayoutState & PaneLayoutActions>(
  (set, get) => ({
    // ═══════════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════════
    layout: createDefaultLayout(),
    activePaneId: null,
    _hydrated: false,

    // ═══════════════════════════════════════════════════════════════════════════
    // Hydration
    // ═══════════════════════════════════════════════════════════════════════════
    hydrate: (state: PaneLayoutPersistedState) => {
      set({
        layout: state.layout,
        activePaneId: state.activePaneId,
        _hydrated: true,
      });
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Optimistic Apply Methods
    // ═══════════════════════════════════════════════════════════════════════════

    _applySetLayout: (layout: PaneLayout): Rollback => {
      const prev = get().layout;
      set({ layout });
      return () => set({ layout: prev });
    },

    _applySetActivePane: (paneId: string | null): Rollback => {
      const prev = get().activePaneId;
      set({ activePaneId: paneId });
      return () => set({ activePaneId: prev });
    },

    _applyUpdateLayout: (layout: PaneLayout, activePaneId?: string | null): Rollback => {
      const prevLayout = get().layout;
      const prevActivePaneId = get().activePaneId;

      const update: Partial<PaneLayoutState> = { layout };
      if (activePaneId !== undefined) {
        update.activePaneId = activePaneId;
      }

      set(update);

      return () =>
        set({
          layout: prevLayout,
          activePaneId: prevActivePaneId,
        });
    },
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current layout state (non-reactive, for use outside React).
 */
export function getPaneLayoutState(): Pick<PaneLayoutState, "layout" | "activePaneId"> {
  const { layout, activePaneId } = usePaneLayoutStore.getState();
  return { layout, activePaneId };
}

/**
 * Check if the store has been hydrated.
 */
export function isPaneLayoutHydrated(): boolean {
  return usePaneLayoutStore.getState()._hydrated;
}
```

### 2. Service Definition

**`src/stores/pane-layout/service.ts`**

```typescript
import { persistence } from "@/lib/persistence";
import { logger } from "@/lib/logger-client";
import { usePaneLayoutStore } from "./store";
import {
  PaneLayoutPersistedStateSchema,
  type PaneLayout,
  type PaneLayoutPersistedState,
} from "./types";
import {
  createDefaultLayout,
  createSinglePaneLayout,
} from "./defaults";
import {
  splitPane,
  removePane,
  updateSplitSizes,
  findPane,
  getAllPaneIds,
  getFirstPaneId,
  normalizeSizes,
} from "./tree-utils";
import type { SplitPaneOptions, LayoutPath } from "@/components/pane-layout/types";
import { contentPanesService } from "@/stores/content-panes/service";
import type { ContentPaneView } from "@/components/content-pane/types";

const PANE_LAYOUT_PATH = "ui/pane-layout.json";

/**
 * Pane Layout Service
 *
 * Manages the pane layout tree with disk persistence.
 * Follows the "disk as source of truth" pattern.
 */
class PaneLayoutService {
  private store = usePaneLayoutStore;

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load layout from disk and hydrate store.
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await persistence.readJson(PANE_LAYOUT_PATH);
      const result = PaneLayoutPersistedStateSchema.safeParse(raw);

      if (result.success) {
        this.store.getState().hydrate(result.data);
        logger.debug("[PaneLayoutService] Hydrated from disk");
      } else {
        // Invalid schema - use default and save
        logger.warn("[PaneLayoutService] Invalid schema, using default layout");
        await this.resetToDefault();
      }
    } catch (error) {
      // File doesn't exist or read error - use default
      logger.debug("[PaneLayoutService] No layout file, using default");
      await this.resetToDefault();
    }
  }

  /**
   * Reset to default single-pane layout.
   */
  async resetToDefault(): Promise<void> {
    const defaultState: PaneLayoutPersistedState = {
      layout: createDefaultLayout(),
      activePaneId: "main",
    };

    await this.persistState(defaultState);
    this.store.getState().hydrate(defaultState);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Layout Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Split an existing pane, creating a new pane beside it.
   */
  async splitPane(options: SplitPaneOptions): Promise<void> {
    const state = this.store.getState();
    const currentLayout = state.layout;

    // Create the new pane in content-panes store
    await contentPanesService.createPane(options.newPaneId, { type: "empty" });

    // Update layout tree
    const newLayout = splitPane(currentLayout, options);

    // Persist and update store
    await this.persistLayout(newLayout, options.newPaneId);
    this.store.getState()._applyUpdateLayout(newLayout, options.newPaneId);

    logger.info(`[PaneLayoutService] Split pane ${options.paneId} -> ${options.newPaneId}`);
  }

  /**
   * Split the active pane with a new view.
   * Convenience method for common use case.
   */
  async splitActivePane(
    direction: "horizontal" | "vertical",
    view: ContentPaneView
  ): Promise<string> {
    const state = this.store.getState();
    const activePaneId = state.activePaneId;

    if (!activePaneId) {
      throw new Error("No active pane to split");
    }

    const newPaneId = crypto.randomUUID();

    await this.splitPane({
      paneId: activePaneId,
      direction,
      position: "after",
      newPaneId,
      ratio: 0.5,
    });

    // Set the view for the new pane
    await contentPanesService.setPaneView(newPaneId, view);

    return newPaneId;
  }

  /**
   * Close a pane. If it's the last pane, reset to empty view.
   */
  async closePane(paneId: string): Promise<void> {
    const state = this.store.getState();
    const currentLayout = state.layout;

    const newLayout = removePane(currentLayout, paneId);

    if (!newLayout) {
      // Was the last pane - reset to single empty pane
      logger.info(`[PaneLayoutService] Last pane closed, resetting to default`);
      await this.resetToDefault();
      await contentPanesService.setPaneView("main", { type: "empty" });
      return;
    }

    // Close the pane in content-panes store
    await contentPanesService.closePane(paneId);

    // Determine new active pane if needed
    let newActivePaneId = state.activePaneId;
    if (newActivePaneId === paneId) {
      newActivePaneId = getFirstPaneId(newLayout);
    }

    // Persist and update store
    await this.persistLayout(newLayout, newActivePaneId);
    this.store.getState()._applyUpdateLayout(newLayout, newActivePaneId);

    logger.info(`[PaneLayoutService] Closed pane ${paneId}`);
  }

  /**
   * Update sizes for a split at the given path.
   */
  async updateSizes(path: LayoutPath, sizes: number[]): Promise<void> {
    const state = this.store.getState();
    const normalizedSizes = normalizeSizes(sizes);
    const newLayout = updateSplitSizes(state.layout, path, normalizedSizes);

    await this.persistLayout(newLayout, state.activePaneId);
    this.store.getState()._applySetLayout(newLayout);
  }

  /**
   * Set the active pane.
   */
  async setActivePane(paneId: string): Promise<void> {
    const state = this.store.getState();

    // Verify pane exists in layout
    if (!findPane(state.layout, paneId)) {
      logger.warn(`[PaneLayoutService] Pane ${paneId} not in layout`);
      return;
    }

    await this.persistState({
      layout: state.layout,
      activePaneId: paneId,
    });
    this.store.getState()._applySetActivePane(paneId);
  }

  /**
   * Set the entire layout (used for drag-drop reordering).
   */
  async setLayout(layout: PaneLayout): Promise<void> {
    const state = this.store.getState();

    // Ensure active pane is still valid
    let activePaneId = state.activePaneId;
    if (activePaneId && !findPane(layout, activePaneId)) {
      activePaneId = getFirstPaneId(layout);
    }

    await this.persistLayout(layout, activePaneId);
    this.store.getState()._applyUpdateLayout(layout, activePaneId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current layout.
   */
  getLayout(): PaneLayout {
    return this.store.getState().layout;
  }

  /**
   * Get the active pane ID.
   */
  getActivePaneId(): string | null {
    return this.store.getState().activePaneId;
  }

  /**
   * Get all pane IDs in the layout.
   */
  getAllPaneIds(): string[] {
    return getAllPaneIds(this.store.getState().layout);
  }

  /**
   * Get the number of panes.
   */
  getPaneCount(): number {
    return this.getAllPaneIds().length;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Persistence Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async persistLayout(
    layout: PaneLayout,
    activePaneId: string | null
  ): Promise<void> {
    await this.persistState({ layout, activePaneId });
  }

  private async persistState(state: PaneLayoutPersistedState): Promise<void> {
    try {
      await persistence.writeJson(PANE_LAYOUT_PATH, state);
    } catch (error) {
      logger.error("[PaneLayoutService] Failed to persist:", error);
      throw error;
    }
  }
}

export const paneLayoutService = new PaneLayoutService();
```

### 3. Index Export

**`src/stores/pane-layout/index.ts`**

```typescript
export { usePaneLayoutStore, getPaneLayoutState, isPaneLayoutHydrated } from "./store";
export { paneLayoutService } from "./service";
export * from "./types";
export * from "./defaults";
export * from "./tree-utils";
```

### 4. Update MainWindowLayout Initialization

**Modify `src/components/main-window/main-window-layout.tsx`**

Add pane layout store hydration to the existing initialization:

```typescript
import { paneLayoutService } from "@/stores/pane-layout";

// In the initStores function:
async function initStores() {
  try {
    await Promise.allSettled([
      contentPanesService.hydrate(),
      paneLayoutService.hydrate(),  // ADD THIS
      treeMenuService.hydrate(),
      layoutService.hydrate(),
    ]);
    logger.debug("[MainWindowLayout] Stores initialized");
  } catch (err) {
    logger.error("[MainWindowLayout] Failed to initialize stores:", err);
  }
}
```

---

## Checklist

- [ ] Create `src/stores/pane-layout/store.ts` with Zustand store
- [ ] Create `src/stores/pane-layout/service.ts` with business logic
- [ ] Create `src/stores/pane-layout/index.ts` for exports
- [ ] Update `MainWindowLayout` to hydrate pane layout store
- [ ] Add unit tests for service operations (split, close, resize)
- [ ] Test persistence - layout survives app restart
- [ ] Test recovery - corrupted JSON falls back to default

---

## Testing Notes

Key scenarios:

1. **Fresh start** - No layout file, creates default single-pane
2. **Hydration** - Layout file exists, loads correctly
3. **Split** - Split creates new pane in content-panes store
4. **Close** - Close removes from layout and content-panes
5. **Close last** - Closing last pane resets to default
6. **Active pane tracking** - Active pane updates on close if needed
7. **Resize persistence** - Size changes persist to disk
