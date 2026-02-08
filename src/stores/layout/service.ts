import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { useLayoutStore } from "./store";
import { LayoutPersistedStateSchema, type LayoutPersistedState } from "./types";

const UI_STATE_PATH = "ui/layout.json";

// Debounce timer for width persistence
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 300;

/**
 * Helper to get persisted state from store.
 */
function getPersistedState(): LayoutPersistedState {
  const { panelWidths } = useLayoutStore.getState();
  return { panelWidths };
}

export const layoutService = {
  /**
   * Hydrates the layout store from disk.
   * Should be called once at app initialization.
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
      if (raw) {
        const result = LayoutPersistedStateSchema.safeParse(raw);
        if (result.success) {
          useLayoutStore.getState().hydrate(result.data);
          logger.debug("[layoutService] Hydrated from disk");
          return;
        }
        logger.warn("[layoutService] Invalid persisted state, using defaults:", result.error);
      }

      // No data or invalid - use empty defaults
      useLayoutStore.getState().hydrate({ panelWidths: {} });
      logger.debug("[layoutService] No persisted state found, using defaults");
    } catch (err) {
      logger.error("[layoutService] Failed to hydrate:", err);
      useLayoutStore.getState().hydrate({ panelWidths: {} });
    }
  },

  /**
   * Sets a panel width with debounced appData.
   * Updates store immediately, persists after debounce delay.
   */
  async setPanelWidth(key: string, width: number): Promise<void> {
    // Update store immediately (optimistic)
    useLayoutStore.getState()._applySetPanelWidth(key, width);

    // Debounce disk write
    if (persistDebounceTimer) {
      clearTimeout(persistDebounceTimer);
    }

    persistDebounceTimer = setTimeout(async () => {
      try {
        await appData.ensureDir("ui");
        await appData.writeJson(UI_STATE_PATH, getPersistedState());
        logger.debug(`[layoutService] Persisted panel width ${key}=${width}`);
      } catch (err) {
        logger.error("[layoutService] Failed to persist panel width:", err);
      }
      persistDebounceTimer = null;
    }, PERSIST_DEBOUNCE_MS);
  },

  /**
   * Gets a panel width from the store.
   * Returns defaultWidth if not set.
   */
  getPanelWidth(key: string, defaultWidth: number): number {
    const { panelWidths } = useLayoutStore.getState();
    return panelWidths[key] ?? defaultWidth;
  },

  /**
   * Refreshes the store from disk.
   * Used when cross-window sync events arrive.
   */
  async refreshFromDisk(): Promise<void> {
    await this.hydrate();
  },
};
