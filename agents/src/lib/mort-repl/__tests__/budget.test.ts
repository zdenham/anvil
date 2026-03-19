import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isOverBudget, rollUpCostToParent } from "../budget.js";

vi.mock("../../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("budget", () => {
  let mortDir: string;

  beforeEach(() => {
    mortDir = join(
      tmpdir(),
      `mort-budget-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(mortDir, "threads"), { recursive: true });
  });

  afterEach(() => {
    rmSync(mortDir, { recursive: true, force: true });
  });

  function createThread(
    threadId: string,
    metadata: Record<string, unknown>,
  ): void {
    const threadDir = join(mortDir, "threads", threadId);
    mkdirSync(threadDir, { recursive: true });
    writeFileSync(
      join(threadDir, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
  }

  // ── isOverBudget ────────────────────────────────────────────

  describe("isOverBudget", () => {
    it("returns not over budget when thread has no budgetCapUsd", () => {
      createThread("thread-1", { totalCostUsd: 5 });

      const result = isOverBudget("thread-1", mortDir);

      expect(result).toEqual({ overBudget: false });
    });

    it("returns not over budget when spend is under cap", () => {
      createThread("thread-2", {
        budgetCapUsd: 10,
        totalCostUsd: 3,
        cumulativeCostUsd: 2,
      });

      const result = isOverBudget("thread-2", mortDir);

      expect(result).toEqual({
        overBudget: false,
        capUsd: 10,
        spentUsd: 5,
        budgetThreadId: "thread-2",
      });
    });

    it("returns over budget when spend exceeds cap", () => {
      createThread("thread-3", {
        budgetCapUsd: 5,
        totalCostUsd: 3,
        cumulativeCostUsd: 4,
      });

      const result = isOverBudget("thread-3", mortDir);

      expect(result).toEqual({
        overBudget: true,
        capUsd: 5,
        spentUsd: 7,
        budgetThreadId: "thread-3",
      });
    });

    it("returns over budget when spend exactly equals cap (>= check)", () => {
      createThread("thread-4", {
        budgetCapUsd: 6,
        totalCostUsd: 4,
        cumulativeCostUsd: 2,
      });

      const result = isOverBudget("thread-4", mortDir);

      expect(result).toEqual({
        overBudget: true,
        capUsd: 6,
        spentUsd: 6,
        budgetThreadId: "thread-4",
      });
    });

    it("walks ancestors and finds grandparent budget that is over", () => {
      createThread("child", {
        parentThreadId: "parent",
        totalCostUsd: 1,
      });
      createThread("parent", {
        parentThreadId: "grandparent",
        totalCostUsd: 1,
      });
      createThread("grandparent", {
        budgetCapUsd: 5,
        totalCostUsd: 3,
        cumulativeCostUsd: 4,
      });

      const result = isOverBudget("child", mortDir);

      expect(result).toEqual({
        overBudget: true,
        capUsd: 5,
        spentUsd: 7,
        budgetThreadId: "grandparent",
      });
    });

    it("stops at nearest ancestor with budget (parent under, grandparent over)", () => {
      createThread("child", {
        parentThreadId: "parent",
        totalCostUsd: 1,
      });
      createThread("parent", {
        parentThreadId: "grandparent",
        budgetCapUsd: 20,
        totalCostUsd: 2,
        cumulativeCostUsd: 1,
      });
      createThread("grandparent", {
        budgetCapUsd: 5,
        totalCostUsd: 3,
        cumulativeCostUsd: 4,
      });

      const result = isOverBudget("child", mortDir);

      expect(result).toEqual({
        overBudget: false,
        capUsd: 20,
        spentUsd: 3,
        budgetThreadId: "parent",
      });
    });

    it("terminates without error when parentThreadId is circular", () => {
      createThread("loop-thread", {
        parentThreadId: "loop-thread",
        totalCostUsd: 1,
      });

      const result = isOverBudget("loop-thread", mortDir);

      expect(result).toEqual({ overBudget: false });
    });

    it("returns not over budget when thread directory does not exist", () => {
      const result = isOverBudget("nonexistent-thread", mortDir);

      expect(result).toEqual({ overBudget: false });
    });
  });

  // ── rollUpCostToParent ──────────────────────────────────────

  describe("rollUpCostToParent", () => {
    it("adds childTreeCost to parent cumulativeCostUsd", () => {
      createThread("parent-a", {
        totalCostUsd: 2,
        cumulativeCostUsd: 0,
      });

      rollUpCostToParent(mortDir, "parent-a", 3.5);

      const raw = readFileSync(
        join(mortDir, "threads", "parent-a", "metadata.json"),
        "utf-8",
      );
      const meta = JSON.parse(raw);
      expect(meta.cumulativeCostUsd).toBe(3.5);
      expect(meta.updatedAt).toBeTypeOf("number");
    });

    it("accumulates on top of existing cumulativeCostUsd", () => {
      createThread("parent-b", {
        totalCostUsd: 1,
        cumulativeCostUsd: 5,
      });

      rollUpCostToParent(mortDir, "parent-b", 3);

      const raw = readFileSync(
        join(mortDir, "threads", "parent-b", "metadata.json"),
        "utf-8",
      );
      const meta = JSON.parse(raw);
      expect(meta.cumulativeCostUsd).toBe(8);
    });

    it("does not modify parent metadata when childTreeCost is zero", () => {
      createThread("parent-c", {
        totalCostUsd: 1,
        cumulativeCostUsd: 5,
        updatedAt: 1000,
      });

      rollUpCostToParent(mortDir, "parent-c", 0);

      const raw = readFileSync(
        join(mortDir, "threads", "parent-c", "metadata.json"),
        "utf-8",
      );
      const meta = JSON.parse(raw);
      expect(meta.cumulativeCostUsd).toBe(5);
      expect(meta.updatedAt).toBe(1000);
    });

    it("does not throw when parent metadata does not exist", () => {
      expect(() => {
        rollUpCostToParent(mortDir, "missing-parent", 10);
      }).not.toThrow();
    });
  });
});
