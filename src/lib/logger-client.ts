import { invoke } from "@tauri-apps/api/core";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

type BatchEntry = {
  level: LogLevel;
  message: string;
  source: string;
  timestamp: number;
};

/**
 * Source identifier for the current window (e.g., "main", "spotlight", "task-panel").
 * Defaults to "web" for backwards compatibility.
 */
let logSource = "web";

const queue: BatchEntry[] = [];
const FLUSH_INTERVAL_MS = 500;

let flushTimer: ReturnType<typeof setInterval> | null = null;

window.addEventListener("beforeunload", () => flushQueue());

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

function flushQueue(): void {
  if (queue.length === 0) return;
  const entries = queue.splice(0);
  invoke("web_log_batch", { entries }).catch(() => {
    // Silently ignore if Tauri isn't ready
  });
}

function startFlushTimer(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(() => {
    flushQueue();
    if (queue.length === 0 && flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }, FLUSH_INTERVAL_MS);
}

function sendLog(level: LogLevel, ...args: unknown[]): void {
  const message = formatArgs(...args);
  queue.push({ level, message, source: logSource, timestamp: Date.now() });

  if (level === "error") {
    flushQueue();
    return;
  }

  startFlushTimer();
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
