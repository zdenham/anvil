// @vitest-environment node
/**
 * Worktree Listeners Tests
 *
 * Tests for the WORKTREE_SYNCED event handler in worktree listeners.
 * When the agent detects `git worktree add` via Bash, it emits WORKTREE_SYNCED.
 * The listener resolves the repoId to a repoName, syncs worktrees, and
 * re-hydrates the sidebar store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventName } from "@core/types/events.js";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

vi.mock("../../events.js", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
    }),
    off: vi.fn(),
  },
}));

const mockSync = vi.fn().mockResolvedValue([]);
vi.mock("../service.js", () => ({
  worktreeService: {
    sync: (...args: unknown[]) => mockSync(...args),
  },
}));

const mockEnsureTerminalsForWorktrees = vi.fn().mockResolvedValue(undefined);
vi.mock("@/entities/terminal-sessions/service.js", () => ({
  terminalSessionService: {
    ensureTerminalsForWorktrees: (...args: unknown[]) => mockEnsureTerminalsForWorktrees(...args),
  },
}));

const mockHydrate = vi.fn().mockResolvedValue(undefined);
const mockGetRepoName = vi.fn().mockReturnValue("my-repo");
const mockRepos = new Map<string, { worktrees: Map<string, { path?: string }> }>();

vi.mock("@/stores/repo-worktree-lookup-store.js", () => ({
  useRepoWorktreeLookupStore: {
    getState: vi.fn(() => ({
      hydrate: (...args: unknown[]) => mockHydrate(...args),
      getRepoName: (...args: unknown[]) => mockGetRepoName(...args),
      repos: mockRepos,
    })),
  },
}));

import { setupWorktreeListeners } from "../listeners";

describe("WorktreeListeners — WORKTREE_SYNCED", () => {
  beforeEach(() => {
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key];
    vi.clearAllMocks();
    mockRepos.clear();
    mockGetRepoName.mockReturnValue("my-repo");
    setupWorktreeListeners();
  });

  it("calls worktreeService.sync then hydrate", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];
    expect(handlers.length).toBeGreaterThan(0);

    await handlers[0]({ repoId: "repo-1" });

    expect(mockSync).toHaveBeenCalledWith("my-repo", false);
    expect(mockHydrate).toHaveBeenCalled();
  });

  it("passes false for markNewAsExternal", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];

    await handlers[0]({ repoId: "repo-1" });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync.mock.calls[0]).toEqual(["my-repo", false]);
  });

  it("skips sync for unknown repo", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];
    mockGetRepoName.mockReturnValue("Unknown");

    await handlers[0]({ repoId: "repo-1" });

    expect(mockSync).not.toHaveBeenCalled();
    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it("resolves repoId to repoName via lookup store", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];

    await handlers[0]({ repoId: "repo-42" });

    expect(mockGetRepoName).toHaveBeenCalledWith("repo-42");
  });

  it("calls ensureTerminalsForWorktrees with worktrees from hydrated store", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];
    mockRepos.set("repo-1", {
      worktrees: new Map([
        ["wt-1", { path: "/path/to/wt-1" }],
        ["wt-2", { path: "/path/to/wt-2" }],
      ]),
    });

    await handlers[0]({ repoId: "repo-1" });

    expect(mockEnsureTerminalsForWorktrees).toHaveBeenCalledWith([
      { worktreeId: "wt-1", worktreePath: "/path/to/wt-1" },
      { worktreeId: "wt-2", worktreePath: "/path/to/wt-2" },
    ]);
  });

  it("skips worktrees without a path when ensuring terminals", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];
    mockRepos.set("repo-1", {
      worktrees: new Map([
        ["wt-1", { path: "/path/to/wt-1" }],
        ["wt-no-path", {}],
      ]),
    });

    await handlers[0]({ repoId: "repo-1" });

    expect(mockEnsureTerminalsForWorktrees).toHaveBeenCalledWith([
      { worktreeId: "wt-1", worktreePath: "/path/to/wt-1" },
    ]);
  });

  it("does not call ensureTerminalsForWorktrees when repo not found in store", async () => {
    const handlers = eventHandlers[EventName.WORKTREE_SYNCED] ?? [];
    // mockRepos is empty — repo-1 not in store

    await handlers[0]({ repoId: "repo-1" });

    expect(mockEnsureTerminalsForWorktrees).not.toHaveBeenCalled();
  });
});
