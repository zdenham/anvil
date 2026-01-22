import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger-client";
import type { ControlPanelViewType } from "@/entities/events";

/**
 * Registers a global hotkey with Tauri (temporary, not saved)
 * @param hotkey - The hotkey string from HotkeyRecorder (e.g., "Command+Space")
 */
export const registerGlobalHotkey = async (hotkey: string): Promise<void> => {
  logger.debug(`[hotkey-service] Registering hotkey: ${hotkey}`);
  try {
    await invoke("register_hotkey", { hotkey });
    logger.debug("[hotkey-service] Hotkey registered successfully");
  } catch (err) {
    logger.error("[hotkey-service] Failed to register hotkey:", err);
    throw err;
  }
};

/**
 * Saves the hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register
 */
export const saveHotkey = async (hotkey: string): Promise<void> => {
  logger.info(`[hotkey-service] saveHotkey called`, {
    hotkey,
    hotkeyLength: hotkey.length,
    hotkeyCharCodes: [...hotkey].map(c => c.charCodeAt(0)),
  });
  try {
    await invoke("save_hotkey", { hotkey });
    logger.info("[hotkey-service] saveHotkey completed successfully", { hotkey });
  } catch (err) {
    logger.error("[hotkey-service] saveHotkey failed:", { hotkey, error: err });
    throw err;
  }
};

/**
 * Gets the saved hotkey from backend config
 */
export const getSavedHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_hotkey");
};

/**
 * Saves the clipboard hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register
 */
export const saveClipboardHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_clipboard_hotkey", { hotkey });
};

/**
 * Gets the saved clipboard hotkey from backend config
 */
export const getSavedClipboardHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_clipboard_hotkey");
};


/**
 * Shows the spotlight window
 */
export const showSpotlight = async (): Promise<void> => {
  await invoke("show_spotlight");
};

/**
 * Hides the spotlight window
 */
export const hideSpotlight = async (): Promise<void> => {
  await invoke("hide_spotlight");
};

/**
 * Shows the main settings/onboarding window
 */
export const showMainWindow = async (): Promise<void> => {
  await invoke("show_main_window");
};

/**
 * Hides the main settings/onboarding window
 */
export const hideMainWindow = async (): Promise<void> => {
  await invoke("hide_main_window");
};

/**
 * Opens the control panel and displays a specific task.
 * If prompt is provided, shows optimistic UI with the prompt text before task loads.
 */
export const openControlPanel = async (
  threadId: string,
  taskId: string,
  prompt?: string,
): Promise<void> => {
  await invoke("open_control_panel", { threadId, taskId, prompt });
};

/**
 * Checks if the user has completed onboarding
 */
export const isOnboarded = async (): Promise<boolean> => {
  return invoke<boolean>("is_onboarded");
};

/**
 * Marks onboarding as complete
 */
export const completeOnboarding = async (): Promise<void> => {
  await invoke("complete_onboarding");
};


/**
 * Saves the control panel navigation down hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register (e.g., "Shift+Down", "Command+J")
 */
export const saveControlPanelNavigationDownHotkey = async (hotkey: string): Promise<void> => {
  logger.debug(`[hotkey-service] Saving control panel navigation down hotkey: "${hotkey}"`);
  try {
    await invoke("save_control_panel_navigation_down_hotkey", { hotkey });
    logger.debug("[hotkey-service] Control panel navigation down hotkey saved successfully");
  } catch (err) {
    logger.error("[hotkey-service] Failed to save control panel navigation down hotkey:", err);
    throw err;
  }
};

/**
 * Gets the saved control panel navigation down hotkey from backend config
 */
export const getSavedControlPanelNavigationDownHotkey = async (): Promise<string> => {
  const hotkey = await invoke<string>("get_saved_control_panel_navigation_down_hotkey");
  logger.debug(`[hotkey-service] Got saved control panel navigation down hotkey: "${hotkey}"`);
  return hotkey;
};

/**
 * Saves the control panel navigation up hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register (e.g., "Shift+Up", "Command+K")
 */
export const saveControlPanelNavigationUpHotkey = async (hotkey: string): Promise<void> => {
  logger.debug(`[hotkey-service] Saving control panel navigation up hotkey: "${hotkey}"`);
  try {
    await invoke("save_control_panel_navigation_up_hotkey", { hotkey });
    logger.debug("[hotkey-service] Control panel navigation up hotkey saved successfully");
  } catch (err) {
    logger.error("[hotkey-service] Failed to save control panel navigation up hotkey:", err);
    throw err;
  }
};

/**
 * Gets the saved control panel navigation up hotkey from backend config
 */
export const getSavedControlPanelNavigationUpHotkey = async (): Promise<string> => {
  const hotkey = await invoke<string>("get_saved_control_panel_navigation_up_hotkey");
  logger.debug(`[hotkey-service] Got saved control panel navigation up hotkey: "${hotkey}"`);
  return hotkey;
};

/**
 * Checks if a specific panel is currently visible
 * @param panelLabel - The label of the panel to check (e.g., "control-panel", "tasks-list")
 */
export const isPanelVisible = async (panelLabel: string): Promise<boolean> => {
  return invoke<boolean>("is_panel_visible", { panelLabel });
};

/**
 * Switch control panel view client-side (no native window operations).
 * Use this when the panel is already open to avoid focus flicker.
 *
 * @param view - The view to switch to (discriminated union)
 */
export const switchControlPanelClientSide = (view: ControlPanelViewType): void => {
  // Import eventBus dynamically to avoid circular dependencies
  import("@/entities").then(({ eventBus }) => {
    logger.debug(`[hotkey-service] Client-side switch to:`, view);
    eventBus.emit("open-control-panel", { view });
  });
};

/**
 * Convenience wrapper: Switch to a thread view client-side.
 */
export const switchToThread = (threadId: string): void => {
  switchControlPanelClientSide({ type: "thread", threadId });
};

/**
 * Convenience wrapper: Switch to a plan view client-side.
 */
export const switchToPlan = (planId: string): void => {
  switchControlPanelClientSide({ type: "plan", planId });
};


