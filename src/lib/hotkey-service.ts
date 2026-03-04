import { invoke } from "@/lib/invoke";
import { logger } from "./logger-client";
import type { ControlPanelViewType } from "@/entities/events";
import type { ContentPaneView } from "@/components/content-pane/types";

/**
 * Registers a global hotkey with Tauri (temporary, not saved)
 * @param hotkey - The hotkey string from HotkeyRecorder (e.g., "Command+Space")
 */
export const registerGlobalHotkey = async (hotkey: string): Promise<void> => {
  try {
    await invoke("register_hotkey", { hotkey });
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
  try {
    await invoke("save_hotkey", { hotkey });
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
 * Shows the main window and sets a specific content pane view.
 * Used for spotlight → main window navigation (Enter without Shift modifier).
 *
 * @param view - The ContentPaneView to display (thread, plan, settings, logs, or empty)
 */
export const showMainWindowWithView = async (view: ContentPaneView): Promise<void> => {
  const startTime = Date.now();
  const threadId = view.type === "thread" ? view.threadId : undefined;
  logger.info("[hotkey-service:TIMING] showMainWindowWithView START", {
    view,
    threadId,
    timestamp: new Date(startTime).toISOString(),
  });
  await invoke("show_main_window_with_view", { view });
  logger.info("[hotkey-service:TIMING] showMainWindowWithView COMPLETE (invoke returned)", {
    threadId,
    elapsedMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  });
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
 * Checks if a specific panel is currently visible
 * @param panelLabel - The label of the panel to check (e.g., "control-panel", "tasks-list")
 */
export const isPanelVisible = async (panelLabel: string): Promise<boolean> => {
  return invoke<boolean>("is_panel_visible", { panelLabel });
};

/**
 * Shows the control panel with a specific view.
 * Routes through Rust to ensure the open-control-panel event reaches the control panel window.
 *
 * This is the preferred way to switch control panel views from any window,
 * as it properly crosses the window boundary (unlike JS eventBus which stays local).
 *
 * @param view - The view to switch to (discriminated union)
 */
export const showControlPanelWithView = async (view: ControlPanelViewType): Promise<void> => {
  logger.info(`[hotkey-service] showControlPanelWithView:`, view);
  await invoke("show_control_panel_with_view", { view });
};

/**
 * Switch to a thread view in the control panel.
 * Routes through Rust to ensure the event reaches the control panel window.
 */
export const switchToThread = async (threadId: string): Promise<void> => {
  await showControlPanelWithView({ type: "thread", threadId });
};

/**
 * Switch to a plan view in the control panel.
 * Routes through Rust to ensure the event reaches the control panel window.
 */
export const switchToPlan = async (planId: string): Promise<void> => {
  await showControlPanelWithView({ type: "plan", planId });
};


