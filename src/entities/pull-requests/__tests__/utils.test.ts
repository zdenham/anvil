// @vitest-environment node
/**
 * Pull Request Utils Tests
 *
 * Tests for findWorktreeByBranch:
 * - Finds matching worktree by branch name
 * - Returns null when no worktree matches
 * - Returns null for empty branch name
 * - Handles missing settings gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockListDir = vi.fn<[string], Promise<string[]>>().mockResolvedValue([]);
const mockReadJson = vi.fn<[string], Promise<unknown>>().mockResolvedValue(null);

vi.mock("@/lib/app-data-store", () => ({
  appData: {
    listDir: (...args: [string]) => mockListDir(...args),
    readJson: (...args: [string]) => mockReadJson(...args),
  },
}));

const REPO_ID = crypto.randomUUID();

function makeSettings(repoId: string, worktrees: Array<{ id: string; path: string; name: string; currentBranch: string | null }>) {
  return {
    id: repoId,
    schemaVersion: 1,
    name: "test-repo",
    originalUrl: null,
    sourcePath: "/path/to/repo",
    useWorktrees: true,
    defaultBranch: "main",
    createdAt: Date.now(),
    worktrees: worktrees.map((wt) => ({
      ...wt,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
    })),
    threadBranches: {},
    lastUpdated: Date.now(),
    plansDirectory: "plans/",
    completedDirectory: "plans/completed/",
  };
}

describe("findWorktreeByBranch", () => {
  let findWorktreeByBranch: typeof import("../utils").findWorktreeByBranch;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import("../utils");
    findWorktreeByBranch = mod.findWorktreeByBranch;
  });

  it("returns matching worktree by branch name", async () => {
    const wt1Id = crypto.randomUUID();
    const wt2Id = crypto.randomUUID();
    mockListDir.mockResolvedValue(["test-repo"]);
    mockReadJson.mockResolvedValue(
      makeSettings(REPO_ID, [
        { id: wt1Id, path: "/path/to/worktree/main", name: "main", currentBranch: "main" },
        { id: wt2Id, path: "/path/to/worktree/feature", name: "feature", currentBranch: "feature/auth" },
      ]),
    );

    const result = await findWorktreeByBranch(REPO_ID, "feature/auth");

    expect(result).not.toBeNull();
    expect(result?.id).toBe(wt2Id);
  });

  it("returns null when no worktree matches the branch", async () => {
    mockListDir.mockResolvedValue(["test-repo"]);
    mockReadJson.mockResolvedValue(
      makeSettings(REPO_ID, [
        { id: crypto.randomUUID(), path: "/path/main", name: "main", currentBranch: "main" },
      ]),
    );

    const result = await findWorktreeByBranch(REPO_ID, "feature/unknown");

    expect(result).toBeNull();
  });

  it("returns null for empty branch name", async () => {
    const result = await findWorktreeByBranch(REPO_ID, "");

    expect(result).toBeNull();
    expect(mockListDir).not.toHaveBeenCalled();
  });

  it("returns null when repo is not found", async () => {
    mockListDir.mockResolvedValue(["other-repo"]);
    mockReadJson.mockResolvedValue(
      makeSettings(crypto.randomUUID(), [
        { id: crypto.randomUUID(), path: "/path/main", name: "main", currentBranch: "feature/test" },
      ]),
    );

    const result = await findWorktreeByBranch(REPO_ID, "feature/test");

    expect(result).toBeNull();
  });

  it("handles errors gracefully and returns null", async () => {
    mockListDir.mockRejectedValue(new Error("disk error"));

    const result = await findWorktreeByBranch(REPO_ID, "feature/test");

    expect(result).toBeNull();
  });
});
