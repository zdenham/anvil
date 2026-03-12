// @vitest-environment node
/**
 * Drop Constraint Validation Tests
 *
 * Tests for DnD validation functions: canCrossWorktreeBoundary, isAncestor,
 * findWorktreeAncestor, validateDrop, getDropPosition, buildTreeMaps.
 */

import { describe, it, expect } from "vitest";
import {
  canCrossWorktreeBoundary,
  isAncestor,
  findWorktreeAncestor,
  validateDrop,
  getDropPosition,
  buildTreeMaps,
  type DropPosition,
} from "../dnd-validation";
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";

// -- Factory ------------------------------------------------------------------

function createNode(overrides: Partial<TreeItemNode> = {}): TreeItemNode {
  return {
    type: "thread",
    id: crypto.randomUUID(),
    title: "Test Item",
    status: "read",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    depth: 0,
    isFolder: false,
    isExpanded: false,
    ...overrides,
  };
}

/**
 * Build nodeMap and parentMap from an array of descriptors.
 * Mirrors what buildTreeMaps() does on a flat TreeItemNode[] array.
 */
function makeMaps(
  entries: Array<{
    id: string;
    type: TreeItemType;
    parentId?: string;
    worktreeId?: string;
  }>,
): {
  nodeMap: Map<string, TreeItemNode>;
  parentMap: Map<string, string | undefined>;
} {
  const nodeMap = new Map<string, TreeItemNode>();
  const parentMap = new Map<string, string | undefined>();
  for (const e of entries) {
    const node = createNode({
      id: e.id,
      type: e.type,
      parentId: e.parentId,
      worktreeId: e.worktreeId,
    });
    nodeMap.set(e.id, node);
    parentMap.set(e.id, e.parentId);
  }
  return { nodeMap, parentMap };
}

// -- Tests --------------------------------------------------------------------

describe("canCrossWorktreeBoundary", () => {
  it("returns true for plan type", () => {
    expect(canCrossWorktreeBoundary("plan")).toBe(true);
  });

  it("returns false for non-plan types", () => {
    const types: TreeItemType[] = [
      "repo",
      "thread",
      "terminal",
      "pull-request",
      "folder",
      "worktree",
      "changes",
    ];
    for (const type of types) {
      expect(canCrossWorktreeBoundary(type)).toBe(false);
    }
  });
});

describe("isAncestor", () => {
  it("returns true when potentialAncestor is direct parent", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("child", "parent");
    parentMap.set("parent", undefined);

    expect(isAncestor("child", "parent", parentMap)).toBe(true);
  });

  it("returns true when potentialAncestor is grandparent", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("grandchild", "child");
    parentMap.set("child", "grandparent");
    parentMap.set("grandparent", undefined);

    expect(isAncestor("grandchild", "grandparent", parentMap)).toBe(true);
  });

  it("returns false when no ancestor relationship exists", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("a", "root");
    parentMap.set("b", "root");
    parentMap.set("root", undefined);

    expect(isAncestor("a", "b", parentMap)).toBe(false);
  });

  it("handles cycles without infinite loop", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("a", "b");
    parentMap.set("b", "a"); // cycle

    // Should terminate and return false (target "c" not found)
    expect(isAncestor("a", "c", parentMap)).toBe(false);
  });
});

describe("findWorktreeAncestor", () => {
  it("returns worktree id when node is direct child of worktree", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "wt-1", type: "worktree" },
      { id: "thread-1", type: "thread", parentId: "wt-1" },
    ]);

    expect(findWorktreeAncestor("thread-1", nodeMap, parentMap)).toBe("wt-1");
  });

  it("returns worktree id when node is nested deep inside worktree", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "wt-1", type: "worktree" },
      { id: "folder-1", type: "folder", parentId: "wt-1" },
      { id: "thread-1", type: "thread", parentId: "folder-1" },
    ]);

    expect(findWorktreeAncestor("thread-1", nodeMap, parentMap)).toBe("wt-1");
  });

  it("returns undefined when node is at root level (no worktree ancestor)", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "folder-1", type: "folder" },
    ]);

    expect(
      findWorktreeAncestor("folder-1", nodeMap, parentMap),
    ).toBeUndefined();
  });

  it("returns the worktree's own id when called on a worktree node", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "wt-1", type: "worktree" },
    ]);

    expect(findWorktreeAncestor("wt-1", nodeMap, parentMap)).toBe("wt-1");
  });
});

