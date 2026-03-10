import { describe, it, expect } from "vitest";

// Extracted from PostToolUse hook in shared.ts (lines 1082, 1088-1090)
const PR_CREATE_COMMAND_RE = /gh\s+pr\s+create\b/;
const PR_URL_RE = /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;

function parsePrUrl(response: string) {
  const match = response.match(PR_URL_RE);
  if (!match) return null;
  return { repoSlug: match[1], prNumber: parseInt(match[2], 10) };
}

describe("PR detection – command matching", () => {
  it("matches basic gh pr create with flags", () => {
    expect(PR_CREATE_COMMAND_RE.test('gh pr create --title "foo" --body "bar"')).toBe(true);
  });

  it("matches bare gh pr create", () => {
    expect(PR_CREATE_COMMAND_RE.test("gh pr create")).toBe(true);
  });

  it("matches with multiple spaces between tokens", () => {
    expect(PR_CREATE_COMMAND_RE.test("gh  pr  create --draft")).toBe(true);
  });

  it("matches even inside compound commands", () => {
    expect(PR_CREATE_COMMAND_RE.test('echo "gh pr create"')).toBe(true);
  });

  it("does NOT match gh pr view", () => {
    expect(PR_CREATE_COMMAND_RE.test("gh pr view")).toBe(false);
  });

  it("does NOT match gh pr merge", () => {
    expect(PR_CREATE_COMMAND_RE.test("gh pr merge")).toBe(false);
  });

  it("does NOT match git push", () => {
    expect(PR_CREATE_COMMAND_RE.test("git push")).toBe(false);
  });
});

describe("PR detection – URL parsing", () => {
  it("extracts repoSlug and prNumber from a clean URL", () => {
    const result = parsePrUrl("https://github.com/owner/repo/pull/42");
    expect(result).toEqual({ repoSlug: "owner/repo", prNumber: 42 });
  });

  it("extracts from multi-line gh output", () => {
    const response = "Creating pull request...\nhttps://github.com/my-org/my-repo/pull/123\n";
    const result = parsePrUrl(response);
    expect(result).toEqual({ repoSlug: "my-org/my-repo", prNumber: 123 });
  });

  it("extracts when error text precedes the URL", () => {
    const response = "Some error text before\nhttps://github.com/owner/repo/pull/999";
    const result = parsePrUrl(response);
    expect(result).toEqual({ repoSlug: "owner/repo", prNumber: 999 });
  });

  it("returns null when command failed with no URL", () => {
    expect(parsePrUrl("Error: could not create PR")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePrUrl("")).toBeNull();
  });
});
