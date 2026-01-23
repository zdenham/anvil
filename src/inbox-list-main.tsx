import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { InboxListWindow } from "./components/inbox-list/InboxListWindow";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import "./index.css";

// Set log source before any logging occurs
setLogSource("inbox-list");

// Capture browser errors early
initWebErrorCapture("inbox-list");

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

logger.log("[inbox-list-main] Module loading...");

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
    logger.error("[inbox-list-main] Failed to get paths info:", error);
  });

async function bootstrap() {
  logger.log("[inbox-list-main] Starting bootstrap...");

  // Set up outgoing bridge to broadcast events
  setupOutgoingBridge();

  // Set up incoming bridge to receive events from other windows
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[inbox-list-main] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          logger.error("[inbox-list-main] Cleanup error:", error);
        }
      }
    });
  }

  // Hydrate entity stores from disk
  await hydrateEntities();

  // Set up entity listeners after bridge and stores are ready
  setupEntityListeners();

  logger.log("[inbox-list-main] Bootstrap complete");
}

bootstrap()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <InboxListWindow />
      </StrictMode>
    );
  })
  .catch((error) => {
    logger.error("[inbox-list-main] Bootstrap failed:", error);
  });