describe("getDropPosition", () => {
  // Create a mock DOMRect for a 40px tall element starting at y=100
  function mockRect(top: number = 100, height: number = 40): DOMRect {
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  }

  describe("container types (25/50/25 split)", () => {
    it("returns 'above' when cursor is in top 25% of container", () => {
      const rect = mockRect(100, 40);
      // Top 25% = y 100-110
      expect(getDropPosition(105, rect, "folder")).toBe("above");
    });

    it("returns 'inside' when cursor is in middle 50% of container", () => {
      const rect = mockRect(100, 40);
      // Middle 50% = y 110-130
      expect(getDropPosition(120, rect, "folder")).toBe("inside");
    });

    it("returns 'below' when cursor is in bottom 25% of container", () => {
      const rect = mockRect(100, 40);
      // Bottom 25% = y 130-140
      expect(getDropPosition(135, rect, "folder")).toBe("below");
    });

    it("works for all container types: worktree, folder, plan, thread", () => {
      const rect = mockRect(100, 40);
      const containerTypes: TreeItemType[] = [
        "worktree",
        "folder",
        "plan",
        "thread",
      ];
      for (const type of containerTypes) {
        expect(getDropPosition(120, rect, type)).toBe("inside");
      }
    });
  });

  describe("leaf types (50/50 split)", () => {
    it("returns 'above' when cursor is in top 50% of leaf", () => {
      const rect = mockRect(100, 40);
      expect(getDropPosition(115, rect, "terminal")).toBe("above");
    });

    it("returns 'below' when cursor is in bottom 50% of leaf", () => {
      const rect = mockRect(100, 40);
      expect(getDropPosition(125, rect, "terminal")).toBe("below");
    });

    it("never returns 'inside' for leaf types", () => {
      const rect = mockRect(100, 40);
      const leafTypes: TreeItemType[] = [
        "terminal",
        "pull-request",
        "changes",
      ];
      for (const type of leafTypes) {
        const pos = getDropPosition(120, rect, type);
        expect(pos).not.toBe("inside");
      }
    });
  });
});

describe("buildTreeMaps", () => {
  it("creates nodeMap keyed by item id", () => {
    const items = [
      createNode({ id: "a" }),
      createNode({ id: "b", parentId: "a" }),
    ];
    const { nodeMap } = buildTreeMaps(items);
    expect(nodeMap.size).toBe(2);
    expect(nodeMap.get("a")!.id).toBe("a");
    expect(nodeMap.get("b")!.id).toBe("b");
  });

  it("creates parentMap with correct parent references", () => {
    const items = [
      createNode({ id: "a" }),
      createNode({ id: "b", parentId: "a" }),
    ];
    const { parentMap } = buildTreeMaps(items);
    expect(parentMap.get("a")).toBeUndefined();
    expect(parentMap.get("b")).toBe("a");
  });
});

