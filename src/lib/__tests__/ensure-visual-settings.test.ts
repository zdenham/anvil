// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ensureVisualSettings } from "../visual-settings";
import type { VisualSettings } from "@core/types/visual-settings.js";

describe("ensureVisualSettings", () => {
  // ── Skip-if-exists ──────────────────────────────────────────────────────

  it("returns existing visualSettings as-is (thread)", () => {
    const existing: VisualSettings = { parentId: "custom-parent", sortKey: "a0" };
    const result = ensureVisualSettings("thread", {
      visualSettings: existing,
      worktreeId: "wt-1",
      parentThreadId: "other-thread",
    });
    expect(result).toBe(existing); // same reference, not a copy
  });

  it("returns existing visualSettings even if parentId is missing", () => {
    const existing: VisualSettings = { sortKey: "z9" };
    const result = ensureVisualSettings("plan", {
      visualSettings: existing,
      worktreeId: "wt-1",
      parentId: "domain-parent",
    });
    expect(result).toBe(existing);
  });

  it("returns existing empty visualSettings without patching", () => {
    const existing: VisualSettings = {};
    const result = ensureVisualSettings("folder", {
      visualSettings: existing,
      worktreeId: "wt-1",
    });
    expect(result).toBe(existing);
    expect(result).toEqual({});
  });

  // ── Thread defaults ─────────────────────────────────────────────────────

  it("thread with parentThreadId → parentId = parentThreadId", () => {
    const result = ensureVisualSettings("thread", {
      worktreeId: "wt-1",
      parentThreadId: "parent-thread-123",
    });
    expect(result).toEqual({ parentId: "parent-thread-123" });
  });

  it("thread without parentThreadId → parentId = worktreeId", () => {
    const result = ensureVisualSettings("thread", {
      worktreeId: "wt-1",
    });
    expect(result).toEqual({ parentId: "wt-1" });
  });

  // ── Plan defaults ───────────────────────────────────────────────────────

  it("plan with domain parentId → parentId = domain parentId", () => {
    const result = ensureVisualSettings("plan", {
      worktreeId: "wt-1",
      parentId: "domain-parent-456",
    });
    expect(result).toEqual({ parentId: "domain-parent-456" });
  });

  it("plan without domain parentId → parentId = worktreeId", () => {
    const result = ensureVisualSettings("plan", {
      worktreeId: "wt-1",
    });
    expect(result).toEqual({ parentId: "wt-1" });
  });

  // ── PR, terminal, folder defaults ───────────────────────────────────────

  it("pull-request → parentId = worktreeId", () => {
    const result = ensureVisualSettings("pull-request", {
      worktreeId: "wt-1",
    });
    expect(result).toEqual({ parentId: "wt-1" });
  });

  it("terminal → parentId = worktreeId", () => {
    const result = ensureVisualSettings("terminal", {
      worktreeId: "wt-1",
    });
    expect(result).toEqual({ parentId: "wt-1" });
  });

  it("folder → parentId = worktreeId", () => {
    const result = ensureVisualSettings("folder", {
      worktreeId: "wt-1",
    });
    expect(result).toEqual({ parentId: "wt-1" });
  });
});
