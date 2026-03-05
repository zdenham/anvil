/**
 * Tests for tab drag-and-drop handler logic.
 *
 * Verifies store-level operations that the DnD handlers invoke:
 * within-group reordering, cross-group moves, and split-on-drop.
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

function hydrate(state: PaneLayoutPersistedState): void {
  usePaneLayoutStore.getState().hydrate(state);
}

describe("tab DnD handlers", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: false,
    });
  });

  describe("within-group reorder (_applyReorderTabs)", () => {
    it("reorders tabs in a group", () => {
      hydrate({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyReorderTabs("g1", ["t3", "t1", "t2"]);
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
    });

    it("preserves active tab after reorder", () => {
      hydrate({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")], "t2"),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyReorderTabs("g1", ["t3", "t2", "t1"]);
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.activeTabId).toBe("t2");
    });

    it("is a no-op for unknown group", () => {
      hydrate({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyReorderTabs("unknown", ["t2", "t1"]);
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    });

    it("provides rollback to previous order", () => {
      hydrate({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      const rollback = usePaneLayoutStore.getState()._applyReorderTabs("g1", ["t3", "t1", "t2"]);
      rollback();
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    });
  });

  describe("cross-group move (_applyMoveTab)", () => {
    it("moves a tab from one group to another", () => {
      hydrate({
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
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")]),
          g2: makeGroup("g2", [makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyMoveTab("g1", "t1", "g2", 0);

      const g1 = usePaneLayoutStore.getState().groups.g1;
      const g2 = usePaneLayoutStore.getState().groups.g2;
      expect(g1.tabs.map((t) => t.id)).toEqual(["t2"]);
      expect(g2.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    });

    it("activates the moved tab in the target group", () => {
      hydrate({
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
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")]),
          g2: makeGroup("g2", [makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyMoveTab("g1", "t2", "g2", 1);
      const g2 = usePaneLayoutStore.getState().groups.g2;
      expect(g2.activeTabId).toBe("t2");
    });

    it("updates source group active tab when active tab is moved", () => {
      hydrate({
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
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")], "t1"),
          g2: makeGroup("g2", [makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyMoveTab("g1", "t1", "g2", 0);
      const g1 = usePaneLayoutStore.getState().groups.g1;
      expect(g1.activeTabId).toBe("t2");
    });

    it("inserts at the specified index", () => {
      hydrate({
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
          g2: makeGroup("g2", [makeTab("t2"), makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      usePaneLayoutStore.getState()._applyMoveTab("g1", "t1", "g2", 1);
      const g2 = usePaneLayoutStore.getState().groups.g2;
      expect(g2.tabs.map((t) => t.id)).toEqual(["t2", "t1", "t3"]);
    });
  });

  describe("split-on-drop (_applySplitGroup)", () => {
    it("splits a leaf into two groups", () => {
      hydrate({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: makeGroup("g1", [makeTab("t1")]),
        },
        activeGroupId: "g1",
      });

      const newGroup = makeGroup("g2", [makeTab("t2")]);
      usePaneLayoutStore.getState()._applySplitGroup("g1", "horizontal", newGroup);

      const state = usePaneLayoutStore.getState();
      expect(state.root.type).toBe("split");
      if (state.root.type === "split") {
        expect(state.root.direction).toBe("horizontal");
        expect(state.root.children).toHaveLength(2);
      }
      expect(state.groups.g2).toBeDefined();
    });

    it("can split and then move a tab into the new group", () => {
      hydrate({
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
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")]),
          g2: makeGroup("g2", [makeTab("t3")]),
        },
        activeGroupId: "g1",
      });

      // Simulate edge drop: split g2 vertically, then move t1 into the new group
      const newGroup = makeGroup("g3", [makeTab("placeholder")]);
      usePaneLayoutStore.getState()._applySplitGroup("g2", "vertical", newGroup);
      usePaneLayoutStore.getState()._applyMoveTab("g1", "t1", "g3", 0);

      const g1 = usePaneLayoutStore.getState().groups.g1;
      const g3 = usePaneLayoutStore.getState().groups.g3;
      expect(g1.tabs.map((t) => t.id)).toEqual(["t2"]);
      expect(g3.tabs.map((t) => t.id)).toEqual(["t1", "placeholder"]);
    });
  });
});
