import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisibilityWatcher } from "./visibility-watcher.js";
import type { PaneLayoutPersistedState } from "@core/types/pane-layout.js";
import { EventName } from "@core/types/events.js";

function makeLayout(threadIds: string[]): PaneLayoutPersistedState {
  const groups: PaneLayoutPersistedState["groups"] = {};
  const firstGroupId = threadIds.length > 0 ? `g-0` : "g-empty";

  threadIds.forEach((tid, i) => {
    const gid = `g-${i}`;
    groups[gid] = {
      id: gid,
      tabs: [{ id: `t-${i}`, view: { type: "thread", threadId: tid } }],
      activeTabId: `t-${i}`,
    };
  });

  if (threadIds.length === 0) {
    groups[firstGroupId] = {
      id: firstGroupId,
      tabs: [{ id: "t-empty", view: { type: "empty" } }],
      activeTabId: "t-empty",
    };
  }

  return {
    root: { type: "leaf", groupId: firstGroupId },
    groups,
    activeGroupId: firstGroupId,
  };
}

describe("VisibilityWatcher", () => {
  let tmpDir: string;
  let layoutPath: string;
  let watcher: VisibilityWatcher;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `visibility-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    layoutPath = join(tmpDir, "pane-layout.json");
  });

  afterEach(() => {
    watcher?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads initial visible set on start", () => {
    writeFileSync(layoutPath, JSON.stringify(makeLayout(["thread-1", "thread-2"])));
    watcher = new VisibilityWatcher(layoutPath);
    watcher.start();

    const ids = watcher.getVisibleThreadIds();
    expect(ids.has("thread-1")).toBe(true);
    expect(ids.has("thread-2")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("throws on start if file does not exist", () => {
    watcher = new VisibilityWatcher(join(tmpDir, "nonexistent.json"));
    expect(() => watcher.start()).toThrow();
  });

  it("throws on start if file has invalid JSON", () => {
    writeFileSync(layoutPath, "not json");
    watcher = new VisibilityWatcher(layoutPath);
    expect(() => watcher.start()).toThrow();
  });

  it("throws on start if file fails Zod parse", () => {
    writeFileSync(layoutPath, JSON.stringify({ invalid: true }));
    watcher = new VisibilityWatcher(layoutPath);
    expect(() => watcher.start()).toThrow(/Invalid pane-layout/);
  });

  it("allows lifecycle events regardless of visibility", () => {
    writeFileSync(layoutPath, JSON.stringify(makeLayout(["thread-1"])));
    watcher = new VisibilityWatcher(layoutPath);
    watcher.start();

    // Lifecycle event for a non-visible thread should still pass
    expect(watcher.shouldSendEvent(EventName.THREAD_CREATED, "thread-999")).toBe(true);
    expect(watcher.shouldSendEvent(EventName.THREAD_STATUS_CHANGED, "thread-999")).toBe(true);
    expect(watcher.shouldSendEvent(EventName.PLAN_CREATED, "thread-999")).toBe(true);
  });

  it("gates display events for non-visible threads", () => {
    writeFileSync(layoutPath, JSON.stringify(makeLayout(["thread-1"])));
    watcher = new VisibilityWatcher(layoutPath);
    watcher.start();

    // Display event for visible thread → allowed
    expect(watcher.shouldSendEvent(EventName.STREAM_DELTA, "thread-1")).toBe(true);
    expect(watcher.shouldSendEvent(EventName.THREAD_ACTION, "thread-1")).toBe(true);

    // Display event for non-visible thread → gated
    expect(watcher.shouldSendEvent(EventName.STREAM_DELTA, "thread-999")).toBe(false);
    expect(watcher.shouldSendEvent(EventName.THREAD_ACTION, "thread-999")).toBe(false);
  });

  it("updates visible set on refresh after file change", () => {
    writeFileSync(layoutPath, JSON.stringify(makeLayout(["thread-1"])));
    watcher = new VisibilityWatcher(layoutPath);
    watcher.start();

    expect(watcher.shouldSendEvent(EventName.STREAM_DELTA, "thread-2")).toBe(false);

    // Simulate tab switch — write new layout, then manually refresh
    // (fs.watch fires this automatically in production; we call refresh()
    // directly to avoid non-deterministic fs.watch timing in tests)
    writeFileSync(layoutPath, JSON.stringify(makeLayout(["thread-2"])));
    watcher.refresh();

    expect(watcher.shouldSendEvent(EventName.STREAM_DELTA, "thread-2")).toBe(true);
    expect(watcher.shouldSendEvent(EventName.STREAM_DELTA, "thread-1")).toBe(false);
  });

  it("handles empty layout (no threads visible)", () => {
    writeFileSync(layoutPath, JSON.stringify(makeLayout([])));
    watcher = new VisibilityWatcher(layoutPath);
    watcher.start();

    expect(watcher.getVisibleThreadIds().size).toBe(0);
    // Lifecycle events still pass
    expect(watcher.shouldSendEvent(EventName.THREAD_CREATED, "thread-1")).toBe(true);
    // Display events are gated
    expect(watcher.shouldSendEvent(EventName.STREAM_DELTA, "thread-1")).toBe(false);
  });
});
