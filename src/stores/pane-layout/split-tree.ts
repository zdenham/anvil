import type { SplitNode } from "./types";

/**
 * Finds the index path from root to the leaf containing the given groupId.
 * Returns null if not found.
 */
export function findGroupPath(root: SplitNode, groupId: string): number[] | null {
  if (root.type === "leaf") {
    return root.groupId === groupId ? [] : null;
  }

  for (let i = 0; i < root.children.length; i++) {
    const childPath = findGroupPath(root.children[i], groupId);
    if (childPath !== null) {
      return [i, ...childPath];
    }
  }
  return null;
}

/**
 * Returns the split node at the given index path.
 */
export function getNodeAtPath(root: SplitNode, path: number[]): SplitNode | null {
  let current: SplitNode = root;
  for (const index of path) {
    if (current.type === "leaf") return null;
    if (index < 0 || index >= current.children.length) return null;
    current = current.children[index];
  }
  return current;
}

/**
 * Replaces the node at the given index path within the split tree.
 * Returns a new tree (immutable).
 */
export function replaceNodeAtPath(
  root: SplitNode,
  path: number[],
  replacement: SplitNode,
): SplitNode {
  if (path.length === 0) return replacement;

  if (root.type === "leaf") {
    throw new Error("Cannot traverse into leaf node");
  }

  const [index, ...rest] = path;
  const newChildren = [...root.children];
  newChildren[index] = replaceNodeAtPath(newChildren[index], rest, replacement);

  return { ...root, children: newChildren };
}

/**
 * Splits a leaf node into a split containing the original leaf and a new leaf.
 * Returns the new tree root.
 */
export function splitLeafNode(
  root: SplitNode,
  groupId: string,
  direction: "horizontal" | "vertical",
  newGroupId: string,
  initialSizes: [number, number] = [50, 50],
): SplitNode {
  const path = findGroupPath(root, groupId);
  if (path === null) {
    throw new Error(`Group ${groupId} not found in tree`);
  }

  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: [
      { type: "leaf", groupId },
      { type: "leaf", groupId: newGroupId },
    ],
    sizes: initialSizes,
  };

  return replaceNodeAtPath(root, path, newSplit);
}

/**
 * Collapses a split node at the given path, promoting the remaining child
 * after one child has been removed.
 */
export function collapseSplitAtPath(root: SplitNode, path: number[]): SplitNode {
  const node = getNodeAtPath(root, path);
  if (!node || node.type !== "split") {
    throw new Error("Node at path is not a split");
  }

  if (node.children.length !== 1) {
    throw new Error("Cannot collapse split with multiple children");
  }

  // Promote the single remaining child
  return replaceNodeAtPath(root, path, node.children[0]);
}

/**
 * Removes a leaf from the tree and collapses the parent if needed.
 * Returns null if the leaf is the root (last group scenario).
 */
export function removeLeafFromTree(root: SplitNode, groupId: string): SplitNode | null {
  if (root.type === "leaf") {
    return root.groupId === groupId ? null : root;
  }

  const path = findGroupPath(root, groupId);
  if (path === null) return root;

  // Path to the parent split
  const parentPath = path.slice(0, -1);
  const childIndex = path[path.length - 1];

  const parent = getNodeAtPath(root, parentPath);
  if (!parent || parent.type !== "split") return root;

  const newChildren = parent.children.filter((_, i) => i !== childIndex);
  const newSizes = parent.sizes.filter((_, i) => i !== childIndex);

  // Normalize sizes to sum to 100
  const sizeSum = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = sizeSum > 0
    ? newSizes.map((s) => (s / sizeSum) * 100)
    : newSizes;

  if (newChildren.length === 1) {
    // Collapse: promote the single remaining child
    return replaceNodeAtPath(root, parentPath, newChildren[0]);
  }

  const newParent: SplitNode = {
    ...parent,
    children: newChildren,
    sizes: normalizedSizes,
  };
  return replaceNodeAtPath(root, parentPath, newParent);
}

/**
 * Collects all group IDs referenced in the split tree.
 */
export function collectGroupIds(node: SplitNode): string[] {
  if (node.type === "leaf") return [node.groupId];
  return node.children.flatMap(collectGroupIds);
}
