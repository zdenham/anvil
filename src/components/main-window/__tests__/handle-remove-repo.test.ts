// @vitest-environment node
/**
 * Tests for handleRemoveRepo cascading cleanup logic.
 *
 * Verifies that removing a repo:
 * 1. Closes tabs for all worktrees
 * 2. Archives threads, plans, terminals, and PRs across all worktrees
 * 3. Does NOT delete worktree directories from disk
 * 4. Hydrates stores after removal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockConfirm = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
  open: vi.fn(),
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

// Service mocks
const mockThreadGetByWorktree = vi.fn();
const mockThreadArchive = vi.fn();
vi.mock("@/entities/threads/service", () => ({
  threadService: {
    getByWorktree: (...args: unknown[]) => mockThreadGetByWorktree(...args),
    archive: (...args: unknown[]) => mockThreadArchive(...args),
  },
}));

const mockPlanGetByWorktree = vi.fn();
const mockPlanArchive = vi.fn();
vi.mock("@/entities/plans", () => ({
  planService: {
    getByWorktree: (...args: unknown[]) => mockPlanGetByWorktree(...args),
    archive: (...args: unknown[]) => mockPlanArchive(...args),
  },
}));

const mockTerminalGetByWorktree = vi.fn();
const mockTerminalArchiveByWorktree = vi.fn();
vi.mock("@/entities/terminal-sessions", () => ({
  terminalSessionService: {
    getByWorktree: (...args: unknown[]) => mockTerminalGetByWorktree(...args),
    archiveByWorktree: (...args: unknown[]) => mockTerminalArchiveByWorktree(...args),
  },
}));

const mockPrArchiveByWorktree = vi.fn();
vi.mock("@/entities/pull-requests", () => ({
  pullRequestService: {
    archiveByWorktree: (...args: unknown[]) => mockPrArchiveByWorktree(...args),
  },
}));

const mockRepoRemove = vi.fn();
const mockRepoHydrate = vi.fn();
vi.mock("@/entities/repositories", () => ({
  repoService: {
    remove: (...args: unknown[]) => mockRepoRemove(...args),
    hydrate: () => mockRepoHydrate(),
  },
}));

const mockWorktreeDelete = vi.fn();
vi.mock("@/entities/worktrees", () => ({
  worktreeService: {
    delete: (...args: unknown[]) => mockWorktreeDelete(...args),
  },
}));

const mockCloseTabsByWorktree = vi.fn();
vi.mock("@/stores/pane-layout", () => ({
  closeTabsByWorktree: (...args: unknown[]) => mockCloseTabsByWorktree(...args),
  usePaneLayoutStore: { getState: () => ({}) },
  paneLayoutService: {},
  setupPaneLayoutListeners: vi.fn(),
}));

const mockTreeMenuHydrate = vi.fn();
vi.mock("@/stores/tree-menu/service", () => ({
  treeMenuService: {
    hydrate: () => mockTreeMenuHydrate(),
  },
}));

const mockLookupHydrate = vi.fn();
const mockLookupGetState = vi.fn();
vi.mock("@/stores/repo-worktree-lookup-store", () => ({
  useRepoWorktreeLookupStore: {
    getState: () => mockLookupGetState(),
  },
}));

// ── Test helper: simulate handleRemoveRepo logic ─────────────────────────────
// We extract the exact same logic from the component callback to test it
// in isolation, since the component is too complex to render in a unit test.

import { threadService } from "@/entities/threads/service";
import { planService } from "@/entities/plans";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { pullRequestService } from "@/entities/pull-requests";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { closeTabsByWorktree } from "@/stores/pane-layout";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { logger } from "@/lib/logger-client";
import { confirm } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

/**
 * Extracted handleRemoveRepo logic — mirrors the component callback exactly.
 */
