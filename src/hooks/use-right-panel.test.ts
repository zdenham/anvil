import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRightPanel } from "./use-right-panel";

describe("useRightPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts closed with files tab as default", () => {
    const { result } = renderHook(() => useRightPanel());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeTab).toBe("files");
    expect(result.current.state.filesWorktreeOverride).toBeNull();
  });

  it("toggle opens and closes the panel", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(true);

    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(false);
  });

  it("toggle preserves active tab across close/open", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => { result.current.openSearch(); });
    expect(result.current.activeTab).toBe("search");

    act(() => { result.current.close(); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeTab).toBe("search");

    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeTab).toBe("search");
  });

  it("openTab switches tab and opens panel", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => { result.current.openTab("changelog"); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeTab).toBe("changelog");
  });

  it("openFileBrowser sets files tab with worktree override", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeTab).toBe("files");
    expect(result.current.state.filesWorktreeOverride).toEqual({
      repoId: "repo-1",
      worktreeId: "wt-1",
      rootPath: "/path/to/worktree",
    });
  });

  it("openSearch opens panel on search tab", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => { result.current.openSearch(); });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeTab).toBe("search");
  });

  it("switching away from files tab clears worktree override", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.state.filesWorktreeOverride).not.toBeNull();

    act(() => { result.current.openTab("search"); });
    expect(result.current.state.filesWorktreeOverride).toBeNull();
  });

  it("close preserves active tab but sets isOpen to false", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => { result.current.openTab("changelog"); });
    act(() => { result.current.close(); });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeTab).toBe("changelog");
  });
});
