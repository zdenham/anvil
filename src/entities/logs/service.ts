import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useLogStore } from "./store";
import type { LogEntry } from "./types";
import { normalizeLogEntry, type RawLogEntry } from "./types";

const FLUSH_INTERVAL_MS = 150;

let unlistenFn: UnlistenFn | null = null;
let idCounter = 0;
let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushBuffer(): void {
  flushTimer = null;
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  useLogStore.getState().addLogs(batch);
}

function bufferLog(log: LogEntry): void {
  buffer.push(log);
  if (!flushTimer) {
    flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
  }
}

export const logService = {
  /**
   * Initializes log subscription. Called once when Logs tab first opens.
   * Gets buffered logs and subscribes to live updates.
   */
  async init(): Promise<void> {
    if (unlistenFn) return; // Already initialized

    // Get buffered logs from Rust
    const buffered = await invoke<RawLogEntry[]>("get_buffered_logs");
    const logs = buffered.map((raw) =>
      normalizeLogEntry(raw, `log-${idCounter++}`)
    );
    useLogStore.getState().hydrate(logs);

    // Subscribe to live log events — buffer and flush in batches
    unlistenFn = await listen<RawLogEntry>("log-event", (event) => {
      const log = normalizeLogEntry(event.payload, `log-${idCounter++}`);
      bufferLog(log);
    });
  },

  /**
   * Clears all logs permanently (both frontend and backend buffer).
   */
  async clear(): Promise<void> {
    await invoke("clear_logs");
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    useLogStore.getState().clear();
  },

  /**
   * Cleanup subscription (call on app unmount if needed).
   */
  destroy(): void {
    flushBuffer();
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  },
};
