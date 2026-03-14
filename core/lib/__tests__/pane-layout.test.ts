import { describe, it, expect } from "vitest";
import { extractVisibleThreadIds } from "../pane-layout.js";
import type { PaneLayoutPersistedState } from "../../types/pane-layout.js";

function makeState(groups: Record<string, { tabs: Array<{ id: string; view: { type: string; threadId?: string } }>; activeTabId: string }>): PaneLayoutPersistedState {
  return {
    root: { type: "leaf", groupId: Object.keys(groups)[0] ?? "" },
    groups: groups as PaneLayoutPersistedState["groups"],
    activeGroupId: Object.keys(groups)[0] ?? "",
  };
}

describe("extractVisibleThreadIds", () => {
  it("returns empty set for empty groups", () => {
    const state = makeState({});
    expect(extractVisibleThreadIds(state).size).toBe(0);
  });

  it("extracts thread ID from a single group with active thread tab", () => {
    const state = makeState({
      g1: {
        tabs: [{ id: "t1", view: { type: "thread", threadId: "thread-abc" } }],
        activeTabId: "t1",
      },
    });
    const ids = extractVisibleThreadIds(state);
    expect(ids.size).toBe(1);
    expect(ids.has("thread-abc")).toBe(true);
  });

  it("extracts thread IDs from multiple groups (split layout)", () => {
    const state = makeState({
      g1: {
        tabs: [{ id: "t1", view: { type: "thread", threadId: "thread-1" } }],
        activeTabId: "t1",
      },
      g2: {
        tabs: [{ id: "t2", view: { type: "thread", threadId: "thread-2" } }],
        activeTabId: "t2",
      },
    });
    const ids = extractVisibleThreadIds(state);
    expect(ids.size).toBe(2);
    expect(ids.has("thread-1")).toBe(true);
    expect(ids.has("thread-2")).toBe(true);
  });

  it("ignores non-thread active tabs", () => {
    const state = makeState({
      g1: {
        tabs: [{ id: "t1", view: { type: "settings" } }],
        activeTabId: "t1",
      },
      g2: {
        tabs: [{ id: "t2", view: { type: "plan" } }],
        activeTabId: "t2",
      },
    });
    expect(extractVisibleThreadIds(state).size).toBe(0);
  });

  it("only considers the active tab, not background tabs", () => {
    const state = makeState({
      g1: {
        tabs: [
          { id: "t1", view: { type: "thread", threadId: "visible" } },
          { id: "t2", view: { type: "thread", threadId: "background" } },
        ],
        activeTabId: "t1",
      },
    });
    const ids = extractVisibleThreadIds(state);
    expect(ids.size).toBe(1);
    expect(ids.has("visible")).toBe(true);
    expect(ids.has("background")).toBe(false);
  });

  it("handles group with no matching activeTabId gracefully", () => {
    const state = makeState({
      g1: {
        tabs: [{ id: "t1", view: { type: "thread", threadId: "thread-1" } }],
        activeTabId: "nonexistent",
      },
    });
    expect(extractVisibleThreadIds(state).size).toBe(0);
  });

  it("deduplicates same thread visible in multiple groups", () => {
    const state = makeState({
      g1: {
        tabs: [{ id: "t1", view: { type: "thread", threadId: "same-thread" } }],
        activeTabId: "t1",
      },
      g2: {
        tabs: [{ id: "t2", view: { type: "thread", threadId: "same-thread" } }],
        activeTabId: "t2",
      },
    });
    const ids = extractVisibleThreadIds(state);
    expect(ids.size).toBe(1);
    expect(ids.has("same-thread")).toBe(true);
  });
});
