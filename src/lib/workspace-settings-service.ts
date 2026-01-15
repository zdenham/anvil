import {
  DEFAULT_WORKSPACE_SETTINGS,
  WorkspaceSettings,
  WorkspaceSettingsSchema,
} from "@/entities/settings/types";
import { FilesystemClient } from "./filesystem-client";
import { logger } from "./logger-client";
import { SettingsStoreClient } from "./settings-store-client";

const WORKSPACE_SETTINGS_KEY = "workspace";

// Re-export for consumers that import from this module
export type { WorkspaceSettings };
export { DEFAULT_WORKSPACE_SETTINGS };

// Singleton settings store client
let settingsClient: SettingsStoreClient | null = null;

/**
 * Gets or creates the singleton settings client
 */
function getSettingsClient(): SettingsStoreClient {
  if (!settingsClient) {
    const fs = new FilesystemClient();
    settingsClient = new SettingsStoreClient(fs);
  }
  return settingsClient;
}

/**
 * Fetches workspace settings from the .mort settings store.
 * Validates the data from disk and returns defaults if invalid.
 */
export const getWorkspaceSettings = async (): Promise<WorkspaceSettings> => {
  const client = getSettingsClient();
  await client.bootstrap();

  // Use unknown to force validation - don't trust the generic
  const raw = await client.get<unknown>(WORKSPACE_SETTINGS_KEY);

  if (raw === null) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  const result = WorkspaceSettingsSchema.safeParse(raw);
  if (!result.success) {
    // Log error with proper logger, return defaults for graceful degradation
    logger.error("Invalid workspace settings, using defaults:", result.error);
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  return result.data;
};

/**
 * Saves workspace settings to the .mort settings store
 */
export const saveWorkspaceSettings = async (
  settings: WorkspaceSettings
): Promise<void> => {
  const client = getSettingsClient();
  await client.bootstrap();
  await client.set(WORKSPACE_SETTINGS_KEY, settings);
};
