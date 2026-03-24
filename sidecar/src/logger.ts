/**
 * Sidecar logger — surfaces sidecar logs in the app's Logs tab.
 *
 * Pushes entries to the shared logBuffer and broadcasts them to
 * connected WS clients. Also writes to console as a fallback
 * (useful in dev and before any WS clients connect).
 *
 * Additionally persists every entry to a JSON-lines log file on disk
 * so that crash diagnostics survive process death.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SidecarState, LogEntry } from "./state.js";

export interface SidecarLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ── Persistent log file ──────────────────────────────────────────────

function defaultDataDir(): string {
  const suffix = process.env.ANVIL_APP_SUFFIX ?? "";
  const dirName = suffix ? `.anvil-${suffix}` : ".anvil";
  return join(process.env.HOME ?? "", dirName);
}

const LOG_DIR = join(process.env.ANVIL_DATA_DIR || defaultDataDir(), "logs");
const LOG_FILE = join(LOG_DIR, "sidecar.log");

let logDirReady = false;

function writeToLogFile(entry: LogEntry): void {
  try {
    if (!logDirReady) {
      mkdirSync(LOG_DIR, { recursive: true });
      logDirReady = true;
    }
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort — don't let log-file errors take down the process
  }
}

// ── Logger factory ───────────────────────────────────────────────────

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
    writeToLogFile(entry);

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
