/**
 * Simple logger for agents - sends logs via socket to the hub.
 * Logs are sent via the hub client when connected.
 */

import { getHubClient } from "../output.js";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function log(level: LogLevel, ...args: unknown[]): void {
  const message = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");

  const hub = getHubClient();
  if (hub?.isConnected) {
    hub.sendLog(level, message);
  }
  // Silently drop logs when hub not connected
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) {
      log("DEBUG", ...args);
    }
  },
  info: (...args: unknown[]) => log("INFO", ...args),
  warn: (...args: unknown[]) => log("WARN", ...args),
  error: (...args: unknown[]) => log("ERROR", ...args),
};
