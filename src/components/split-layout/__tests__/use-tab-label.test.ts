/**
 * Tests for useTabLabel hook — verifies label derivation matches sidebar logic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabLabel } from "../use-tab-label";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import type { ContentPaneView } from "@/components/content-pane/types";

describe("useTabLabel", () => {
  beforeEach(() => {
    // Reset stores to clean state
    useThreadStore.setState({ threads: {}, _threadsArray: [] });
    usePlanStore.setState({ plans: {}, _plansArray: [] });
    useTerminalSessionStore.setState({ sessions: {}, _sessionsArray: [] });
    usePullRequestStore.setState({ pullRequests: {}, _prsArray: [], prDetails: {} });
  });

  it("returns 'New Tab' for empty view", () => {
    const { result } = renderHook(() => useTabLabel({ type: "empty" }));
    expect(result.current).toBe("New Tab");
  });

  it("returns 'Settings' for settings view", () => {
    const { result } = renderHook(() => useTabLabel({ type: "settings" }));
    expect(result.current).toBe("Settings");
  });

  it("returns 'Logs' for logs view", () => {
    const { result } = renderHook(() => useTabLabel({ type: "logs" }));
    expect(result.current).toBe("Logs");
  });

  it("returns 'Archive' for archive view", () => {
    const { result } = renderHook(() => useTabLabel({ type: "archive" }));
    expect(result.current).toBe("Archive");
  });

  it("returns 'Changes' for changes view", () => {
    const view: ContentPaneView = { type: "changes", repoId: "r1", worktreeId: "w1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("Changes");
  });

  it("returns filename for file view", () => {
    const view: ContentPaneView = { type: "file", filePath: "/foo/bar/baz.ts" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("baz.ts");
  });

  it("returns thread name when available", () => {
    useThreadStore.setState({
      threads: {
        "t1": { id: "t1", name: "Fix the bug", status: "idle" } as never,
      },
      _threadsArray: [],
    });
    const view: ContentPaneView = { type: "thread", threadId: "t1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("Fix the bug");
  });

  it("returns 'New Thread' when thread has no name", () => {
    useThreadStore.setState({
      threads: {
        "t1": { id: "t1", status: "idle" } as never,
      },
      _threadsArray: [],
    });
    const view: ContentPaneView = { type: "thread", threadId: "t1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("New Thread");
  });

  it("returns 'New Thread' when thread not found", () => {
    const view: ContentPaneView = { type: "thread", threadId: "nonexistent" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("New Thread");
  });

  it("returns plan filename for simple plan", () => {
    usePlanStore.setState({
      plans: {
        "p1": { id: "p1", relativePath: "plans/my-plan.md" } as never,
      },
      _plansArray: [],
      getPlan: (id: string) => usePlanStore.getState().plans[id],
    } as never);
    const view: ContentPaneView = { type: "plan", planId: "p1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("my-plan.md");
  });

  it("returns parent dir name for readme.md plan", () => {
    usePlanStore.setState({
      plans: {
        "p2": { id: "p2", relativePath: "plans/multi-tab/readme.md" } as never,
      },
      _plansArray: [],
      getPlan: (id: string) => usePlanStore.getState().plans[id],
    } as never);
    const view: ContentPaneView = { type: "plan", planId: "p2" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("multi-tab");
  });

  it("returns terminal lastCommand when available", () => {
    useTerminalSessionStore.setState({
      sessions: {
        "term1": {
          id: "term1",
          lastCommand: "pnpm test",
          worktreePath: "/foo/bar",
        } as never,
      },
      _sessionsArray: [],
    });
    const view: ContentPaneView = { type: "terminal", terminalId: "term1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("pnpm test");
  });

  it("returns dir name for terminal without lastCommand", () => {
    useTerminalSessionStore.setState({
      sessions: {
        "term2": {
          id: "term2",
          worktreePath: "/home/user/my-project",
        } as never,
      },
      _sessionsArray: [],
    });
    const view: ContentPaneView = { type: "terminal", terminalId: "term2" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("my-project");
  });

  it("returns PR title when details available", () => {
    usePullRequestStore.setState({
      pullRequests: {
        "pr1": { id: "pr1", prNumber: 42 } as never,
      },
      prDetails: {
        "pr1": { title: "Add dark mode" } as never,
      },
      _prsArray: [],
    });
    const view: ContentPaneView = { type: "pull-request", prId: "pr1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("PR #42: Add dark mode");
  });

  it("returns PR number when details not loaded", () => {
    usePullRequestStore.setState({
      pullRequests: {
        "pr2": { id: "pr2", prNumber: 99 } as never,
      },
      prDetails: {},
      _prsArray: [],
    });
    const view: ContentPaneView = { type: "pull-request", prId: "pr2" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("PR #99");
  });

  it("updates reactively when thread name changes", () => {
    useThreadStore.setState({
      threads: { "t1": { id: "t1", status: "idle" } as never },
      _threadsArray: [],
    });
    const view: ContentPaneView = { type: "thread", threadId: "t1" };
    const { result } = renderHook(() => useTabLabel(view));
    expect(result.current).toBe("New Thread");

    act(() => {
      useThreadStore.setState({
        threads: { "t1": { id: "t1", name: "Updated name", status: "idle" } as never },
        _threadsArray: [],
      });
    });
    expect(result.current).toBe("Updated name");
  });
});
