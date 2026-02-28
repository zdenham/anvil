import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { useDebugPanelStore } from "./store";
import { DebugPanelPersistedStateSchema, type DebugPanelTab, type DebugPanelPersistedState } from "./types";

const UI_STATE_PATH = "ui/debug-panel.json";

let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 300;

function getPersistedState(): DebugPanelPersistedState {
  const { activeTab, panelHeight } = useDebugPanelStore.getState();
  return { activeTab, panelHeight };
}

function persistDebounced(): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(async () => {
    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, getPersistedState());
      logger.debug("[debugPanelService] Persisted state");
    } catch (err) {
      logger.error("[debugPanelService] Failed to persist:", err);
    }
    persistDebounceTimer = null;
  }, PERSIST_DEBOUNCE_MS);
}

export const debugPanelService = {
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
      if (raw) {
        const result = DebugPanelPersistedStateSchema.safeParse(raw);
        if (result.success) {
          useDebugPanelStore.getState().hydrate(result.data);
          logger.debug("[debugPanelService] Hydrated from disk");
          return;
        }
        logger.warn("[debugPanelService] Invalid persisted state, using defaults:", result.error);
      }
      useDebugPanelStore.getState().hydrate({ activeTab: "logs", panelHeight: 300 });
    } catch (err) {
      logger.error("[debugPanelService] Failed to hydrate:", err);
      useDebugPanelStore.getState().hydrate({ activeTab: "logs", panelHeight: 300 });
    }
  },

  toggle(): void {
    useDebugPanelStore.getState()._applyToggle();
  },

  open(tab?: DebugPanelTab): void {
    useDebugPanelStore.getState()._applyOpen(tab);
    if (tab) persistDebounced();
  },

  close(): void {
    useDebugPanelStore.getState()._applyClose();
  },

  setActiveTab(tab: DebugPanelTab): void {
    useDebugPanelStore.getState()._applySetActiveTab(tab);
    persistDebounced();
  },

  setPanelHeight(height: number): void {
    useDebugPanelStore.getState()._applySetPanelHeight(height);
    persistDebounced();
  },
};
