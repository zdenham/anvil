import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRightPanel } from "./use-right-panel";

describe("useRightPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any remaining event listeners
  });

  it("starts with none state", () => {
    const { result } = renderHook(() => useRightPanel());

    expect(result.current.state).toEqual({ type: "none" });
    expect(result.current.fileBrowserWorktreeId).toBeNull();
  });

  it("opens file browser for a worktree", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });

    expect(result.current.state).toEqual({
      type: "file-browser",
      rootPath: "/path/to/worktree",
      repoId: "repo-1",
      worktreeId: "wt-1",
    });
    expect(result.current.fileBrowserWorktreeId).toBe("wt-1");
  });

  it("toggles off when clicking same worktree", () => {
    const { result } = renderHook(() => useRightPanel());

    // Open
    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.state.type).toBe("file-browser");

    // Toggle off by clicking same worktree
    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.state).toEqual({ type: "none" });
    expect(result.current.fileBrowserWorktreeId).toBeNull();
  });

  it("switches worktrees when clicking different worktree", () => {
    const { result } = renderHook(() => useRightPanel());

    // Open for worktree 1
    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/wt1");
    });
    expect(result.current.fileBrowserWorktreeId).toBe("wt-1");

    // Switch to worktree 2
    act(() => {
      result.current.openFileBrowser("repo-1", "wt-2", "/path/to/wt2");
    });
    expect(result.current.state).toEqual({
      type: "file-browser",
      rootPath: "/path/to/wt2",
      repoId: "repo-1",
      worktreeId: "wt-2",
    });
    expect(result.current.fileBrowserWorktreeId).toBe("wt-2");
  });

  it("closes via close()", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.state.type).toBe("file-browser");

    act(() => {
      result.current.close();
    });
    expect(result.current.state).toEqual({ type: "none" });
  });

  it("opens search panel", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openSearch();
    });

    expect(result.current.state).toEqual({ type: "search" });
    expect(result.current.fileBrowserWorktreeId).toBeNull();
  });

  it("does not change state when search is already open", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openSearch();
    });
    const firstState = result.current.state;

    act(() => {
      result.current.openSearch();
    });
    // Same reference — setState returned prev
    expect(result.current.state).toBe(firstState);
  });

  it("openSearch closes file browser", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.state.type).toBe("file-browser");

    act(() => {
      result.current.openSearch();
    });
    expect(result.current.state).toEqual({ type: "search" });
    expect(result.current.fileBrowserWorktreeId).toBeNull();
  });

  it("openFileBrowser closes search panel", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openSearch();
    });
    expect(result.current.state.type).toBe("search");

    act(() => {
      result.current.openFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.state).toEqual({
      type: "file-browser",
      rootPath: "/path/to/worktree",
      repoId: "repo-1",
      worktreeId: "wt-1",
    });
  });

  it("close works from search state", () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => {
      result.current.openSearch();
    });
    expect(result.current.state.type).toBe("search");

    act(() => {
      result.current.close();
    });
    expect(result.current.state).toEqual({ type: "none" });
  });
});
