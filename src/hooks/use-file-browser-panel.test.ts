import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileBrowserPanel } from "./use-file-browser-panel";

describe("useFileBrowserPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any remaining event listeners
  });

  it("starts with null context", () => {
    const { result } = renderHook(() => useFileBrowserPanel());

    expect(result.current.fileBrowserContext).toBeNull();
    expect(result.current.fileBrowserWorktreeId).toBeNull();
  });

  it("opens file browser for a worktree", () => {
    const { result } = renderHook(() => useFileBrowserPanel());

    act(() => {
      result.current.handleOpenFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });

    expect(result.current.fileBrowserContext).toEqual({
      rootPath: "/path/to/worktree",
      repoId: "repo-1",
      worktreeId: "wt-1",
    });
    expect(result.current.fileBrowserWorktreeId).toBe("wt-1");
  });

  it("toggles off when clicking same worktree", () => {
    const { result } = renderHook(() => useFileBrowserPanel());

    // Open
    act(() => {
      result.current.handleOpenFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.fileBrowserContext).not.toBeNull();

    // Toggle off by clicking same worktree
    act(() => {
      result.current.handleOpenFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.fileBrowserContext).toBeNull();
    expect(result.current.fileBrowserWorktreeId).toBeNull();
  });

  it("switches worktrees when clicking different worktree", () => {
    const { result } = renderHook(() => useFileBrowserPanel());

    // Open for worktree 1
    act(() => {
      result.current.handleOpenFileBrowser("repo-1", "wt-1", "/path/to/wt1");
    });
    expect(result.current.fileBrowserWorktreeId).toBe("wt-1");

    // Switch to worktree 2
    act(() => {
      result.current.handleOpenFileBrowser("repo-1", "wt-2", "/path/to/wt2");
    });
    expect(result.current.fileBrowserContext).toEqual({
      rootPath: "/path/to/wt2",
      repoId: "repo-1",
      worktreeId: "wt-2",
    });
    expect(result.current.fileBrowserWorktreeId).toBe("wt-2");
  });

  it("closes via closeFileBrowser", () => {
    const { result } = renderHook(() => useFileBrowserPanel());

    act(() => {
      result.current.handleOpenFileBrowser("repo-1", "wt-1", "/path/to/worktree");
    });
    expect(result.current.fileBrowserContext).not.toBeNull();

    act(() => {
      result.current.closeFileBrowser();
    });
    expect(result.current.fileBrowserContext).toBeNull();
  });

});
