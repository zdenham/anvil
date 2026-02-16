import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger-client";

/** Payload shape for file-watcher:changed events from Rust */
interface FileWatcherEvent {
  watchId: string;
  changedPaths: string[];
}

export const fileWatcherClient = {
  /**
   * Start watching a directory for changes.
   * Events are debounced (200ms) on the Rust side.
   */
  async startWatch(
    watchId: string,
    path: string,
    recursive = false,
  ): Promise<void> {
    logger.debug("[file-watcher] Starting watch:", watchId, path);
    await invoke("start_watch", { watchId, path, recursive });
  },

  /**
   * Stop watching a directory. Safe to call if already stopped.
   */
  async stopWatch(watchId: string): Promise<void> {
    logger.debug("[file-watcher] Stopping watch:", watchId);
    await invoke("stop_watch", { watchId });
  },

  /**
   * Listen for change events on a specific watch.
   * Returns an unlisten function -- call it to unsubscribe.
   * The callback receives the list of changed file paths so the
   * consumer can update only the affected entries.
   */
  onChanged(
    watchId: string,
    callback: (changedPaths: string[]) => void,
  ): Promise<UnlistenFn> {
    return listen<FileWatcherEvent>("file-watcher:changed", (event) => {
      if (event.payload.watchId === watchId) {
        callback(event.payload.changedPaths);
      }
    });
  },
};
