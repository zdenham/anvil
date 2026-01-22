import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./index.css";
import App from "./App";
import { WorkspaceSettingsProvider, GlobalErrorProvider } from "./contexts";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { setupOutgoingBridge, setupIncomingBridge } from "./lib/event-bridge";

// Set log source before any logging occurs
setLogSource("main");

// Capture browser errors early, before anything else runs
initWebErrorCapture("main");

// Set up event bridge early, before React mounts
// This ensures events (e.g., repository:created) can be broadcast during onboarding
setupOutgoingBridge();
setupIncomingBridge();

// Plan listeners are now set up via setupEntityListeners() in App.tsx

// Global handler to open external links in system browser
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const anchor = target.closest("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (href?.startsWith("http://") || href?.startsWith("https://")) {
    e.preventDefault();
    openUrl(href).catch((err) => {
      logger.error("[main] Failed to open external URL:", err);
    });
  }
});

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

// NOTE: bootstrapMortDirectory() is called from App.tsx after permissions check
// This ensures no filesystem operations happen before our permissions flow

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <GlobalErrorProvider>
      <WorkspaceSettingsProvider>
        <App />
      </WorkspaceSettingsProvider>
    </GlobalErrorProvider>
  </React.StrictMode>
);
