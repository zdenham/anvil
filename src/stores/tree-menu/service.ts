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
