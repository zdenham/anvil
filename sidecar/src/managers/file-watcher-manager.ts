/**
 * File watcher manager.
 *
 * Manages directory watchers via chokidar with 200ms debounce,
 * broadcasting batched change events.
 *
 * Mirrors the Rust `FileWatcherManager` in `src-tauri/src/file_watcher.rs`.
 */

import { watch, type FSWatcher } from "chokidar";
import type { EventBroadcaster } from "../push.js";

interface WatcherEntry {
  watcher: FSWatcher;
  /** Paths accumulated during the debounce window. */
  pendingPaths: Set<string>;
  /** Active debounce timer. */
  timer: ReturnType<typeof setTimeout> | null;
}

const DEBOUNCE_MS = 200;

export class FileWatcherManager {
  private watchers = new Map<string, WatcherEntry>();

  /**
   * Start watching a path.
   * If watchId already exists, the old watcher is replaced.
   */
  start(
    watchId: string,
    path: string,
    recursive: boolean,
    broadcaster: EventBroadcaster,
  ): void {
    // Replace existing watcher if present
    if (this.watchers.has(watchId)) {
      this.stop(watchId);
    }

    const fsWatcher = watch(path, {
      depth: recursive ? undefined : 0,
      ignoreInitial: true,
    });

    const entry: WatcherEntry = {
      watcher: fsWatcher,
      pendingPaths: new Set(),
      timer: null,
    };

    const onEvent = (changedPath: string) => {
      entry.pendingPaths.add(changedPath);
      resetDebounce(entry, watchId, broadcaster);
    };

    fsWatcher.on("add", onEvent);
    fsWatcher.on("change", onEvent);
    fsWatcher.on("unlink", onEvent);

    this.watchers.set(watchId, entry);
  }

  /** Stop a watcher by ID. */
  stop(watchId: string): void {
    const entry = this.watchers.get(watchId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    this.watchers.delete(watchId);
  }

  /** List all active watcher IDs. */
  list(): string[] {
    return Array.from(this.watchers.keys());
  }

  /** Close all watchers. Called on sidecar shutdown. */
  dispose(): void {
    for (const [, entry] of this.watchers) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.watcher.close();
    }
    this.watchers.clear();
  }
}

/**
 * Reset the debounce timer for a watcher entry.
 * When the timer fires, broadcasts accumulated changed paths and clears the set.
 */
function resetDebounce(
  entry: WatcherEntry,
  watchId: string,
  broadcaster: EventBroadcaster,
): void {
  if (entry.timer) clearTimeout(entry.timer);

  entry.timer = setTimeout(() => {
    const changedPaths = Array.from(entry.pendingPaths);
    entry.pendingPaths.clear();
    entry.timer = null;
    broadcaster.broadcast("file-watcher:changed", { watchId, changedPaths });
  }, DEBOUNCE_MS);
}
