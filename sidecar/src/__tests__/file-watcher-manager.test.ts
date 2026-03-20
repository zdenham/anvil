/**
 * FileWatcherManager unit tests.
 *
 * Tests watcher lifecycle: start, stop, list, dispose, debounced events.
 * Uses real filesystem operations with temp directories.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileWatcherManager } from "../managers/file-watcher-manager.js";
import { EventBroadcaster } from "../push.js";

function createBroadcaster(): EventBroadcaster & {
  events: { event: string; payload: unknown }[];
} {
  const broadcaster = new EventBroadcaster();
  const events: { event: string; payload: unknown }[] = [];
  broadcaster.subscribe(({ event, payload }) => {
    events.push({ event, payload });
  });
  return Object.assign(broadcaster, { events });
}

describe("FileWatcherManager", () => {
  let manager: FileWatcherManager;
  let tmpDir: string;

  afterEach(async () => {
    manager?.dispose();
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("start creates a watcher, stop removes it", () => {
    manager = new FileWatcherManager();
    const broadcaster = createBroadcaster();

    manager.start("w1", "/tmp", false, broadcaster);
    expect(manager.list()).toEqual(["w1"]);

    manager.stop("w1");
    expect(manager.list()).toEqual([]);
  });

  it("duplicate watchId replaces old watcher", () => {
    manager = new FileWatcherManager();
    const broadcaster = createBroadcaster();

    manager.start("w1", "/tmp", false, broadcaster);
    manager.start("w1", "/var", false, broadcaster);

    expect(manager.list()).toEqual(["w1"]);
  });

  it("list returns active watcher IDs", () => {
    manager = new FileWatcherManager();
    const broadcaster = createBroadcaster();

    manager.start("w1", "/tmp", false, broadcaster);
    manager.start("w2", "/var", false, broadcaster);

    expect(manager.list()).toEqual(["w1", "w2"]);
  });

  it("dispose closes all watchers", () => {
    manager = new FileWatcherManager();
    const broadcaster = createBroadcaster();

    manager.start("w1", "/tmp", false, broadcaster);
    manager.start("w2", "/var", false, broadcaster);

    manager.dispose();
    expect(manager.list()).toEqual([]);
  });

  it("stop on non-existent watcher is a no-op", () => {
    manager = new FileWatcherManager();
    expect(() => manager.stop("nonexistent")).not.toThrow();
  });

  it("change events are debounced and broadcast", async () => {
    manager = new FileWatcherManager();
    const broadcaster = createBroadcaster();
    tmpDir = await mkdtemp(join(tmpdir(), "fwm-test-"));

    manager.start("w-test", tmpDir, true, broadcaster);

    // Wait for chokidar to initialize
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Write a file to trigger a change event
    await writeFile(join(tmpDir, "test.txt"), "hello");

    // Wait for debounce (200ms) + buffer
    await new Promise((resolve) => setTimeout(resolve, 500));

    const changeEvents = broadcaster.events.filter(
      (e) => e.event === "file-watcher:changed",
    );
    expect(changeEvents.length).toBeGreaterThan(0);

    const payload = changeEvents[0].payload as {
      watchId: string;
      changedPaths: string[];
    };
    expect(payload.watchId).toBe("w-test");
    expect(payload.changedPaths.length).toBeGreaterThan(0);
    expect(payload.changedPaths[0]).toContain("test.txt");
  });
});
