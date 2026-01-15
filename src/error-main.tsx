import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "./index.css";
import { ErrorPanel } from "./components/error-panel";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { logger, setLogSource } from "./lib/logger-client";

// Set log source before any logging occurs
setLogSource("error");

// Capture browser errors early
initWebErrorCapture("error");

logger.log("[error-main] Module loading...");

// Module-level state for cleanup
let bridgeCleanup: UnlistenFn[] = [];
let cleanupRegistered = false;

/**
 * Bootstrap sequence for error window.
 * Sets up incoming bridge to receive show-error and panel-hidden events.
 */
async function bootstrap() {
  logger.log("[error-main] Starting bootstrap...");

  // Outgoing bridge broadcasts events to other windows
  setupOutgoingBridge();
  // Incoming bridge receives events from other windows
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[error-main] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          logger.error("[error-main] Cleanup error:", error);
        }
      }
    });
  }

  logger.log("[error-main] Bootstrap complete");
}

// HMR safeguard: prevent duplicate React roots
const rootElement = document.getElementById("root") as HTMLElement;

// Clear any existing content (handles HMR reloads)
rootElement.innerHTML = "";

// Start bootstrap and render when ready
bootstrap()
  .then(() => {
    ReactDOM.createRoot(rootElement).render(<ErrorPanel />);
  })
  .catch((error) => {
    logger.error("[error-main] Bootstrap failed:", error);
  });
