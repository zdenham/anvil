import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ControlPanelWindow } from "./components/control-panel/control-panel-window";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { initializeTriggers } from "./lib/triggers";
import "./index.css";

// Set log source before any logging occurs
setLogSource("control-panel");

// Capture browser errors early
initWebErrorCapture("control-panel");

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

logger.log("[control-panel-main] Module loading...");

// Initialize trigger system for @ file mentions
initializeTriggers();

// Module-level state for cleanup
let bridgeCleanup: UnlistenFn[] = [];
let cleanupRegistered = false;

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
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[control-panel-main] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          logger.error("[control-panel-main] Cleanup error:", error);
        }
      }
    });
  }

  // Hydrate entity stores from disk
  await hydrateEntities();

  // Set up entity listeners after bridge and stores are ready
  setupEntityListeners();

  logger.log("[control-panel-main] Bootstrap complete");
}

bootstrap()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ControlPanelWindow />
      </StrictMode>
    );
  })
  .catch((error) => {
    logger.error("[control-panel-main] Bootstrap failed:", error);
  });
