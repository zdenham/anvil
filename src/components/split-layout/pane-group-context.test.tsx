import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePaneGroup, usePaneGroupMaybe, PaneGroupProvider } from "./pane-group-context";
import { usePaneLayoutStore } from "@/stores/pane-layout/store";

vi.mock("@/lib/logger-client", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/app-data-store", () => ({
  appData: {
    readJson: vi.fn().mockResolvedValue(null),
    writeJson: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("PaneGroupContext", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "g1" },
      groups: {
        g1: { id: "g1", tabs: [{ id: "t1", view: { type: "empty" } }], activeTabId: "t1" },
        g2: { id: "g2", tabs: [{ id: "t2", view: { type: "empty" } }], activeTabId: "t2" },
      },
      activeGroupId: "g1",
      _hydrated: true,
    });
  });

  it("usePaneGroup returns groupId and activate", () => {
    const { result } = renderHook(() => usePaneGroup(), {
      wrapper: ({ children }) => (
        <PaneGroupProvider groupId="g2">{children}</PaneGroupProvider>
      ),
    });
    expect(result.current.groupId).toBe("g2");
    expect(typeof result.current.activate).toBe("function");
  });

  it("activate calls setActiveGroup when group is not active", () => {
    const { result } = renderHook(() => usePaneGroup(), {
      wrapper: ({ children }) => (
        <PaneGroupProvider groupId="g2">{children}</PaneGroupProvider>
      ),
    });
    result.current.activate();
    expect(usePaneLayoutStore.getState().activeGroupId).toBe("g2");
  });

  it("activate is a no-op when group is already active", () => {
    const { result } = renderHook(() => usePaneGroup(), {
      wrapper: ({ children }) => (
        <PaneGroupProvider groupId="g1">{children}</PaneGroupProvider>
      ),
    });
    result.current.activate();
    expect(usePaneLayoutStore.getState().activeGroupId).toBe("g1");
  });

  it("usePaneGroup throws outside provider", () => {
    expect(() => {
      renderHook(() => usePaneGroup());
    }).toThrow("usePaneGroup must be used within PaneGroupProvider");
  });

  it("usePaneGroupMaybe returns null outside provider", () => {
    const { result } = renderHook(() => usePaneGroupMaybe());
    expect(result.current).toBeNull();
  });
});
