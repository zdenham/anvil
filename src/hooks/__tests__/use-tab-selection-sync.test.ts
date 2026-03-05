/**
 * useTabSelectionSync Tests
 *
 * Verifies that tree sidebar selection updates when the active tab changes
 * in the pane layout store (e.g., user clicks a different tab directly).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/stores/tree-menu/service", () => ({
  treeMenuService: {
    setSelectedItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// Use real zustand store to test subscription behavior
vi.mock("@/stores/pane-layout", async () => {
  const { create } = await import("zustand");

  const store = create(() => ({
    activeGroupId: "group-1",
    groups: {
      "group-1": {
        id: "group-1",
        tabs: [
          { id: "tab-1", view: { type: "thread" as const, threadId: "t-1" } },
          { id: "tab-2", view: { type: "plan" as const, planId: "p-1" } },
        ],
        activeTabId: "tab-1",
      },
    },
  }));

  return { usePaneLayoutStore: store };
});

import { treeMenuService } from "@/stores/tree-menu/service";
import { usePaneLayoutStore } from "@/stores/pane-layout";
import { useTabSelectionSync } from "../use-tab-selection-sync";

describe("useTabSelectionSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    usePaneLayoutStore.setState({
      activeGroupId: "group-1",
      groups: {
        "group-1": {
          id: "group-1",
          tabs: [
            { id: "tab-1", view: { type: "thread", threadId: "t-1" } },
            { id: "tab-2", view: { type: "plan", planId: "p-1" } },
          ],
          activeTabId: "tab-1",
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("syncs tree selection when active tab changes", () => {
    renderHook(() => useTabSelectionSync());

    // Zustand subscribe only fires on changes, not on mount
    expect(treeMenuService.setSelectedItem).not.toHaveBeenCalled();

    // Change active tab to plan tab
    act(() => {
      usePaneLayoutStore.setState((s) => ({
        groups: {
          ...s.groups,
          "group-1": { ...s.groups["group-1"], activeTabId: "tab-2" },
        },
      }));
    });

    expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("p-1");
  });

  it("sets null for non-tree-item views (settings)", () => {
    renderHook(() => useTabSelectionSync());
    vi.clearAllMocks();

    act(() => {
      usePaneLayoutStore.setState((s) => ({
        groups: {
          ...s.groups,
          "group-1": {
            ...s.groups["group-1"],
            tabs: [
              ...s.groups["group-1"].tabs,
              { id: "tab-3", view: { type: "settings" } },
            ],
            activeTabId: "tab-3",
          },
        },
      }));
    });

    expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith(null);
  });

  it("does not re-sync when the same view is set again", () => {
    renderHook(() => useTabSelectionSync());

    // Trigger a change first to populate prevViewRef
    act(() => {
      usePaneLayoutStore.setState((s) => ({
        groups: {
          ...s.groups,
          "group-1": { ...s.groups["group-1"], activeTabId: "tab-2" },
        },
      }));
    });

    expect(treeMenuService.setSelectedItem).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    // Set state without changing the active view (same tab-2 still active)
    act(() => {
      usePaneLayoutStore.setState((s) => ({
        groups: { ...s.groups },
      }));
    });

    // Should not call again since the view hasn't changed
    expect(treeMenuService.setSelectedItem).not.toHaveBeenCalled();
  });

  it("syncs selection when active group changes", () => {
    // Add a second group
    usePaneLayoutStore.setState({
      activeGroupId: "group-1",
      groups: {
        "group-1": {
          id: "group-1",
          tabs: [{ id: "tab-1", view: { type: "thread", threadId: "t-1" } }],
          activeTabId: "tab-1",
        },
        "group-2": {
          id: "group-2",
          tabs: [{ id: "tab-a", view: { type: "terminal", terminalId: "term-1" } }],
          activeTabId: "tab-a",
        },
      },
    });

    renderHook(() => useTabSelectionSync());
    vi.clearAllMocks();

    // Switch active group
    act(() => {
      usePaneLayoutStore.setState({ activeGroupId: "group-2" });
    });

    expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("term-1");
  });
});
