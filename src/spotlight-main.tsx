import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { Spotlight } from "./components/spotlight/spotlight";
import { WorkspaceSettingsProvider, GlobalErrorProvider } from "./contexts";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { setupOutgoingBridge, setupIncomingBridge } from "./lib/event-bridge";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { initializeTriggers } from "./lib/triggers";

// Set log source before any logging occurs
setLogSource("spotlight");

// Capture browser errors early
initWebErrorCapture("spotlight");

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

logger.log("[spotlight-main] Module loading...");

// Initialize trigger system for @ file mentions
initializeTriggers();

// NOTE: We no longer manually clean up bridge listeners on window close.
// Tauri automatically cleans up event listeners when a window is destroyed.
// Manual cleanup during onCloseRequested was causing a RefCell panic in
// tauri-runtime-wry because unlisten calls during window close events
// trigger re-entrant borrows of internal Tauri state.

/**
 * Bootstrap sequence for spotlight window.
 * Sets up both outgoing (emit events) and incoming (receive events) bridges.
 */
async function bootstrap() {
  logger.log("[spotlight-main] Starting bootstrap...");

  // Hydrate entity stores from disk (spotlight runs in separate JS context)
  // Not the main window — skip gateway SSE connection to avoid duplicate event processing
  await hydrateEntities({ isMainWindow: false });
  logger.log("[spotlight-main] Hydration complete");

  // Outgoing: for broadcasting events TO other windows (spotlight spawns agents)
  setupOutgoingBridge();
  logger.log("[spotlight-main] Outgoing bridge setup complete");

  // Incoming: receive all events including broadcasts
  // Echo prevention is handled by _source field in event-bridge
  await setupIncomingBridge();
  logger.log("[spotlight-main] Incoming bridge setup complete");

  // Entity listeners: react to events by updating stores
  // Not the main window — skip gateway/PR webhook listeners
  setupEntityListeners({ isMainWindow: false });
  logger.log("[spotlight-main] Entity listeners setup complete");

  logger.log("[spotlight-main] Bootstrap complete");
}

// Set data-app-suffix attribute on document root for CSS styling
invoke<PathsInfo>("get_paths_info")
  .then((info) => {
    if (info.app_suffix) {
      document.documentElement.dataset.appSuffix = info.app_suffix;
    }
  })
  .catch((error) => {
    logger.error("Failed to get paths info:", error);
  });

// Start bootstrap and render when ready
bootstrap()
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <GlobalErrorProvider>
          <WorkspaceSettingsProvider>
            <Spotlight />
          </WorkspaceSettingsProvider>
        </GlobalErrorProvider>
      </React.StrictMode>
    );
  })
  .catch((error) => {
    logger.error("[spotlight-main] Bootstrap failed:", error);
  });
