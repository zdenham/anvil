import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { useContentPanesStore } from "./store";
import { ContentPanesPersistedStateSchema, type ContentPanesPersistedState, type ContentPaneData } from "./types";
import type { ContentPaneView } from "@/components/content-pane/types";

const UI_STATE_PATH = "ui/content-panes.json";

// Default pane ID for single-pane mode
const DEFAULT_PANE_ID = "main";

/**
 * Helper to get persisted state from store.
 */
function getPersistedState(): ContentPanesPersistedState {
  const { panes, activePaneId } = useContentPanesStore.getState();
  return { panes, activePaneId };
}

/**
 * Persist current state to disk.
 */
async function persistState(): Promise<void> {
  const state = getPersistedState();
  await appData.ensureDir("ui");
  await appData.writeJson(UI_STATE_PATH, state);
}

export const contentPanesService = {
  /**
   * Hydrates the content panes store from disk.
   * Should be called once at app initialization.
   * Creates a default pane if none exist.
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
      if (raw) {
        const result = ContentPanesPersistedStateSchema.safeParse(raw);
        if (result.success) {
          useContentPanesStore.getState().hydrate(result.data);
          logger.debug("[contentPanesService] Hydrated from disk");
          return;
        }
        logger.warn("[contentPanesService] Invalid persisted state, using defaults:", result.error);
      }

      // No data or invalid - create default pane
      const defaultState: ContentPanesPersistedState = {
        panes: {
          [DEFAULT_PANE_ID]: {
            id: DEFAULT_PANE_ID,
            view: { type: "empty" },
          },
        },
        activePaneId: DEFAULT_PANE_ID,
      };
      useContentPanesStore.getState().hydrate(defaultState);
      await persistState();
      logger.debug("[contentPanesService] Created default pane");
    } catch (err) {
      logger.error("[contentPanesService] Failed to hydrate:", err);
      // Fallback to default state
      const defaultState: ContentPanesPersistedState = {
        panes: {
          [DEFAULT_PANE_ID]: {
            id: DEFAULT_PANE_ID,
            view: { type: "empty" },
          },
        },
        activePaneId: DEFAULT_PANE_ID,
      };
      useContentPanesStore.getState().hydrate(defaultState);
    }
  },

  /**
   * Creates a new pane.
   * Returns the new pane ID.
   */
  async createPane(view: ContentPaneView = { type: "empty" }): Promise<string> {
    const paneId = crypto.randomUUID();
    const pane: ContentPaneData = { id: paneId, view };

    try {
      await appData.ensureDir("ui");
      const state = getPersistedState();
      state.panes[paneId] = pane;
      await appData.writeJson(UI_STATE_PATH, state);
      useContentPanesStore.getState()._applyCreatePane(pane);
      logger.debug(`[contentPanesService] Created pane ${paneId}`);
      return paneId;
    } catch (err) {
      logger.error("[contentPanesService] Failed to create pane:", err);
      throw err;
    }
  },

  /**
   * Closes a pane.
   */
  async closePane(paneId: string): Promise<void> {
    const store = useContentPanesStore.getState();
    if (!store.panes[paneId]) return;

    // Don't allow closing the last pane - reset to empty instead
    const paneCount = Object.keys(store.panes).length;
    if (paneCount === 1) {
      await this.setPaneView(paneId, { type: "empty" });
      return;
    }

    try {
      const state = getPersistedState();
      delete state.panes[paneId];
      if (state.activePaneId === paneId) {
        // Set active to first remaining pane
        state.activePaneId = Object.keys(state.panes)[0] ?? null;
      }
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, state);
      store._applyClosePane(paneId);
      logger.debug(`[contentPanesService] Closed pane ${paneId}`);
    } catch (err) {
      logger.error("[contentPanesService] Failed to close pane:", err);
      throw err;
    }
  },

  /**
   * Sets the view for a pane.
   */
  async setPaneView(paneId: string, view: ContentPaneView): Promise<void> {
    const store = useContentPanesStore.getState();
    if (!store.panes[paneId]) {
      logger.warn(`[contentPanesService] Pane ${paneId} not found`);
      return;
    }

    try {
      const state = getPersistedState();
      state.panes[paneId] = { ...state.panes[paneId], view };
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, state);
      store._applySetPaneView(paneId, view);
    } catch (err) {
      logger.error("[contentPanesService] Failed to set pane view:", err);
      throw err;
    }
  },

  /**
   * Sets the active pane.
   */
  async setActivePane(paneId: string | null): Promise<void> {
    const store = useContentPanesStore.getState();
    if (paneId && !store.panes[paneId]) {
      logger.warn(`[contentPanesService] Pane ${paneId} not found`);
      return;
    }

    if (store.activePaneId === paneId) return;

    try {
      const state = getPersistedState();
      state.activePaneId = paneId;
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, state);
      store._applySetActivePane(paneId);
      logger.debug(`[contentPanesService] Set active pane to ${paneId}`);
    } catch (err) {
      logger.error("[contentPanesService] Failed to set active pane:", err);
      throw err;
    }
  },

  /**
   * Sets the view for the active pane.
   * Convenience method that finds the active pane and sets its view.
   */
  async setActivePaneView(view: ContentPaneView): Promise<void> {
    const store = useContentPanesStore.getState();
    let activePaneId = store.activePaneId;

    // If no active pane, use the first one or create a default
    if (!activePaneId) {
      const paneIds = Object.keys(store.panes);
      if (paneIds.length > 0) {
        activePaneId = paneIds[0];
        await this.setActivePane(activePaneId);
      } else {
        activePaneId = await this.createPane(view);
        await this.setActivePane(activePaneId);
        return; // View already set in createPane
      }
    }

    await this.setPaneView(activePaneId, view);
  },

  /**
   * Gets the active pane's view.
   */
  getActivePaneView(): ContentPaneView | null {
    const store = useContentPanesStore.getState();
    if (!store.activePaneId) return null;
    return store.panes[store.activePaneId]?.view ?? null;
  },

  /**
   * Refreshes the store from disk.
   * Used when cross-window sync events arrive.
   */
  async refreshFromDisk(): Promise<void> {
    await this.hydrate();
  },

  /**
   * Clears the active pane (sets view to empty).
   */
  async clearActivePane(): Promise<void> {
    await this.setActivePaneView({ type: "empty" });
  },
};
