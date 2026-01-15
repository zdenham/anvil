import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "./index.css";
import { ClipboardManager } from "./components/clipboard/clipboard-manager";
import { WorkspaceSettingsProvider } from "./contexts";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { eventBus } from "./entities";
import { logger, setLogSource } from "./lib/logger-client";

// Set log source before any logging occurs
setLogSource("clipboard");

// Capture browser errors early
initWebErrorCapture("clipboard");

logger.log("[clipboard-main] Module loading...");

// Module-level state for cleanup
let bridgeCleanup: UnlistenFn[] = [];
let cleanupRegistered = false;

/**
 * Bootstrap sequence for clipboard window.
 * Sets up incoming bridge to receive panel-hidden, clipboard-entry-added, and window:focus-changed events.
 */
async function bootstrap() {
  logger.log("[clipboard-main] Starting bootstrap...");

  // Outgoing bridge broadcasts events to other windows
  setupOutgoingBridge();
  // Incoming bridge receives events from other windows
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[clipboard-main] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          logger.error("[clipboard-main] Cleanup error:", error);
        }
      }
    });
  }

  logger.log("[clipboard-main] Bootstrap complete");
}

/**
 * Wrapper that remounts ClipboardManager when the panel is hidden.
 * By changing the key on hide, React unmounts/remounts the component while hidden.
 * When the panel is shown again, it has fresh initial state (selectedIndex = 0).
 */
const ClipboardManagerWrapper = () => {
  const [instanceKey, setInstanceKey] = useState(0);

  // Listen for panel-hidden via eventBus (no async cleanup races)
  useEffect(() => {
    const handlePanelHidden = () => {
      // Increment key to trigger remount - happens while hidden, so no flash
      setInstanceKey((prev) => prev + 1);
    };

    eventBus.on("panel-hidden", handlePanelHidden);

    return () => {
      eventBus.off("panel-hidden", handlePanelHidden);
    };
  }, []);

  return <ClipboardManager key={instanceKey} />;
};

// Start bootstrap and render when ready
bootstrap()
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <WorkspaceSettingsProvider>
          <ClipboardManagerWrapper />
        </WorkspaceSettingsProvider>
      </React.StrictMode>
    );
  })
  .catch((error) => {
    logger.error("[clipboard-main] Bootstrap failed:", error);
  });
