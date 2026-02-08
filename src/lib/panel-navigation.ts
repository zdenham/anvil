/**
 * Panel/Window Navigation Utilities
 *
 * Provides context-aware close/navigation functions that work for both
 * NSPanel (singleton) and standalone WebviewWindows.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger-client";
import { getPanelContext } from "@/stores/panel-context-store";

/**
 * Close the current panel or window.
 * Uses the global panel context from the Zustand store.
 *
 * - For NSPanel: calls hide_control_panel
 * - For standalone windows: calls close_control_panel_window
 */
export async function closeCurrentPanelOrWindow(): Promise<void> {
  const { isStandaloneWindow, instanceId } = getPanelContext();

  if (isStandaloneWindow && instanceId) {
    logger.info(`[panel-navigation] Closing standalone window: ${instanceId}`);
    await invoke("close_control_panel_window", { instanceId });
  } else {
    logger.info(`[panel-navigation] Hiding NSPanel`);
    await invoke("hide_control_panel");
  }
}

/**
 * Close panel/window and navigate to inbox.
 *
 * This is used when there are no more unread items - closes the current
 * view and shows the inbox list panel.
 */
// TODO: Implement open_inbox_list_panel Rust command
// export async function closeAndShowInbox(): Promise<void> {
//   await closeCurrentPanelOrWindow();
//   await invoke("open_inbox_list_panel");
// }
export async function closeAndShowInbox(): Promise<void> {
  // Fallback: just close the panel since open_inbox_list_panel doesn't exist
  await closeCurrentPanelOrWindow();
}

/**
 * Focus the current panel or window.
 *
 * Currently only works for NSPanel. Standalone windows use native focus.
 */
export async function focusCurrentPanel(): Promise<void> {
  const { isStandaloneWindow } = getPanelContext();
  if (!isStandaloneWindow) {
    await invoke("focus_control_panel");
  }
}

/**
 * Pin the current panel (NSPanel only).
 *
 * Pinning prevents the panel from hiding on blur.
 * No-op for standalone windows.
 */
export async function pinCurrentPanel(): Promise<void> {
  const { isStandaloneWindow } = getPanelContext();
  if (!isStandaloneWindow) {
    await invoke("pin_control_panel");
  }
}

/**
 * Check if this is a standalone window.
 */
export function isStandaloneWindow(): boolean {
  return getPanelContext().isStandaloneWindow;
}

/**
 * Get the instance ID (null for NSPanel).
 */
export function getInstanceId(): string | null {
  return getPanelContext().instanceId;
}
