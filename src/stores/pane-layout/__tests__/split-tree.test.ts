// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  findGroupPath,
  getNodeAtPath,
  replaceNodeAtPath,
  splitLeafNode,
  collapseSplitAtPath,
  removeLeafFromTree,
  collectGroupIds,
} from "../split-tree";
import type { SplitNode } from "../types";

const leaf = (groupId: string): SplitNode => ({ type: "leaf", groupId });
const split = (
  direction: "horizontal" | "vertical",
  children: SplitNode[],
  sizes?: number[],
): SplitNode => ({
  type: "split",
  direction,
  children,
  sizes: sizes ?? children.map(() => 100 / children.length),
});

describe("findGroupPath", () => {
  it("returns empty array for root leaf", () => {
    expect(findGroupPath(leaf("g1"), "g1")).toEqual([]);
  });

  it("returns null for missing group", () => {
    expect(findGroupPath(leaf("g1"), "g2")).toBeNull();
  });

  it("finds nested group path", () => {
    const tree = split("horizontal", [leaf("g1"), split("vertical", [leaf("g2"), leaf("g3")])]);
    expect(findGroupPath(tree, "g3")).toEqual([1, 1]);
  });
});

describe("getNodeAtPath", () => {
  it("returns root for empty path", () => {
    const tree = leaf("g1");
    expect(getNodeAtPath(tree, [])).toEqual(tree);
  });

  it("returns child at path", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2")]);
    expect(getNodeAtPath(tree, [1])).toEqual(leaf("g2"));
  });

  it("returns null for invalid path", () => {
    expect(getNodeAtPath(leaf("g1"), [0])).toBeNull();
  });
});

describe("replaceNodeAtPath", () => {
  it("replaces root when path is empty", () => {
    const result = replaceNodeAtPath(leaf("g1"), [], leaf("g2"));
    expect(result).toEqual(leaf("g2"));
  });

  it("replaces child at nested path", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2")]);
    const result = replaceNodeAtPath(tree, [1], leaf("g3"));
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[1]).toEqual(leaf("g3"));
    }
  });
});

describe("splitLeafNode", () => {
  it("splits a root leaf into a split with two children", () => {
    const result = splitLeafNode(leaf("g1"), "g1", "horizontal", "g2");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.direction).toBe("horizontal");
      expect(result.children).toEqual([leaf("g1"), leaf("g2")]);
      expect(result.sizes).toEqual([50, 50]);
    }
  });

  it("splits a nested leaf", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2")]);
    const result = splitLeafNode(tree, "g2", "vertical", "g3");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[1].type).toBe("split");
    }
  });

  it("throws for non-existent group", () => {
    expect(() => splitLeafNode(leaf("g1"), "missing", "horizontal", "g2")).toThrow();
  });
});

describe("collapseSplitAtPath", () => {
  it("promotes single child to replace parent", () => {
    // A split with one child (after prior removal)
    const tree = split("horizontal", [leaf("g1"), { type: "split", direction: "vertical", children: [leaf("g2")], sizes: [100] }]);
    const result = collapseSplitAtPath(tree, [1]);
    if (tree.type === "split") {
      // The nested split at [1] had 1 child, so it should be replaced by the child
      expect(result.type).toBe("split");
      if (result.type === "split") {
        expect(result.children[1]).toEqual(leaf("g2"));
      }
    }
  });
});

describe("removeLeafFromTree", () => {
  it("returns null when removing root leaf", () => {
    expect(removeLeafFromTree(leaf("g1"), "g1")).toBeNull();
  });

  it("collapses parent when only one sibling remains", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2")]);
    const result = removeLeafFromTree(tree, "g1");
    expect(result).toEqual(leaf("g2"));
  });

  it("keeps other siblings when more than 2 exist", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2"), leaf("g3")], [33, 33, 34]);
    const result = removeLeafFromTree(tree, "g2");
    expect(result?.type).toBe("split");
    if (result?.type === "split") {
      expect(result.children).toHaveLength(2);
      expect(collectGroupIds(result)).toEqual(["g1", "g3"]);
    }
  });

  it("returns tree unchanged for non-existent group", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2")]);
    expect(removeLeafFromTree(tree, "missing")).toEqual(tree);
  });
});

describe("collectGroupIds", () => {
  it("collects all group IDs from a nested tree", () => {
    const tree = split("horizontal", [
      leaf("g1"),
      split("vertical", [leaf("g2"), leaf("g3")]),
    ]);
    expect(collectGroupIds(tree).sort()).toEqual(["g1", "g2", "g3"]);
  });
});
