import { invoke } from "@tauri-apps/api/core";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

/**
 * Source identifier for the current window (e.g., "main", "spotlight", "task-panel").
 * Defaults to "web" for backwards compatibility.
 */
let logSource = "web";

/**
 * Sets the source identifier for all logs from this window.
 * Call this once at app initialization.
 */
export function setLogSource(source: string): void {
  logSource = source;
}

function formatArgs(...args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function sendLog(level: LogLevel, ...args: unknown[]): void {
  const message = formatArgs(...args);
  // Fire and forget - don't block on logging
  invoke("web_log", { level, message, source: logSource }).catch(() => {
    // Silently ignore if Tauri isn't ready
  });
}

/**
 * Logger that pipes messages to the Tauri terminal.
 * Import and use directly: logger.log("hello"), logger.error("oops")
 */
export const logger = {
  log: (...args: unknown[]) => sendLog("log", ...args),
  info: (...args: unknown[]) => sendLog("info", ...args),
  warn: (...args: unknown[]) => sendLog("warn", ...args),
  error: (...args: unknown[]) => sendLog("error", ...args),
  debug: (...args: unknown[]) => sendLog("debug", ...args),
};
