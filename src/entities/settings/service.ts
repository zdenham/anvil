import { optimistic } from "@/lib/optimistic";
import { persistence } from "@/lib/persistence";
import { useSettingsStore } from "./store";
import type { WorkspaceSettings } from "./types";
import { DEFAULT_WORKSPACE_SETTINGS, WorkspaceSettingsSchema } from "./types";

const SETTINGS_FILE = "settings.json";

export const settingsService = {
  /**
   * Hydrates the settings store from disk.
   * Should be called once at app initialization.
   */
  async hydrate(): Promise<void> {
    const raw = await persistence.readJson(SETTINGS_FILE);
    const result = raw ? WorkspaceSettingsSchema.safeParse(raw) : null;
    const settings = result?.success ? result.data : DEFAULT_WORKSPACE_SETTINGS;
    useSettingsStore.getState().hydrate(settings);
  },

  /**
   * Gets the current workspace settings.
   */
  get(): WorkspaceSettings {
    return useSettingsStore.getState().workspace;
  },

  /**
   * Sets a single setting value.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   */
  async set<K extends keyof WorkspaceSettings>(
    key: K,
    value: WorkspaceSettings[K]
  ): Promise<void> {
    const current = useSettingsStore.getState().workspace;
    const updated: WorkspaceSettings = { ...current, [key]: value };

    await optimistic(
      updated,
      (settings) => useSettingsStore.getState()._applyUpdate(settings),
      (settings) => persistence.writeJson(SETTINGS_FILE, settings)
    );
  },

  /**
   * Sets multiple settings at once.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   */
  async setMany(updates: Partial<WorkspaceSettings>): Promise<void> {
    const current = useSettingsStore.getState().workspace;
    const updated: WorkspaceSettings = { ...current, ...updates };

    await optimistic(
      updated,
      (settings) => useSettingsStore.getState()._applyUpdate(settings),
      (settings) => persistence.writeJson(SETTINGS_FILE, settings)
    );
  },

  /**
   * Resets settings to defaults.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   */
  async reset(): Promise<void> {
    await optimistic(
      DEFAULT_WORKSPACE_SETTINGS,
      (settings) => useSettingsStore.getState()._applyUpdate(settings),
      (settings) => persistence.writeJson(SETTINGS_FILE, settings)
    );
  },
};
