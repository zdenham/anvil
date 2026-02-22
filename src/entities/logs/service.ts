import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useLogStore } from "./store";
import { normalizeLogEntry, type RawLogEntry } from "./types";

let unlistenFn: UnlistenFn | null = null;
let idCounter = 0;

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

    // Subscribe to live log events
    unlistenFn = await listen<RawLogEntry>("log-event", (event) => {
      const log = normalizeLogEntry(event.payload, `log-${idCounter++}`);
      useLogStore.getState().addLog(log);
    });
  },

  /**
   * Clears all logs permanently (both frontend and backend buffer).
   */
  async clear(): Promise<void> {
    await invoke("clear_logs");
    useLogStore.getState().clear();
  },

  /**
   * Cleanup subscription (call on app unmount if needed).
   */
  destroy(): void {
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  },
};
