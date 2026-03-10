// @vitest-environment node
/**
 * Cascade Archive Tests
 *
 * Tests for getVisualDescendants() -- the pure function that walks a
 * childrenMap to collect all visual descendants grouped by entity type.
 * The actual cascade archive orchestration (service calls) is tested
 * via integration tests in the respective service test files.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getVisualDescendants, type DescendantGroup } from "../cascade-archive";
import type { TreeItemNode } from "@/stores/tree-menu/types";

// -- Factory ------------------------------------------------------------------

function createNode(overrides: Partial<TreeItemNode> = {}): TreeItemNode {
  return {
    type: "thread",
    id: crypto.randomUUID(),
    title: "Test",
    status: "read",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    depth: 0,
    isFolder: false,
    isExpanded: false,
    ...overrides,
  };
}

// -- Tests --------------------------------------------------------------------

describe("getVisualDescendants", () => {
  it("returns all children of a folder grouped by type", () => {
    const thread = createNode({ id: "t1", type: "thread" });
    const plan = createNode({ id: "p1", type: "plan" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [thread, plan]);

    const result = getVisualDescendants("folder-1", childrenMap);

    expect(result.threads).toContain("t1");
    expect(result.plans).toContain("p1");
    expect(result.folders).toHaveLength(0);
    expect(result.terminals).toHaveLength(0);
    expect(result.pullRequests).toHaveLength(0);
  });

  it("cascades through nested folders", () => {
    const innerFolder = createNode({ id: "inner-folder", type: "folder" });
    const deepThread = createNode({ id: "deep-thread", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("outer-folder", [innerFolder]);
    childrenMap.set("inner-folder", [deepThread]);

    const result = getVisualDescendants("outer-folder", childrenMap);

    expect(result.folders).toContain("inner-folder");
    expect(result.threads).toContain("deep-thread");
  });

  it("cascades through threads (threads are containers)", () => {
    const childPlan = createNode({ id: "child-plan", type: "plan" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("parent-thread", [childPlan]);

    const result = getVisualDescendants("parent-thread", childrenMap);

    expect(result.plans).toContain("child-plan");
  });

  it("cascades through plans (plans are containers)", () => {
    const childThread = createNode({ id: "child-thread", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("parent-plan", [childThread]);

    const result = getVisualDescendants("parent-plan", childrenMap);

    expect(result.threads).toContain("child-thread");
  });

  it("handles empty folder (no children entry in map)", () => {
    const childrenMap = new Map<string, TreeItemNode[]>();

    const result = getVisualDescendants("empty-folder", childrenMap);

    expect(result.threads).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    expect(result.folders).toHaveLength(0);
    expect(result.terminals).toHaveLength(0);
    expect(result.pullRequests).toHaveLength(0);
  });

  it("collects terminals and pull-requests", () => {
    const terminal = createNode({ id: "term-1", type: "terminal" });
    const pr = createNode({ id: "pr-1", type: "pull-request" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [terminal, pr]);

    const result = getVisualDescendants("folder-1", childrenMap);

    expect(result.terminals).toContain("term-1");
    expect(result.pullRequests).toContain("pr-1");
  });

  it("worktree archive collects all entities inside (deep tree)", () => {
    const folder = createNode({ id: "f1", type: "folder" });
    const thread = createNode({ id: "t1", type: "thread" });
    const plan = createNode({ id: "p1", type: "plan" });
    const innerThread = createNode({ id: "t2", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("wt-1", [folder, thread, plan]);
    childrenMap.set("f1", [innerThread]);

    const result = getVisualDescendants("wt-1", childrenMap);

    expect(result.threads).toEqual(expect.arrayContaining(["t1", "t2"]));
    expect(result.threads).toHaveLength(2);
    expect(result.plans).toContain("p1");
    expect(result.folders).toContain("f1");
  });

  it("item moved out of parent is NOT included in parent's descendants", () => {
    // "t-out" was moved to folder-2, so NOT in folder-1's children
    const threadStillInFolder = createNode({ id: "t-in", type: "thread" });
    const threadMovedOut = createNode({ id: "t-out", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [threadStillInFolder]);
    childrenMap.set("folder-2", [threadMovedOut]);

    const result = getVisualDescendants("folder-1", childrenMap);

    expect(result.threads).toContain("t-in");
    expect(result.threads).not.toContain("t-out");
  });

  it("does not include synthetic items (changes, uncommitted, commit) in typed groups", () => {
    const changes = createNode({ id: "changes:wt-1", type: "changes" });
    const uncommitted = createNode({
      id: "uncommitted:wt-1",
      type: "uncommitted",
    });
    const commit = createNode({ id: "commit:wt-1:abc", type: "commit" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("wt-1", [changes, uncommitted, commit]);

    const result = getVisualDescendants("wt-1", childrenMap);

    expect(result.threads).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    expect(result.folders).toHaveLength(0);
    expect(result.terminals).toHaveLength(0);
    expect(result.pullRequests).toHaveLength(0);
  });

  it("does NOT include the starting node itself", () => {
    const child = createNode({ id: "child", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [child]);

    const result = getVisualDescendants("folder-1", childrenMap);

    // "folder-1" itself should not appear in any group
    expect(result.folders).not.toContain("folder-1");
    expect(result.threads).toEqual(["child"]);
  });

  it("handles deeply nested tree (3+ levels)", () => {
    const l1Folder = createNode({ id: "l1", type: "folder" });
    const l2Folder = createNode({ id: "l2", type: "folder" });
    const l3Thread = createNode({ id: "l3", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("root-folder", [l1Folder]);
    childrenMap.set("l1", [l2Folder]);
    childrenMap.set("l2", [l3Thread]);

    const result = getVisualDescendants("root-folder", childrenMap);

    expect(result.folders).toEqual(expect.arrayContaining(["l1", "l2"]));
    expect(result.threads).toContain("l3");
  });
});
