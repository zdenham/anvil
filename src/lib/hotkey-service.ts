import { invoke } from "@tauri-apps/api/core";

/**
 * Registers a global hotkey with Tauri (temporary, not saved)
 * @param hotkey - The hotkey string from HotkeyRecorder (e.g., "Command+Space")
 */
export const registerGlobalHotkey = async (hotkey: string): Promise<void> => {
  await invoke("register_hotkey", { hotkey });
};

/**
 * Saves the hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register
 */
export const saveHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_hotkey", { hotkey });
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
 * Saves the task panel hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register
 */
export const saveTaskPanelHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_task_panel_hotkey", { hotkey });
};

/**
 * Gets the saved task panel hotkey from backend config
 */
export const getSavedTaskPanelHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_task_panel_hotkey");
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
 * Opens the task panel and displays a specific task.
 * If prompt is provided, shows optimistic UI with the prompt text before task loads.
 * taskId is required - all threads must be associated with a task.
 */
export const openTask = async (
  threadId: string,
  taskId: string,
  prompt?: string,
  repoName?: string
): Promise<void> => {
  await invoke("open_task", { threadId, taskId, prompt, repoName });
};

/**
 * Hides the task panel
 */
export const hideTask = async (): Promise<void> => {
  await invoke("hide_task");
};

/**
 * Opens the simple task panel and displays a specific simple task.
 * If prompt is provided, shows optimistic UI with the prompt text before task loads.
 * Simple tasks run directly in the source repository without worktrees or branches.
 */
export const openSimpleTask = async (
  threadId: string,
  taskId: string,
  prompt?: string,
): Promise<void> => {
  await invoke("open_simple_task", { threadId, taskId, prompt });
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
 * Shows the tasks list panel
 */
export const showTasksPanel = async (): Promise<void> => {
  await invoke("show_tasks_panel");
};

/**
 * Saves the navigation down hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register (e.g., "Shift+Down", "Command+J")
 */
export const saveNavigationDownHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_navigation_down_hotkey", { hotkey });
};

/**
 * Gets the saved navigation down hotkey from backend config
 */
export const getSavedNavigationDownHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_navigation_down_hotkey");
};

/**
 * Saves the navigation up hotkey to backend config and registers it
 * @param hotkey - The hotkey string to save and register (e.g., "Shift+Up", "Command+K")
 */
export const saveNavigationUpHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_navigation_up_hotkey", { hotkey });
};

/**
 * Gets the saved navigation up hotkey from backend config
 */
export const getSavedNavigationUpHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_navigation_up_hotkey");
};


