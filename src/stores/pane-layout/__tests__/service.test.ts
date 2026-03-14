// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePaneLayoutStore } from "../store";
import { paneLayoutService } from "../service";
import type { PaneLayoutPersistedState } from "@core/types/pane-layout.js";

// Mock appData (disk operations)
vi.mock("@/lib/app-data-store", () => ({
  appData: {
    readJson: vi.fn().mockResolvedValue(null),
    writeJson: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function seedState(state: PaneLayoutPersistedState): void {
  usePaneLayoutStore.getState().hydrate(state);
}

function makeSimpleState(): PaneLayoutPersistedState {
  return {
    root: { type: "leaf", groupId: "g1" },
    groups: {
      g1: {
        id: "g1",
        tabs: [{ id: "t1", view: { type: "empty" } }],
        activeTabId: "t1",
      },
    },
    activeGroupId: "g1",
  };
}

describe("paneLayoutService", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: false,
    });
    vi.clearAllMocks();
  });

  describe("hydrate", () => {
    it("creates default state when disk is empty", async () => {
      await paneLayoutService.hydrate();
      const s = usePaneLayoutStore.getState();
      expect(s._hydrated).toBe(true);
      expect(Object.keys(s.groups)).toHaveLength(1);
    });

    it("loads valid state from disk", async () => {
      const { appData } = await import("@/lib/app-data-store");
      vi.mocked(appData.readJson).mockResolvedValueOnce(makeSimpleState());
      await paneLayoutService.hydrate();
      expect(usePaneLayoutStore.getState().groups.g1).toBeDefined();
    });
  });

  describe("openTab", () => {
    it("opens a tab in the active group", async () => {
      seedState(makeSimpleState());
      const tabId = await paneLayoutService.openTab({ type: "settings" });
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(2);
      expect(g.activeTabId).toBe(tabId);
    });

    it("closes leftmost tab when at max capacity (5)", async () => {
      const tabs = Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        view: { type: "empty" as const },
      }));
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: { g1: { id: "g1", tabs, activeTabId: "t4" } },
        activeGroupId: "g1",
      });
      await paneLayoutService.openTab({ type: "settings" });
      const g = usePaneLayoutStore.getState().groups.g1;
      // t0 was closed, new tab added, so still 5
      expect(g.tabs).toHaveLength(5);
      expect(g.tabs.find((t) => t.id === "t0")).toBeUndefined();
    });
  });

  describe("closeTab", () => {
    it("closes a tab and activates left neighbor", async () => {
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              { id: "t1", view: { type: "empty" } },
              { id: "t2", view: { type: "empty" } },
            ],
            activeTabId: "t2",
          },
        },
        activeGroupId: "g1",
      });
      await paneLayoutService.closeTab("g1", "t2");
      const g = usePaneLayoutStore.getState().groups.g1;
      expect(g.tabs).toHaveLength(1);
      expect(g.activeTabId).toBe("t1");
    });

    it("resets to default when closing the last tab in the last group", async () => {
      seedState(makeSimpleState());
      await paneLayoutService.closeTab("g1", "t1");
      const s = usePaneLayoutStore.getState();
      // Should have been reset to default state with 1 group, 1 tab
      expect(Object.keys(s.groups)).toHaveLength(1);
      const group = Object.values(s.groups)[0];
      expect(group.tabs).toHaveLength(1);
      expect(group.tabs[0].view.type).toBe("empty");
    });
  });

  describe("setActiveTab", () => {
    it("sets active tab", async () => {
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              { id: "t1", view: { type: "empty" } },
              { id: "t2", view: { type: "empty" } },
            ],
            activeTabId: "t1",
          },
        },
        activeGroupId: "g1",
      });
      await paneLayoutService.setActiveTab("g1", "t2");
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("t2");
    });
  });

  describe("setActiveTabView", () => {
    it("updates the active tab view", async () => {
      seedState(makeSimpleState());
      await paneLayoutService.setActiveTabView({ type: "settings" });
      expect(usePaneLayoutStore.getState().groups.g1.tabs[0].view.type).toBe("settings");
    });
  });

  describe("splitGroup", () => {
    it("splits a group and returns new group id", async () => {
      seedState(makeSimpleState());
      const newGroupId = await paneLayoutService.splitGroup("g1", "horizontal");
      expect(usePaneLayoutStore.getState().groups[newGroupId]).toBeDefined();
      expect(usePaneLayoutStore.getState().root.type).toBe("split");
    });

    it("activates the new group after split", async () => {
      seedState(makeSimpleState());
      expect(usePaneLayoutStore.getState().activeGroupId).toBe("g1");
      const newGroupId = await paneLayoutService.splitGroup("g1", "horizontal");
      expect(usePaneLayoutStore.getState().activeGroupId).toBe(newGroupId);
    });
  });

  describe("splitAndMoveTab", () => {
    it("activates the new group after split-and-move", async () => {
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              { id: "t1", view: { type: "empty" } },
              { id: "t2", view: { type: "settings" } },
            ],
            activeTabId: "t1",
          },
        },
        activeGroupId: "g1",
      });
      const newGroupId = await paneLayoutService.splitAndMoveTab("g1", "horizontal", "g1", "t2");
      expect(newGroupId).not.toBe("");
      expect(usePaneLayoutStore.getState().activeGroupId).toBe(newGroupId);
    });
  });

  describe("findOrOpenTab", () => {
    it("focuses existing tab when view matches", async () => {
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              { id: "t1", view: { type: "thread", threadId: "th1" } },
              { id: "t2", view: { type: "empty" } },
            ],
            activeTabId: "t2",
          },
        },
        activeGroupId: "g1",
      });
      await paneLayoutService.findOrOpenTab({ type: "thread", threadId: "th1" });
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("t1");
    });

    it("replaces active tab when no match and newTab not set", async () => {
      seedState(makeSimpleState());
      await paneLayoutService.findOrOpenTab({ type: "settings" });
      expect(usePaneLayoutStore.getState().groups.g1.tabs[0].view.type).toBe("settings");
    });

    it("opens new tab when newTab option is set", async () => {
      seedState(makeSimpleState());
      await paneLayoutService.findOrOpenTab({ type: "settings" }, { newTab: true });
      expect(usePaneLayoutStore.getState().groups.g1.tabs).toHaveLength(2);
    });
  });

  describe("findOrOpenTab – changes views with different commits", () => {
    it("replaces tab when commit hash differs", async () => {
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              {
                id: "t1",
                view: { type: "changes", repoId: "r1", worktreeId: "w1", uncommittedOnly: true },
              },
            ],
            activeTabId: "t1",
          },
        },
        activeGroupId: "g1",
      });
      await paneLayoutService.findOrOpenTab({
        type: "changes",
        repoId: "r1",
        worktreeId: "w1",
        commitHash: "abc123",
      });
      const tab = usePaneLayoutStore.getState().groups.g1.tabs[0];
      expect(tab.view.type).toBe("changes");
      if (tab.view.type === "changes") {
        expect(tab.view.commitHash).toBe("abc123");
      }
    });

    it("activates existing tab when same commit hash", async () => {
      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              {
                id: "t1",
                view: { type: "changes", repoId: "r1", worktreeId: "w1", commitHash: "abc123" },
              },
              { id: "t2", view: { type: "empty" } },
            ],
            activeTabId: "t2",
          },
        },
        activeGroupId: "g1",
      });
      await paneLayoutService.findOrOpenTab({
        type: "changes",
        repoId: "r1",
        worktreeId: "w1",
        commitHash: "abc123",
      });
      expect(usePaneLayoutStore.getState().groups.g1.activeTabId).toBe("t1");
    });
  });

  describe("setActiveGroup", () => {
    it("changes active group", async () => {
      seedState({
        root: { type: "split", direction: "horizontal", children: [{ type: "leaf", groupId: "g1" }, { type: "leaf", groupId: "g2" }], sizes: [50, 50] },
        groups: {
          g1: { id: "g1", tabs: [{ id: "t1", view: { type: "empty" } }], activeTabId: "t1" },
          g2: { id: "g2", tabs: [{ id: "t2", view: { type: "empty" } }], activeTabId: "t2" },
        },
        activeGroupId: "g1",
      });
      await paneLayoutService.setActiveGroup("g2");
      expect(usePaneLayoutStore.getState().activeGroupId).toBe("g2");
    });
  });

  describe("persistence round-trip", () => {
    it("complex split state survives save and re-hydrate", async () => {
      const { appData } = await import("@/lib/app-data-store");

      const complexState: PaneLayoutPersistedState = {
        root: {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", groupId: "g1" },
            {
              type: "split",
              direction: "vertical",
              children: [
                { type: "leaf", groupId: "g2" },
                { type: "leaf", groupId: "g3" },
              ],
              sizes: [60, 40],
            },
          ],
          sizes: [50, 50],
        },
        groups: {
          g1: {
            id: "g1",
            tabs: [
              { id: "t1", view: { type: "thread", threadId: "th1" } },
              { id: "t2", view: { type: "settings" } },
            ],
            activeTabId: "t1",
          },
          g2: {
            id: "g2",
            tabs: [{ id: "t3", view: { type: "plan", planId: "p1" } }],
            activeTabId: "t3",
          },
          g3: {
            id: "g3",
            tabs: [{ id: "t4", view: { type: "empty" } }],
            activeTabId: "t4",
          },
        },
        activeGroupId: "g2",
      };

      // Capture what gets written to disk
      let savedState: PaneLayoutPersistedState | null = null;
      vi.mocked(appData.writeJson).mockImplementation(async (_path, data) => {
        savedState = data as PaneLayoutPersistedState;
      });

      // Seed and trigger a persist via openTab
      seedState(complexState);
      await paneLayoutService.openTab({ type: "logs" }, "g1");

      expect(savedState).not.toBeNull();

      // Reset store and re-hydrate from what was saved
      usePaneLayoutStore.setState({
        root: { type: "leaf", groupId: "" },
        groups: {},
        activeGroupId: "",
        _hydrated: false,
      });
      vi.mocked(appData.readJson).mockResolvedValueOnce(savedState);
      await paneLayoutService.hydrate();

      const s = usePaneLayoutStore.getState();
      expect(Object.keys(s.groups)).toHaveLength(3);
      expect(s.activeGroupId).toBe("g2");
      expect(s.root.type).toBe("split");
      if (s.root.type === "split") {
        expect(s.root.children).toHaveLength(2);
        expect(s.root.sizes).toEqual([50, 50]);
      }
    });

    it("strips autoFocus ephemeral field on save", async () => {
      const { appData } = await import("@/lib/app-data-store");

      let savedState: PaneLayoutPersistedState | null = null;
      vi.mocked(appData.writeJson).mockImplementation(async (_path, data) => {
        savedState = data as PaneLayoutPersistedState;
      });

      seedState({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [{ id: "t1", view: { type: "thread", threadId: "th1", autoFocus: true } }],
            activeTabId: "t1",
          },
        },
        activeGroupId: "g1",
      });

      // Trigger persist
      await paneLayoutService.setActiveTab("g1", "t1");

      expect(savedState).not.toBeNull();
      const tab = savedState!.groups.g1.tabs[0];
      expect(tab.view.type).toBe("thread");
      if (tab.view.type === "thread") {
        expect(tab.view.autoFocus).toBeUndefined();
      }
    });

    it("falls back to default state on invalid JSON", async () => {
      const { appData } = await import("@/lib/app-data-store");
      vi.mocked(appData.readJson).mockResolvedValueOnce({ garbage: true });

      await paneLayoutService.hydrate();

      const s = usePaneLayoutStore.getState();
      expect(s._hydrated).toBe(true);
      expect(Object.keys(s.groups)).toHaveLength(1);
      const group = Object.values(s.groups)[0];
      expect(group.tabs).toHaveLength(1);
      expect(group.tabs[0].view.type).toBe("empty");
    });
  });
});
