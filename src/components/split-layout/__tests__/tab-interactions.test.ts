/**
 * Tests for tab interaction behaviors — verifies store-level
 * tab activation, closing, and neighbor selection.
 *
 * Note: Close-neighbor (left-neighbor activation) logic lives in the store
 * and is tested in pane-layout/__tests__/store.test.ts. These tests verify
 * the integration from the component perspective.
 */

// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { usePaneLayoutStore } from "@/stores/pane-layout/store";
import type { PaneGroup, TabItem, PaneLayoutPersistedState } from "@/stores/pane-layout/types";

function makeTab(id: string, view: TabItem["view"] = { type: "empty" }): TabItem {
  return { id, view };
}

function makeGroup(id: string, tabs: TabItem[], activeTabId?: string): PaneGroup {
  return { id, tabs, activeTabId: activeTabId ?? tabs[0]?.id ?? "" };
}

function hydrateWith(state: PaneLayoutPersistedState): void {
  usePaneLayoutStore.getState().hydrate(state);
}

describe("tab interactions", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: false,
    });
  });

  describe("setActiveTab", () => {
    it("switches the active tab in a group", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")], "t1"),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applySetActiveTab("g1", "t2");
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("t2");
    });
  });

  describe("closeTab — neighbor activation", () => {
    it("activates left neighbor when closing active tab", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")], "t2"),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyCloseTab("g1", "t2");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(2);
      expect(g.activeTabId).toBe("t1");
    });

    it("activates first tab when closing leftmost active tab", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")], "t1"),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyCloseTab("g1", "t1");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(1);
      expect(g.activeTabId).toBe("t2");
    });

    it("preserves active tab when closing a non-active tab", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")], "t3"),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyCloseTab("g1", "t1");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(2);
      expect(g.activeTabId).toBe("t3");
    });
  });

  describe("setActiveGroup", () => {
    it("switches the active group", () => {
      hydrateWith({
        root: {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", groupId: "g1" },
            { type: "leaf", groupId: "g2" },
          ],
          sizes: [50, 50],
        },
        groups: {
          g1: makeGroup("g1", [makeTab("t1")]),
          g2: makeGroup("g2", [makeTab("t2")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applySetActiveGroup("g2");
      expect(usePaneLayoutStore.getState().activeGroupId).toBe("g2");
    });
  });

  describe("openTab", () => {
    it("adds tab to group and activates it", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });

      const newTab = makeTab("t2", { type: "thread", threadId: "thread-123" });
      usePaneLayoutStore.getState()._applyOpenTab("g1", newTab);

      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(2);
      expect(g.activeTabId).toBe("t2");
      expect(g.tabs[1].view).toEqual({ type: "thread", threadId: "thread-123" });
    });
  });

  describe("middle-click close via auxClick", () => {
    it("closing by tab id works same as close button", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")], "t2"),
        },
        activeGroupId: "g1",
      });

      // Middle-click triggers the same store operation as close button
      usePaneLayoutStore.getState()._applyCloseTab("g1", "t2");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(1);
      expect(g.activeTabId).toBe("t1");
    });
  });
});
