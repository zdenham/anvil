// @vitest-environment node
/**
 * Tests for PR merge gh-cli functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger-client", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockExecGh = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
const mockExecGhJson = vi.fn();

vi.mock("../executor", () => ({
  execGh: (...args: unknown[]) => mockExecGh(...args),
  execGhJson: (...args: unknown[]) => mockExecGhJson(...args),
}));

describe("getRepoMergeSettings", () => {
  let getRepoMergeSettings: typeof import("../pr-queries").getRepoMergeSettings;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../pr-queries");
    getRepoMergeSettings = mod.getRepoMergeSettings;
  });

  it("returns allowed methods in squash-preferred order", async () => {
    mockExecGhJson.mockResolvedValue({
      allow_squash_merge: true,
      allow_merge_commit: true,
      allow_rebase_merge: false,
    });

    const result = await getRepoMergeSettings("/repo", "owner/repo");

    expect(result.allowedMethods).toEqual(["squash", "merge"]);
    expect(result.defaultMethod).toBe("squash");
    expect(mockExecGhJson).toHaveBeenCalledWith(
      ["api", "repos/owner/repo", "--jq", "{allow_merge_commit, allow_squash_merge, allow_rebase_merge}"],
      "/repo",
    );
  });

  it("returns only rebase when others are disabled", async () => {
    mockExecGhJson.mockResolvedValue({
      allow_squash_merge: false,
      allow_merge_commit: false,
      allow_rebase_merge: true,
    });

    const result = await getRepoMergeSettings("/repo", "owner/repo");

    expect(result.allowedMethods).toEqual(["rebase"]);
    expect(result.defaultMethod).toBe("rebase");
  });

  it("falls back to squash default when nothing is allowed", async () => {
    mockExecGhJson.mockResolvedValue({
      allow_squash_merge: false,
      allow_merge_commit: false,
      allow_rebase_merge: false,
    });

    const result = await getRepoMergeSettings("/repo", "owner/repo");

    expect(result.allowedMethods).toEqual([]);
    expect(result.defaultMethod).toBe("squash");
  });
});

describe("mergePr", () => {
  let mergePr: typeof import("../pr-queries").mergePr;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../pr-queries");
    mergePr = mod.mergePr;
  });

  it("calls execGh with --squash flag", async () => {
    await mergePr("/repo", 42, "squash");

    expect(mockExecGh).toHaveBeenCalledWith(
      ["pr", "merge", "42", "--squash", "--delete-branch"],
      "/repo",
    );
  });

  it("calls execGh with --merge flag", async () => {
    await mergePr("/repo", 42, "merge");

    expect(mockExecGh).toHaveBeenCalledWith(
      ["pr", "merge", "42", "--merge", "--delete-branch"],
      "/repo",
    );
  });

  it("calls execGh with --rebase flag", async () => {
    await mergePr("/repo", 42, "rebase");

    expect(mockExecGh).toHaveBeenCalledWith(
      ["pr", "merge", "42", "--rebase", "--delete-branch"],
      "/repo",
    );
  });
});
