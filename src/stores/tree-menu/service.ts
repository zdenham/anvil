import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { useTreeMenuStore } from "./store";
import { TreeMenuPersistedStateSchema, type TreeMenuPersistedState } from "./types";

const UI_STATE_PATH = "ui/tree-menu.json";

/**
 * Helper to get persisted state from store.
 */
function getPersistedState(): TreeMenuPersistedState {
  const { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds };
}

export const treeMenuService = {
  /**
   * Hydrates the tree menu store from disk.
   * Should be called once at app initialization.
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
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
        pinnedSectionId: null,
        hiddenSectionIds: [],
      });
      logger.debug("[treeMenuService] No persisted state found, using defaults");
    } catch (err) {
      logger.error("[treeMenuService] Failed to hydrate:", err);
      useTreeMenuStore.getState().hydrate({
        expandedSections: {},
        selectedItemId: null,
        pinnedSectionId: null,
        hiddenSectionIds: [],
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
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
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
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
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
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
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
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
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

  /**
   * Pins a section (shows only that section).
   * Pass null to unpin.
   */
  async pinSection(sectionId: string | null): Promise<void> {
    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      pinnedSectionId: sectionId,
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetPinned(sectionId);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist pin:", err);
      throw err;
    }
  },

  /**
   * Toggles pin state for a section.
   * If already pinned, unpins; otherwise pins.
   */
  async togglePinSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().pinnedSectionId;
    const newPinned = current === sectionId ? null : sectionId;
    await this.pinSection(newPinned);
  },

  /**
   * Hides a section.
   */
  async hideSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().hiddenSectionIds;
    if (current.includes(sectionId)) return; // Already hidden

    // If this section is pinned, clear the pin first
    const pinnedId = useTreeMenuStore.getState().pinnedSectionId;
    const newPinned = pinnedId === sectionId ? null : pinnedId;

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      pinnedSectionId: newPinned,
      hiddenSectionIds: [...current, sectionId],
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      if (newPinned !== pinnedId) {
        useTreeMenuStore.getState()._applySetPinned(newPinned);
      }
      useTreeMenuStore.getState()._applySetHidden(sectionId, true);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist hide:", err);
      throw err;
    }
  },

  /**
   * Unhides a section.
   */
  async unhideSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().hiddenSectionIds;
    if (!current.includes(sectionId)) return; // Not hidden

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      hiddenSectionIds: current.filter((id) => id !== sectionId),
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetHidden(sectionId, false);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist unhide:", err);
      throw err;
    }
  },

  /**
   * Unhides all sections and clears pin.
   */
  async unhideAll(): Promise<void> {
    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      pinnedSectionId: null,
      hiddenSectionIds: [],
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applyUnhideAll();
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist unhide all:", err);
      throw err;
    }
  },

  /**
   * Gets the count of hidden sections.
   */
  getHiddenCount(): number {
    return useTreeMenuStore.getState().hiddenSectionIds.length;
  },

  /**
   * Checks if any sections are hidden or pinned (for showing "Show all" menu item).
   */
  hasHiddenOrPinned(): boolean {
    const state = useTreeMenuStore.getState();
    return state.hiddenSectionIds.length > 0 || state.pinnedSectionId !== null;
  },
};