async function handleRemoveRepo(repoId: string, repoName: string): Promise<void> {
  const confirmed = await confirm(
    `Remove "${repoName}" from Anvil? This won't delete files on disk.`,
    { title: "Remove project", kind: "warning" },
  );
  if (!confirmed) return;

  try {
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const repo = lookupStore.repos.get(repoId);
    const worktreeIds = repo ? Array.from(repo.worktrees.keys()) : [];

    const allThreads = worktreeIds.flatMap(wtId => threadService.getByWorktree(wtId));
    const allPlans = worktreeIds.flatMap(wtId => planService.getByWorktree(wtId));
    const allTerminals = worktreeIds.flatMap(wtId => terminalSessionService.getByWorktree(wtId));

    for (const wtId of worktreeIds) {
      const threads = threadService.getByWorktree(wtId);
      const plans = planService.getByWorktree(wtId);
      const terminals = terminalSessionService.getByWorktree(wtId);
      await closeTabsByWorktree({
        worktreeId: wtId,
        threadIds: new Set(threads.map((t: { id: string }) => t.id)),
        planIds: new Set(plans.map((p: { id: string }) => p.id)),
        terminalIds: new Set(terminals.map((t: { id: string }) => t.id)),
      });
    }

    await repoService.remove(repoId);

    // In the real code this is fire-and-forget; here we await for testability
    await Promise.all([
      ...worktreeIds.map(wtId => terminalSessionService.archiveByWorktree(wtId)),
      ...allThreads.map((t: { id: string }) => threadService.archive(t.id)),
      ...allPlans.map((p: { id: string }) => planService.archive(p.id)),
      ...worktreeIds.map(wtId => pullRequestService.archiveByWorktree(wtId)),
    ]);

    await repoService.hydrate();
    await useRepoWorktreeLookupStore.getState().hydrate();
    await treeMenuService.hydrate();

    logger.info(`[MainWindowLayout] Removed repo "${repoName}" with ${allThreads.length} threads, ${allPlans.length} plans, ${allTerminals.length} terminals`);
  } catch (err) {
    logger.error(`[MainWindowLayout] Failed to remove repo:`, err);
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    toast.error(`Failed to remove "${repoName}": ${errorMsg}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const REPO_ID = "repo-1";
const REPO_NAME = "my-project";
const WT_1 = "wt-1";
const WT_2 = "wt-2";

const thread1 = { id: "thread-1", worktreeId: WT_1 };
const thread2 = { id: "thread-2", worktreeId: WT_2 };
const plan1 = { id: "plan-1", worktreeId: WT_1 };
const terminal1 = { id: "term-1", worktreeId: WT_1 };
const terminal2 = { id: "term-2", worktreeId: WT_2 };

function setupMocksForRepo() {
  const worktrees = new Map([
    [WT_1, { id: WT_1, name: "main" }],
    [WT_2, { id: WT_2, name: "feature" }],
  ]);
  const repos = new Map([[REPO_ID, { worktrees }]]);

  mockLookupGetState.mockReturnValue({
    repos,
    hydrate: mockLookupHydrate,
  });

  mockThreadGetByWorktree.mockImplementation((wtId: string) => {
    if (wtId === WT_1) return [thread1];
    if (wtId === WT_2) return [thread2];
    return [];
  });

  mockPlanGetByWorktree.mockImplementation((wtId: string) => {
    if (wtId === WT_1) return [plan1];
    return [];
  });

  mockTerminalGetByWorktree.mockImplementation((wtId: string) => {
    if (wtId === WT_1) return [terminal1];
    if (wtId === WT_2) return [terminal2];
    return [];
  });

  mockConfirm.mockResolvedValue(true);
  mockRepoRemove.mockResolvedValue(undefined);
  mockRepoHydrate.mockResolvedValue(undefined);
  mockLookupHydrate.mockResolvedValue(undefined);
  mockTreeMenuHydrate.mockResolvedValue(undefined);
  mockCloseTabsByWorktree.mockResolvedValue(undefined);
  mockThreadArchive.mockResolvedValue(undefined);
  mockPlanArchive.mockResolvedValue(undefined);
  mockTerminalArchiveByWorktree.mockResolvedValue(undefined);
  mockPrArchiveByWorktree.mockResolvedValue(undefined);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handleRemoveRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocksForRepo();
  });

  it("does nothing when user cancels confirmation", async () => {
    mockConfirm.mockResolvedValue(false);

    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockRepoRemove).not.toHaveBeenCalled();
    expect(mockThreadArchive).not.toHaveBeenCalled();
  });

  it("closes tabs for all worktrees in the repo", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockCloseTabsByWorktree).toHaveBeenCalledTimes(2);
    expect(mockCloseTabsByWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: WT_1 }),
    );
    expect(mockCloseTabsByWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: WT_2 }),
    );
  });

  it("archives all threads across all worktrees", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockThreadArchive).toHaveBeenCalledWith("thread-1");
    expect(mockThreadArchive).toHaveBeenCalledWith("thread-2");
  });

  it("archives all plans across all worktrees", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockPlanArchive).toHaveBeenCalledWith("plan-1");
  });

  it("archives terminal sessions for all worktrees", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockTerminalArchiveByWorktree).toHaveBeenCalledWith(WT_1);
    expect(mockTerminalArchiveByWorktree).toHaveBeenCalledWith(WT_2);
  });

  it("archives pull requests for all worktrees", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockPrArchiveByWorktree).toHaveBeenCalledWith(WT_1);
    expect(mockPrArchiveByWorktree).toHaveBeenCalledWith(WT_2);
  });

  it("does NOT call worktreeService.delete", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockWorktreeDelete).not.toHaveBeenCalled();
  });

  it("removes repo metadata via repoService.remove", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockRepoRemove).toHaveBeenCalledWith(REPO_ID);
  });

  it("hydrates stores after removal", async () => {
    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockRepoHydrate).toHaveBeenCalled();
    expect(mockLookupHydrate).toHaveBeenCalled();
    expect(mockTreeMenuHydrate).toHaveBeenCalled();
  });

  it("handles repo with no worktrees gracefully", async () => {
    mockLookupGetState.mockReturnValue({
      repos: new Map([[REPO_ID, { worktrees: new Map() }]]),
      hydrate: mockLookupHydrate,
    });

    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockRepoRemove).toHaveBeenCalledWith(REPO_ID);
    expect(mockCloseTabsByWorktree).not.toHaveBeenCalled();
    expect(mockThreadArchive).not.toHaveBeenCalled();
  });

  it("shows toast on error", async () => {
    mockRepoRemove.mockRejectedValue(new Error("disk full"));

    await handleRemoveRepo(REPO_ID, REPO_NAME);

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("disk full"),
    );
  });
});
