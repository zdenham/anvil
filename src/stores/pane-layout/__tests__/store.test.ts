// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { usePaneLayoutStore, getActiveGroup, getActiveTab, getVisibleThreadIds } from "../store";
import type { PaneGroup, TabItem, PaneLayoutPersistedState } from "../types";

function makeTab(id: string, view: TabItem["view"] = { type: "empty" }): TabItem {
  return { id, view };
}

function makeGroup(id: string, tabs: TabItem[], activeTabId?: string): PaneGroup {
  return { id, tabs, activeTabId: activeTabId ?? tabs[0]?.id ?? "" };
}

function hydrateWith(state: PaneLayoutPersistedState): void {
  usePaneLayoutStore.getState().hydrate(state);
}

describe("usePaneLayoutStore", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: false,
    });
  });

  describe("hydrate", () => {
    it("sets state and marks hydrated", () => {
      const state: PaneLayoutPersistedState = {
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      };
      hydrateWith(state);
      const s = usePaneLayoutStore.getState();
      expect(s._hydrated).toBe(true);
      expect(s.activeGroupId).toBe("g1");
      expect(s.groups.g1.tabs).toHaveLength(1);
    });
  });

  describe("_applyOpenTab", () => {
    it("adds tab and makes it active by default", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      const tab = makeTab("t2");
      usePaneLayoutStore.getState()._applyOpenTab("g1", tab);
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(2);
      expect(g.activeTabId).toBe("t2");
    });

    it("does not change active when makeActive is false", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applyOpenTab("g1", makeTab("t2"), false);
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("t1");
    });

    it("rollback removes the tab", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      const rollback = usePaneLayoutStore.getState()._applyOpenTab("g1", makeTab("t2"));
      rollback();
      expect(usePaneLayoutStore.getState().groups.g1.tabs).toHaveLength(1);
    });
  });

  describe("_applyCloseTab", () => {
    it("removes tab and activates left neighbor", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")], "t2") },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applyCloseTab("g1", "t2");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(2);
      expect(g.activeTabId).toBe("t1");
    });

    it("activates first tab when closing index 0", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")], "t1") },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applyCloseTab("g1", "t1");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.activeTabId).toBe("t2");
    });

    it("sets empty activeTabId when closing last tab", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applyCloseTab("g1", "t1");
      expect(usePaneLayoutStore.getState().groups.g1.tabs).toHaveLength(0);
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("");
    });
  });

  describe("_applySetActiveTab", () => {
    it("changes active tab", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")]) },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applySetActiveTab("g1", "t2");
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("t2");
    });
  });

  describe("_applySetTabView", () => {
    it("updates tab view", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applySetTabView("g1", "t1", { type: "settings" });
      expect(usePaneLayoutStore.getState().groups.g1.tabs[0].view.type).toBe("settings");
    });
  });

  describe("_applyMoveTab", () => {
    it("moves tab between groups", () => {
      hydrateWith({
        root: { type: "split", direction: "horizontal", children: [{ type: "leaf", groupId: "g1" }, { type: "leaf", groupId: "g2" }], sizes: [50, 50] },
        groups: {
          g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")]),
          g2: makeGroup("g2", [makeTab("t3")]),
        },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applyMoveTab("g1", "t2", "g2", 0);
      expect(usePaneLayoutStore.getState().groups.g1.tabs).toHaveLength(1);
      expect(usePaneLayoutStore.getState().groups.g2.tabs).toHaveLength(2);
      expect(usePaneLayoutStore.getState().groups.g2.tabs[0].id).toBe("t2");
    });
  });

  describe("_applyReorderTabs", () => {
    it("reorders tabs", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1"), makeTab("t2"), makeTab("t3")]) },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applyReorderTabs("g1", ["t3", "t1", "t2"]);
      const ids = usePaneLayoutStore.getState().groups.g1.tabs.map((t) => t.id);
      expect(ids).toEqual(["t3", "t1", "t2"]);
    });
  });

  describe("_applySetActiveGroup", () => {
    it("changes active group", () => {
      hydrateWith({
        root: { type: "split", direction: "horizontal", children: [{ type: "leaf", groupId: "g1" }, { type: "leaf", groupId: "g2" }], sizes: [50, 50] },
        groups: { g1: makeGroup("g1", [makeTab("t1")]), g2: makeGroup("g2", [makeTab("t2")]) },
        activeGroupId: "g1",
      });
      usePaneLayoutStore.getState()._applySetActiveGroup("g2");
      expect(usePaneLayoutStore.getState().activeGroupId).toBe("g2");
    });
  });

  describe("_applyCreateGroup / _applyRemoveGroup", () => {
    it("adds and removes groups", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      const newGroup = makeGroup("g2", [makeTab("t2")]);
      usePaneLayoutStore.getState()._applyCreateGroup(newGroup);
      expect(usePaneLayoutStore.getState().groups.g2).toBeDefined();

      usePaneLayoutStore.getState()._applyRemoveGroup("g2");
      expect(usePaneLayoutStore.getState().groups.g2).toBeUndefined();
    });
  });

  describe("_applySplitGroup", () => {
    it("splits a leaf into two children", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      const newGroup = makeGroup("g2", [makeTab("t2")]);
      usePaneLayoutStore.getState()._applySplitGroup("g1", "horizontal", newGroup);

      const root = usePaneLayoutStore.getState().root;
      expect(root.type).toBe("split");
      if (root.type === "split") {
        expect(root.children).toHaveLength(2);
        expect(root.direction).toBe("horizontal");
      }
      expect(usePaneLayoutStore.getState().groups.g2).toBeDefined();
    });
  });

  describe("selectors", () => {
    it("getActiveGroup returns the active group", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1")]) },
        activeGroupId: "g1",
      });
      expect(getActiveGroup()?.id).toBe("g1");
    });

    it("getActiveTab returns the active tab in the active group", () => {
      hydrateWith({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: makeGroup("g1", [makeTab("t1"), makeTab("t2")], "t2") },
        activeGroupId: "g1",
      });
      expect(getActiveTab()?.id).toBe("t2");
    });

    it("getVisibleThreadIds returns thread IDs from active tabs", () => {
      hydrateWith({
        root: { type: "split", direction: "horizontal", children: [{ type: "leaf", groupId: "g1" }, { type: "leaf", groupId: "g2" }], sizes: [50, 50] },
        groups: {
          g1: makeGroup("g1", [makeTab("t1", { type: "thread", threadId: "th1" })]),
          g2: makeGroup("g2", [makeTab("t2", { type: "settings" })]),
        },
        activeGroupId: "g1",
      });
      expect(getVisibleThreadIds()).toEqual(["th1"]);
    });
  });
});
