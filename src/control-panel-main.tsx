import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { ControlPanelWindow } from "./components/control-panel/control-panel-window";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { initializeTriggers } from "./lib/triggers";
import { initHomeDir } from "./lib/utils/path-display";
import { usePanelContextStore } from "./stores/panel-context-store";
import "./index.css";

// Window configuration detection - determines if this is an NSPanel or standalone window
export interface WindowConfig {
  type: "panel" | "window";
  instanceId: string | null;
  threadId: string | null;
}

/**
 * Detects window configuration from URL parameters.
 * - NSPanel (singleton): No instanceId in URL, uses get_pending_control_panel IPC
 * - Standalone window: Has instanceId in URL, uses URL params for thread context
 */
export function detectWindowConfig(): WindowConfig {
  const params = new URLSearchParams(window.location.search);
  const instanceId = params.get("instanceId");

  return {
    type: instanceId ? "window" : "panel",
    instanceId,
    threadId: params.get("threadId"),
  };
}

// Detect window type on load
const windowConfig = detectWindowConfig();

// Initialize panel context store from URL params (once at startup)
// This allows non-React code to access panel context via getPanelContext()
usePanelContextStore.getState().initialize();

// Set log source based on window type
const logSource = windowConfig.type === "window"
  ? `control-panel-window-${windowConfig.instanceId?.slice(0, 8) ?? "unknown"}`
  : "control-panel";
setLogSource(logSource);

// Capture browser errors early
initWebErrorCapture(logSource);

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

logger.log("[control-panel-main] Module loading...", { windowConfig });

// Initialize trigger system for @ file mentions
initializeTriggers();

// Initialize home directory cache early for path display utilities
initHomeDir();

// Module-level state for cleanup
// NOTE: We no longer manually clean up bridge listeners on window close.
// Tauri automatically cleans up event listeners when a window is destroyed.
// Manual cleanup during onCloseRequested was causing a RefCell panic in
// tauri-runtime-wry because unlisten calls during window close events
// trigger re-entrant borrows of internal Tauri state.

// Set data-app-suffix attribute on document root for CSS styling
invoke<PathsInfo>("get_paths_info")
  .then((info) => {
    if (info.app_suffix) {
      document.documentElement.dataset.appSuffix = info.app_suffix;
    }
  })
  .catch((error) => {
    logger.error("[control-panel-main] Failed to get paths info:", error);
  });

async function bootstrap() {
  logger.log("[control-panel-main] Starting bootstrap...");

  // Set up outgoing bridge to broadcast events (e.g., thread:updated when marking as read)
  setupOutgoingBridge();

  // Set up incoming bridge to receive events from other windows
  // NOTE: We don't store the cleanup functions or register onCloseRequested handlers.
  // Tauri automatically cleans up event listeners when a window is destroyed.
  // Manual cleanup during onCloseRequested was causing a RefCell panic in
  // tauri-runtime-wry because unlisten calls during window close events
  // trigger re-entrant borrows of internal Tauri state.
  await setupIncomingBridge();

  // Hydrate entity stores from disk
  // Not the main window — skip gateway SSE connection to avoid duplicate event processing
  await hydrateEntities({ isMainWindow: false });

  // Set up entity listeners after bridge and stores are ready
  // Not the main window — skip gateway/PR webhook listeners
  setupEntityListeners({ isMainWindow: false });

  logger.log("[control-panel-main] Bootstrap complete");
}

bootstrap()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ControlPanelWindow windowConfig={windowConfig} />
      </StrictMode>
    );
  })
  .catch((error) => {
    logger.error("[control-panel-main] Bootstrap failed:", error);
  });
