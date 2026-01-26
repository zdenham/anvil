import ReactDOM from "react-dom/client";
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

// NOTE: We no longer manually clean up bridge listeners on window close.
// Tauri automatically cleans up event listeners when a window is destroyed.
// Manual cleanup during onCloseRequested was causing a RefCell panic in
// tauri-runtime-wry because unlisten calls during window close events
// trigger re-entrant borrows of internal Tauri state.

/**
 * Bootstrap sequence for error window.
 * Sets up incoming bridge to receive show-error and panel-hidden events.
 */
async function bootstrap() {
  logger.log("[error-main] Starting bootstrap...");

  // Outgoing bridge broadcasts events to other windows
  setupOutgoingBridge();
  // Incoming bridge receives events from other windows
  await setupIncomingBridge();

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
