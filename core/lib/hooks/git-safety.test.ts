import { describe, it, expect } from "vitest";
import { evaluateGitCommand, BANNED_COMMANDS } from "./git-safety.js";

describe("evaluateGitCommand", () => {
  it("allows normal git commands", () => {
    expect(evaluateGitCommand("git status")).toEqual({ allowed: true });
    expect(evaluateGitCommand("git add .")).toEqual({ allowed: true });
    expect(evaluateGitCommand("git commit -m 'test'")).toEqual({ allowed: true });
    expect(evaluateGitCommand("git push origin main")).toEqual({ allowed: true });
  });

  it("allows empty/null commands", () => {
    expect(evaluateGitCommand("")).toEqual({ allowed: true });
  });

  it("blocks git stash (but allows stash list/show)", () => {
    const result = evaluateGitCommand("git stash");
    expect(result.allowed).toBe(false);

    expect(evaluateGitCommand("git stash list").allowed).toBe(true);
    expect(evaluateGitCommand("git stash show").allowed).toBe(true);
  });

  it("blocks git checkout --force", () => {
    const result = evaluateGitCommand("git checkout -f main");
    expect(result.allowed).toBe(false);
  });

  it("blocks git reset --hard", () => {
    const result = evaluateGitCommand("git reset --hard HEAD~1");
    expect(result.allowed).toBe(false);
  });

  it("blocks git clean -f", () => {
    const result = evaluateGitCommand("git clean -fd");
    expect(result.allowed).toBe(false);
  });

  it("blocks git checkout -- .", () => {
    const result = evaluateGitCommand("git checkout -- .");
    expect(result.allowed).toBe(false);
  });

  it("blocks git restore .", () => {
    const result = evaluateGitCommand("git restore .");
    expect(result.allowed).toBe(false);
  });

  it("returns reason and suggestion for blocked commands", () => {
    const result = evaluateGitCommand("git reset --hard");
    if (!result.allowed) {
      expect(result.reason).toBeTruthy();
      expect(result.suggestion).toBeTruthy();
    }
  });

  it("exports BANNED_COMMANDS with expected structure", () => {
    expect(BANNED_COMMANDS.length).toBeGreaterThan(0);
    for (const cmd of BANNED_COMMANDS) {
      expect(cmd.pattern).toBeInstanceOf(RegExp);
      expect(cmd.reason).toBeTruthy();
      expect(cmd.suggestion).toBeTruthy();
    }
  });
});
