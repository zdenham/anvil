/**
 * Sidecar logger — surfaces sidecar logs in the app's Logs tab.
 *
 * Pushes entries to the shared logBuffer and broadcasts them to
 * connected WS clients. Also writes to console as a fallback
 * (useful in dev and before any WS clients connect).
 */

import type { SidecarState, LogEntry } from "./state.js";

export interface SidecarLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(state: SidecarState): SidecarLogger {
  function log(level: string, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      target: "sidecar",
      message,
    };
    state.logBuffer.push(entry);
    state.broadcaster.broadcast("log-event", entry);

    if (level === "error") {
      console.error(`[sidecar] ${message}`);
    } else {
      console.log(`[sidecar] ${message}`);
    }
  }

  return {
    info: (message) => log("info", message),
    warn: (message) => log("warn", message),
    error: (message) => log("error", message),
  };
}