describe("validateDrop", () => {
  describe("synthetic items", () => {
    it("cannot drag a repo item", () => {
      const dragged = createNode({ type: "repo", id: "repo-1" });
      const target = createNode({ type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drag a changes item", () => {
      const dragged = createNode({ type: "changes", id: "changes:wt-1" });
      const target = createNode({ type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drop onto a synthetic target", () => {
      const dragged = createNode({ type: "thread" });
      const target = createNode({ type: "changes" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "above", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drop onto a repo target", () => {
      const dragged = createNode({ type: "thread" });
      const target = createNode({ type: "repo" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });
  });

  describe("leaf type targets", () => {
    it("cannot drop inside a terminal (leaf type)", () => {
      const dragged = createNode({ type: "thread", worktreeId: "wt-1" });
      const target = createNode({ type: "terminal", worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drop inside a pull-request (leaf type)", () => {
      const dragged = createNode({ type: "thread", worktreeId: "wt-1" });
      const target = createNode({
        type: "pull-request",
        worktreeId: "wt-1",
      });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("can reorder above/below a terminal", () => {
      const dragged = createNode({
        id: "d",
        type: "thread",
        worktreeId: "wt-1",
      });
      const target = createNode({
        id: "t",
        type: "terminal",
        worktreeId: "wt-1",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        { id: "d", type: "thread", parentId: "wt-1", worktreeId: "wt-1" },
        { id: "t", type: "terminal", parentId: "wt-1", worktreeId: "wt-1" },
      ]);
      const resultAbove = validateDrop(
        dragged,
        target,
        "above",
        nodeMap,
        parentMap,
      );
      const resultBelow = validateDrop(
        dragged,
        target,
        "below",
        nodeMap,
        parentMap,
      );
      expect(resultAbove.valid).toBe(true);
      expect(resultBelow.valid).toBe(true);
    });
  });

  describe("self-drop", () => {
    it("dropping on self is invalid", () => {
      const item = createNode({ id: "same" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(item, item, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });
  });

  describe("cycle detection", () => {
    it("cannot drop a node into its own child", () => {
      const parent = createNode({
        id: "parent",
        type: "folder",
        isFolder: true,
      });
      const child = createNode({
        id: "child",
        type: "folder",
        isFolder: true,
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "parent", type: "folder" },
        { id: "child", type: "folder", parentId: "parent" },
      ]);
      const result = validateDrop(
        parent,
        child,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/descendant/i);
    });

    it("cannot drop a node into its grandchild", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "gp", type: "folder" },
        { id: "p", type: "folder", parentId: "gp" },
        { id: "c", type: "folder", parentId: "p" },
      ]);
      const gp = nodeMap.get("gp")!;
      const c = nodeMap.get("c")!;
      const result = validateDrop(gp, c, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drop a folder above a node inside its own subtree", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "folderA", type: "folder" },
        { id: "folderB", type: "folder", parentId: "folderA" },
        { id: "thread1", type: "thread", parentId: "folderB" },
      ]);
      const folderA = nodeMap.get("folderA")!;
      const thread1 = nodeMap.get("thread1")!;
      const result = validateDrop(folderA, thread1, "above", nodeMap, parentMap);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/descendant/i);
    });

    it("cannot drop a folder below a node inside its own subtree", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "folderA", type: "folder" },
        { id: "folderB", type: "folder", parentId: "folderA" },
        { id: "thread1", type: "thread", parentId: "folderB" },
      ]);
      const folderA = nodeMap.get("folderA")!;
      const thread1 = nodeMap.get("thread1")!;
      const result = validateDrop(folderA, thread1, "below", nodeMap, parentMap);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/descendant/i);
    });

    it("cannot drop a folder above its direct child", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "folderA", type: "folder" },
        { id: "folderB", type: "folder", parentId: "folderA" },
      ]);
      const folderA = nodeMap.get("folderA")!;
      const folderB = nodeMap.get("folderB")!;
      const result = validateDrop(folderA, folderB, "above", nodeMap, parentMap);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/descendant/i);
    });

    it("allows dropping a sibling (no cycle)", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "root", type: "folder" },
        { id: "a", type: "thread", parentId: "root" },
        { id: "b", type: "folder", parentId: "root" },
      ]);
      const a = nodeMap.get("a")!;
      const b = nodeMap.get("b")!;
      const result = validateDrop(a, b, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });
  });

  describe("worktree boundary enforcement", () => {
    it("cannot drop thread from worktree A into folder in worktree B", () => {
      const thread = createNode({
        id: "thread-in-a",
        type: "thread",
        worktreeId: "wt-a",
      });
      const folder = createNode({
        id: "folder-in-b",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-b",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
        {
          id: "folder-in-b",
          type: "folder",
          parentId: "wt-b",
          worktreeId: "wt-b",
        },
      ]);
      const result = validateDrop(
        thread,
        folder,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/worktree/i);
    });

    it("allows drop within same worktree", () => {
      const thread = createNode({
        id: "thread-in-a",
        type: "thread",
        worktreeId: "wt-a",
      });
      const folder = createNode({
        id: "folder-in-a",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-a",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        {
          id: "folder-in-a",
          type: "folder",
          parentId: "wt-a",
          worktreeId: "wt-a",
        },
      ]);
      const result = validateDrop(
        thread,
        folder,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });

    it("allows plan to cross worktree boundary", () => {
      const plan = createNode({
        id: "plan-in-a",
        type: "plan",
        worktreeId: "wt-a",
      });
      const targetWorktree = createNode({
        id: "wt-b",
        type: "worktree",
        isFolder: true,
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
        { id: "plan-in-a", type: "plan", parentId: "wt-a", worktreeId: "wt-a" },
      ]);
      const result = validateDrop(
        plan,
        targetWorktree,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });

    it("allows plan to drop into folder in different worktree", () => {
      const plan = createNode({
        id: "plan-in-a",
        type: "plan",
        worktreeId: "wt-a",
      });
      const folder = createNode({
        id: "folder-in-b",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-b",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
        { id: "plan-in-a", type: "plan", parentId: "wt-a", worktreeId: "wt-a" },
        { id: "folder-in-b", type: "folder", parentId: "wt-b", worktreeId: "wt-b" },
      ]);
      const result = validateDrop(
        plan,
        folder,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });

    it("folder with worktreeId cannot move to different worktree", () => {
      const folder = createNode({
        id: "folder",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-a",
      });
      const targetFolder = createNode({
        id: "target",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-b",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
        {
          id: "target",
          type: "folder",
          parentId: "wt-b",
          worktreeId: "wt-b",
        },
      ]);
      const result = validateDrop(
        folder,
        targetFolder,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("worktree drop rules", () => {
    it("worktree can be dropped into a root-level folder", () => {
      const worktree = createNode({ id: "wt-1", type: "worktree" });
      const folder = createNode({
        id: "f-1",
        type: "folder",
        isFolder: true,
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "f-1", type: "folder" },
      ]);
      const result = validateDrop(
        worktree,
        folder,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });

    it("worktree cannot be dropped inside another worktree", () => {
      const worktreeA = createNode({ id: "wt-a", type: "worktree" });
      const worktreeB = createNode({
        id: "wt-b",
        type: "worktree",
        isFolder: true,
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
      ]);
      const result = validateDrop(
        worktreeA,
        worktreeB,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(false);
    });

    it("worktree can be reordered at root level (above/below)", () => {
      const worktreeA = createNode({ id: "wt-a", type: "worktree" });
      const worktreeB = createNode({ id: "wt-b", type: "worktree" });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
      ]);
      expect(
        validateDrop(worktreeA, worktreeB, "above", nodeMap, parentMap).valid,
      ).toBe(true);
      expect(
        validateDrop(worktreeA, worktreeB, "below", nodeMap, parentMap).valid,
      ).toBe(true);
    });

    it("worktree cannot be dropped inside a worktree-scoped folder", () => {
      const worktree = createNode({ id: "wt-1", type: "worktree" });
      const folder = createNode({
        id: "f-wt",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-2",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-2", type: "worktree" },
        { id: "f-wt", type: "folder", parentId: "wt-2", worktreeId: "wt-2" },
      ]);
      const result = validateDrop(worktree, folder, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/root-level/i);
    });
  });

  describe("valid container drops", () => {
    it("can drop thread inside a folder (same worktree)", () => {
      const thread = createNode({
        id: "t1",
        type: "thread",
        worktreeId: "wt-1",
      });
      const folder = createNode({
        id: "f1",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-1",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        {
          id: "f1",
          type: "folder",
          parentId: "wt-1",
          worktreeId: "wt-1",
        },
      ]);
      const result = validateDrop(
        thread,
        folder,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });

    it("can drop plan inside a thread (same worktree)", () => {
      const plan = createNode({
        id: "p1",
        type: "plan",
        worktreeId: "wt-1",
      });
      const thread = createNode({
        id: "t1",
        type: "thread",
        isFolder: true,
        worktreeId: "wt-1",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        {
          id: "t1",
          type: "thread",
          parentId: "wt-1",
          worktreeId: "wt-1",
        },
      ]);
      const result = validateDrop(
        plan,
        thread,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });

    it("can drop folder inside another folder (same worktree)", () => {
      const inner = createNode({
        id: "inner",
        type: "folder",
        worktreeId: "wt-1",
      });
      const outer = createNode({
        id: "outer",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-1",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        {
          id: "outer",
          type: "folder",
          parentId: "wt-1",
          worktreeId: "wt-1",
        },
      ]);
      const result = validateDrop(
        inner,
        outer,
        "inside",
        nodeMap,
        parentMap,
      );
      expect(result.valid).toBe(true);
    });
  });
});
