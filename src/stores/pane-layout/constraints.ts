import type { SplitNode } from "@core/types/pane-layout.js";
import { findGroupPath, getNodeAtPath } from "./split-tree";

/** Maximum number of children in a horizontal split. */
const MAX_HORIZONTAL_CHILDREN = 4;

/** Maximum number of children in a vertical split. */
const MAX_VERTICAL_CHILDREN = 3;

/**
 * Checks if a group can be split horizontally.
 *
 * Walks the path from root to the target group's leaf, looking at
 * the parent split. If the parent is already a horizontal split
 * at the max child count, the split is disallowed.
 */
export function canSplitHorizontal(root: SplitNode, groupId: string): boolean {
  return canSplitDirection(root, groupId, "horizontal", MAX_HORIZONTAL_CHILDREN);
}

/**
 * Checks if a group can be split vertically.
 *
 * Same logic as horizontal but for vertical splits, max 3 children.
 */
export function canSplitVertical(root: SplitNode, groupId: string): boolean {
  return canSplitDirection(root, groupId, "vertical", MAX_VERTICAL_CHILDREN);
}

/**
 * Generic check: can we split a group in the given direction?
 *
 * If the group's immediate parent is a split in the same direction,
 * adding a child would exceed the limit. If the parent is a different
 * direction (or is the root leaf), a new split node is created,
 * which starts with 2 children and is always allowed.
 */
function canSplitDirection(
  root: SplitNode,
  groupId: string,
  direction: "horizontal" | "vertical",
  maxChildren: number,
): boolean {
  const path = findGroupPath(root, groupId);
  if (path === null) return false;

  // If the leaf IS the root, splitting always creates a new 2-child split
  if (path.length === 0) return true;

  // Get the parent split node
  const parentPath = path.slice(0, -1);
  const parent = getNodeAtPath(root, parentPath);
  if (!parent || parent.type !== "split") return true;

  // If parent splits in the same direction, check child count limit
  if (parent.direction === direction) {
    return parent.children.length < maxChildren;
  }

  // Different direction: a new nested split is created, always ok
  return true;
}

export { findGroupPath } from "./split-tree";
