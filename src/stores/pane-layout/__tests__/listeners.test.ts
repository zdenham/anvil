// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePaneLayoutStore } from "../store";
import type { PaneLayoutPersistedState } from "../types";

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

// Capture event handlers registered on eventBus
const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
vi.mock("@/entities/events", () => ({
  eventBus: {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
    }),
  },
}));

function seedState(state: PaneLayoutPersistedState): void {
  usePaneLayoutStore.getState().hydrate(state);
}

function makeTwoGroupState(): PaneLayoutPersistedState {
  return {
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
      g1: {
        id: "g1",
        tabs: [
          { id: "t1", view: { type: "thread", threadId: "thread-1" } },
          { id: "t2", view: { type: "settings" } },
        ],
        activeTabId: "t1",
      },
      g2: {
        id: "g2",
        tabs: [
          { id: "t3", view: { type: "thread", threadId: "thread-1" } },
          { id: "t4", view: { type: "plan", planId: "plan-1" } },
        ],
        activeTabId: "t3",
      },
    },
    activeGroupId: "g1",
  };
}

describe("setupPaneLayoutListeners", () => {
  beforeEach(async () => {
    // Clear event handlers
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: false,
    });
    vi.clearAllMocks();

    // Import fresh to register listeners
    const { setupPaneLayoutListeners } = await import("../listeners");
    setupPaneLayoutListeners();
  });

  it("registers handlers for THREAD_ARCHIVED, PLAN_ARCHIVED, and TERMINAL_ARCHIVED", () => {
    expect(eventHandlers["thread:archived"]).toBeDefined();
    expect(eventHandlers["plan:archived"]).toBeDefined();
    expect(eventHandlers["terminal:archived"]).toBeDefined();
  });

  it("closes all tabs matching archived thread across groups", async () => {
    seedState(makeTwoGroupState());

    // Fire thread archived event
    const handler = eventHandlers["thread:archived"]?.[0];
    expect(handler).toBeDefined();
    handler!({ threadId: "thread-1" });

    // Wait for async closeTab calls
    await vi.waitFor(() => {
      const state = usePaneLayoutStore.getState();
      // t1 and t3 should be closed (both show thread-1)
      const g1 = state.groups.g1;
      const g2Tabs = state.groups.g2?.tabs ?? [];

      // g1 should still exist with only the settings tab
      expect(g1).toBeDefined();
      expect(g1.tabs).toHaveLength(1);
      expect(g1.tabs[0].id).toBe("t2");

      // g2 should still exist with only the plan tab
      expect(g2Tabs).toHaveLength(1);
      expect(g2Tabs[0].id).toBe("t4");
    });
  });

  it("closes all tabs matching archived plan", async () => {
    seedState(makeTwoGroupState());

    const handler = eventHandlers["plan:archived"]?.[0];
    expect(handler).toBeDefined();
    handler!({ planId: "plan-1" });

    await vi.waitFor(() => {
      const state = usePaneLayoutStore.getState();
      const g2 = state.groups.g2;
      expect(g2).toBeDefined();
      // t4 (plan-1) should be closed, t3 remains
      expect(g2.tabs).toHaveLength(1);
      expect(g2.tabs[0].id).toBe("t3");
    });
  });

  it("closes all tabs matching archived terminal across groups", async () => {
    seedState({
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
        g1: {
          id: "g1",
          tabs: [
            { id: "t1", view: { type: "terminal", terminalId: "term-1" } },
            { id: "t2", view: { type: "settings" } },
          ],
          activeTabId: "t1",
        },
        g2: {
          id: "g2",
          tabs: [
            { id: "t3", view: { type: "terminal", terminalId: "term-1" } },
            { id: "t4", view: { type: "plan", planId: "plan-1" } },
          ],
          activeTabId: "t3",
        },
      },
      activeGroupId: "g1",
    });

    const handler = eventHandlers["terminal:archived"]?.[0];
    expect(handler).toBeDefined();
    handler!({ terminalId: "term-1" });

    await vi.waitFor(() => {
      const state = usePaneLayoutStore.getState();
      const g1 = state.groups.g1;
      const g2Tabs = state.groups.g2?.tabs ?? [];

      // g1 should still exist with only the settings tab
      expect(g1).toBeDefined();
      expect(g1.tabs).toHaveLength(1);
      expect(g1.tabs[0].id).toBe("t2");

      // g2 should still exist with only the plan tab
      expect(g2Tabs).toHaveLength(1);
      expect(g2Tabs[0].id).toBe("t4");
    });
  });

  it("resets to default when closing last terminal tab in last group", async () => {
    seedState({
      root: { type: "leaf", groupId: "g1" },
      groups: {
        g1: {
          id: "g1",
          tabs: [{ id: "t1", view: { type: "terminal", terminalId: "term-x" } }],
          activeTabId: "t1",
        },
      },
      activeGroupId: "g1",
    });

    const handler = eventHandlers["terminal:archived"]?.[0];
    handler!({ terminalId: "term-x" });

    await vi.waitFor(() => {
      const state = usePaneLayoutStore.getState();
      const groups = Object.values(state.groups);
      expect(groups).toHaveLength(1);
      expect(groups[0].tabs).toHaveLength(1);
      expect(groups[0].tabs[0].view.type).toBe("empty");
    });
  });

  it("resets to default when closing last tab in last group", async () => {
    seedState({
      root: { type: "leaf", groupId: "g1" },
      groups: {
        g1: {
          id: "g1",
          tabs: [{ id: "t1", view: { type: "thread", threadId: "thread-x" } }],
          activeTabId: "t1",
        },
      },
      activeGroupId: "g1",
    });

    const handler = eventHandlers["thread:archived"]?.[0];
    handler!({ threadId: "thread-x" });

    await vi.waitFor(() => {
      const state = usePaneLayoutStore.getState();
      // Should have reset to default: 1 group, 1 empty tab
      const groups = Object.values(state.groups);
      expect(groups).toHaveLength(1);
      expect(groups[0].tabs).toHaveLength(1);
      expect(groups[0].tabs[0].view.type).toBe("empty");
    });
  });
});
