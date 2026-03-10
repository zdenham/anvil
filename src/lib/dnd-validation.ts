import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";

/** Types that can contain children (accept drops "inside"). */
const CONTAINER_TYPES: Set<TreeItemType> = new Set([
  "worktree", "folder", "plan", "thread",
]);

/** Types that are synthetic and cannot be dragged or dropped onto. */
const SYNTHETIC_TYPES: Set<TreeItemType> = new Set([
  "repo", "changes", "uncommitted", "commit",
]);

/** Types that are leaf-only and cannot accept drops "inside". */
const LEAF_TYPES: Set<TreeItemType> = new Set([
  "terminal", "pull-request", "changes", "uncommitted", "commit",
]);

export type DropPosition = "above" | "inside" | "below";

export interface DropValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Per-type override for worktree boundary enforcement.
 * Returns true if the given type is allowed to move between worktrees.
 * Plans can cross worktree boundaries (file is moved from source to destination).
 */
export function canCrossWorktreeBoundary(type: TreeItemType): boolean {
  return type === "plan";
}

/**
 * Check if `potentialAncestorId` is an ancestor of `nodeId` in the tree.
 * Used for cycle detection -- cannot drop a node into its own descendant.
 */
export function isAncestor(
  nodeId: string,
  potentialAncestorId: string,
  parentMap: Map<string, string | undefined>,
): boolean {
  let current = parentMap.get(nodeId);
  const visited = new Set<string>();
  while (current) {
    if (current === potentialAncestorId) return true;
    if (visited.has(current)) return false; // safety: break cycles
    visited.add(current);
    current = parentMap.get(current);
  }
  return false;
}

/**
 * Walk up the ancestor chain from a node to find the worktree node it belongs to.
 * Returns the worktree node ID, or undefined if the node is at root level.
 */
export function findWorktreeAncestor(
  nodeId: string,
  nodeMap: Map<string, TreeItemNode>,
  parentMap: Map<string, string | undefined>,
): string | undefined {
  let currentId: string | undefined = nodeId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) return undefined;
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (node?.type === "worktree") return node.id;
    currentId = parentMap.get(currentId);
  }
  return undefined;
}

/**
 * Validate whether a drop operation is allowed.
 */
export function validateDrop(
  draggedItem: TreeItemNode,
  targetItem: TreeItemNode,
  dropPosition: DropPosition,
  nodeMap: Map<string, TreeItemNode>,
  parentMap: Map<string, string | undefined>,
): DropValidationResult {
  // 1. Cannot drag synthetic items
  if (SYNTHETIC_TYPES.has(draggedItem.type)) {
    return { valid: false, reason: "This item cannot be moved" };
  }

  // 2. Cannot drop onto synthetic items
  if (SYNTHETIC_TYPES.has(targetItem.type)) {
    return { valid: false, reason: "Cannot drop here" };
  }

  // 3. Cannot nest inside leaf-only types
  if (dropPosition === "inside" && LEAF_TYPES.has(targetItem.type)) {
    return { valid: false, reason: `Cannot nest inside ${targetItem.type}` };
  }

  // 4. Dropping on self is a no-op
  if (draggedItem.id === targetItem.id) {
    return { valid: false };
  }

  // 5. Determine the effective new parent
  const newParentId = dropPosition === "inside"
    ? targetItem.id
    : parentMap.get(targetItem.id);

  // 6. Cycle detection: cannot drop a node under itself or any of its descendants
  if (newParentId) {
    if (
      newParentId === draggedItem.id ||
      isAncestor(newParentId, draggedItem.id, parentMap)
    ) {
      return { valid: false, reason: "Cannot drop a node into its own descendant" };
    }
  }

  // 7. Worktrees cannot nest inside other worktrees (renumbered from original)
  if (draggedItem.type === "worktree" && dropPosition === "inside" && targetItem.type === "worktree") {
    return { valid: false, reason: "Cannot nest a worktree inside another worktree" };
  }

  // 7b. Worktrees can only be dropped inside root-level folders or repos
  if (draggedItem.type === "worktree") {
    if (dropPosition === "inside" && targetItem.type === "folder" && targetItem.worktreeId) {
      return { valid: false, reason: "Worktrees can only be placed in root-level folders" };
    }
    // Worktrees dropped above/below: the new parent must be ROOT, a repo, or a root-level folder
    if (dropPosition !== "inside" && newParentId) {
      const parentNode = nodeMap.get(newParentId);
      if (parentNode && parentNode.type !== "folder" && parentNode.type !== "repo") {
        return { valid: false, reason: "Worktrees can only be placed at root level, in repos, or in root-level folders" };
      }
      if (parentNode?.type === "folder" && parentNode.worktreeId) {
        return { valid: false, reason: "Worktrees can only be placed in root-level folders" };
      }
    }
    return { valid: true };
  }

  // 8. Worktree boundary enforcement for non-worktree, non-folder types
  if (
    draggedItem.type !== "folder" &&
    !canCrossWorktreeBoundary(draggedItem.type)
  ) {
    const draggedWorktree = draggedItem.worktreeId;
    if (draggedWorktree) {
      const targetWorktree = newParentId
        ? findWorktreeAncestor(newParentId, nodeMap, parentMap)
        : undefined;
      if (!targetWorktree || targetWorktree !== draggedWorktree) {
        return { valid: false, reason: "Cannot move between worktrees" };
      }
    }
  }

  // 9. Folders with worktree-bound children cannot move to a different worktree
  if (draggedItem.type === "folder" && draggedItem.worktreeId) {
    const targetWorktree = newParentId
      ? findWorktreeAncestor(newParentId, nodeMap, parentMap)
      : undefined;
    if (targetWorktree && targetWorktree !== draggedItem.worktreeId) {
      return { valid: false, reason: "Folder contains items from a different worktree" };
    }
  }

  return { valid: true };
}

/**
 * Determine drop position based on cursor Y position within the target element.
 * Container types: top 25% = above, middle 50% = inside, bottom 25% = below
 * Leaf types: top 50% = above, bottom 50% = below
 */
export function getDropPosition(
  cursorY: number,
  targetRect: DOMRect,
  targetType: TreeItemType,
): DropPosition {
  const relativeY = cursorY - targetRect.top;
  const height = targetRect.height;

  if (CONTAINER_TYPES.has(targetType)) {
    if (relativeY < height * 0.25) return "above";
    if (relativeY > height * 0.75) return "below";
    return "inside";
  }

  // Leaf types: no nesting
  return relativeY < height * 0.5 ? "above" : "below";
}

/**
 * Build lookup maps from the flat tree items array.
 */
export function buildTreeMaps(items: TreeItemNode[]): {
  nodeMap: Map<string, TreeItemNode>;
  parentMap: Map<string, string | undefined>;
} {
  const nodeMap = new Map<string, TreeItemNode>();
  const parentMap = new Map<string, string | undefined>();
  for (const item of items) {
    nodeMap.set(item.id, item);
    parentMap.set(item.id, item.parentId);
  }
  return { nodeMap, parentMap };
}
