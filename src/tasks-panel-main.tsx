import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { TasksPanel } from "./components/tasks-panel/tasks-panel";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import "./index.css";

// Set log source before any logging occurs
setLogSource("tasks-panel");

// Capture browser errors early
initWebErrorCapture("tasks-panel");

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

logger.log("[tasks-panel-main] Module loading...");

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
    logger.error("[tasks-panel-main] Failed to get paths info:", error);
  });

/**
 * Bootstrap sequence is critical - order matters!
 *
 * 1. setupOutgoingBridge() - Enable broadcasting events to other windows
 * 2. setupIncomingBridge() - Start listening for cross-window events
 * 3. hydrateEntities() - Load stores from disk
 * 4. setupEntityListeners() - Register event handlers
 *
 * Echo prevention is handled by the _source field in event payloads.
 */
async function bootstrap() {
  logger.log("[tasks-panel-main] Starting bootstrap...");

  // Outgoing bridge broadcasts events to other windows
  setupOutgoingBridge();
  // Incoming bridge receives events from other windows
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[tasks-panel-main] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          logger.error("[tasks-panel-main] Cleanup error:", error);
        }
      }
    });
  }

  // Hydrate entity stores from disk
  await hydrateEntities();

  // Set up entity listeners after bridge and stores are ready
  setupEntityListeners();

  logger.log("[tasks-panel-main] Bootstrap complete");
}

bootstrap()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <TasksPanel />
      </StrictMode>
    );
  })
  .catch((error) => {
    logger.error("[tasks-panel-main] Bootstrap failed:", error);
  });
