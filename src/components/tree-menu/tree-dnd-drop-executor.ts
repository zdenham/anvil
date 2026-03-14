/**
 * Executes a drop operation by computing new parentId + sortKey and persisting
 * via updateVisualSettings. Extracted from use-tree-dnd to keep files under 250 lines.
 */
import { logger } from "@/lib/logger-client";
import { updateVisualSettings } from "@/lib/visual-settings";
import { computeSortKeyForInsertion } from "@/lib/sort-key";
import { buildTreeMaps, findWorktreeAncestor } from "@/lib/dnd-validation";
import type { DropPosition } from "@/lib/dnd-validation";
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";

/**
 * Execute the drop: compute new parentId + sortKey, persist via updateVisualSettings.
 * For plans, also handles file moves when the drop implies a location change on disk.
 */
export async function executeDrop(
  draggedItem: TreeItemNode,
  targetItem: TreeItemNode,
  position: DropPosition,
  allItems: TreeItemNode[],
): Promise<void> {
  const newParentId = resolveNewParentId(targetItem, position);
  const siblings = allItems.filter(
    (item) => item.parentId === newParentId && item.id !== draggedItem.id,
  );
  const insertionIndex = computeInsertionIndex(siblings, targetItem, position);
  const sortKey = computeSortKeyForInsertion(siblings, insertionIndex);

  logger.debug("[dnd:drop] executeDrop", {
    dragged: { id: draggedItem.id, type: draggedItem.type, title: draggedItem.title, sortKey: draggedItem.sortKey },
    target: { id: targetItem.id, type: targetItem.type, title: targetItem.title, sortKey: targetItem.sortKey },
    position,
    newParentId,
    siblings: siblings.map(s => ({ id: s.id, type: s.type, title: s.title, sortKey: s.sortKey })),
    insertionIndex,
    newSortKey: sortKey,
  });

  // Plans may need a file move when dropped onto a worktree or plan parent
  if (draggedItem.type === "plan") {
    const moved = await maybeMovePlanFile(draggedItem, newParentId, sortKey, allItems);
    if (moved) {
      logger.debug(
        `[useTreeDnd] Moved plan "${draggedItem.title}" ${position} "${targetItem.title}"`,
      );
      return;
    }
  }

  const entityType = mapTreeItemTypeToEntityType(draggedItem.type);
  await updateVisualSettings(entityType, draggedItem.id, {
    parentId: newParentId,
    sortKey,
  });

  await maybeUpdateFolderWorktree(draggedItem, newParentId, allItems);

  logger.debug(
    `[useTreeDnd] Dropped ${draggedItem.type} "${draggedItem.title}" ${position} "${targetItem.title}"`,
  );
}

/** Determine new parentId based on drop position. */
function resolveNewParentId(
  targetItem: TreeItemNode,
  position: DropPosition,
): string | undefined {
  return position === "inside"
    ? targetItem.id
    : targetItem.parentId ?? undefined;
}

/** Determine insertion index among siblings. */
function computeInsertionIndex(
  siblings: TreeItemNode[],
  targetItem: TreeItemNode,
  position: DropPosition,
): number {
  if (position === "inside") {
    return siblings.length; // append at end of container
  }
  const targetIndex = siblings.findIndex((s) => s.id === targetItem.id);
  if (position === "above") {
    return Math.max(targetIndex, 0);
  }
  return targetIndex >= 0 ? targetIndex + 1 : siblings.length;
}

/** If moving a folder, update its worktreeId if worktree context changed. */
async function maybeUpdateFolderWorktree(
  draggedItem: TreeItemNode,
  newParentId: string | undefined,
  allItems: TreeItemNode[],
): Promise<void> {
  if (draggedItem.type !== "folder") return;

  const { nodeMap, parentMap } = buildTreeMaps(allItems);
  parentMap.set(draggedItem.id, newParentId); // use new parent for lookup
  const newWorktreeId = newParentId
    ? findWorktreeAncestor(newParentId, nodeMap, parentMap)
    : undefined;

  if (newWorktreeId !== draggedItem.worktreeId) {
    const { folderService } = await import("@/entities/folders/service");
    await folderService.updateWorktreeId(draggedItem.id, newWorktreeId);
  }
}

type VisualEntityType = "thread" | "plan" | "pull-request" | "terminal" | "folder" | "worktree";

function mapTreeItemTypeToEntityType(type: TreeItemType): VisualEntityType {
  switch (type) {
    case "thread": return "thread";
    case "plan": return "plan";
    case "pull-request": return "pull-request";
    case "terminal": return "terminal";
    case "folder": return "folder";
    case "worktree": return "worktree";
    default: throw new Error(`Cannot move item of type: ${type}`);
  }
}

/**
 * If a plan is dropped onto a file-backed parent (worktree or plan),
 * move the plan file on disk via planService.movePlan().
 * Returns true if a file move was performed (caller should skip visual settings update).
 */
async function maybeMovePlanFile(
  draggedItem: TreeItemNode,
  newParentId: string | undefined,
  sortKey: string,
  allItems: TreeItemNode[],
): Promise<boolean> {
  if (!newParentId) return false;

  const parentNode = allItems.find((n) => n.id === newParentId);
  if (!parentNode) return false;

  // Only worktree/plan parents imply a file move; folders/threads are visual-only
  if (parentNode.type !== "worktree" && parentNode.type !== "plan") return false;

  const { planService } = await import("@/entities/plans/service");
  const plan = planService.get(draggedItem.id);
  if (!plan) return false;

  // Resolve the target worktree
  const { nodeMap, parentMap } = buildTreeMaps(allItems);
  const targetWorktreeId = findWorktreeAncestor(newParentId, nodeMap, parentMap);
  if (!targetWorktreeId) return false;

  const wtNode = allItems.find((n) => n.id === targetWorktreeId && n.type === "worktree");
  if (!wtNode?.worktreePath || !wtNode.repoId) return false;

  // Compute new relative path
  const { computeNewRelativePath } = await import("@/entities/plans/utils");
  const filename = plan.relativePath.split("/").pop()!;
  let targetPlanRelPath: string | undefined;
  if (parentNode.type === "plan") {
    targetPlanRelPath = planService.get(parentNode.id)?.relativePath;
  }
  const newRelativePath = computeNewRelativePath(
    filename,
    parentNode.type as "worktree" | "plan",
    targetPlanRelPath,
  );

  // Skip if nothing actually changed
  const isCrossWorktree = plan.worktreeId !== targetWorktreeId;
  if (!isCrossWorktree && plan.relativePath === newRelativePath) return false;

  await planService.movePlan(draggedItem.id, {
    targetWorktreeId,
    targetRepoId: wtNode.repoId,
    newRelativePath,
    targetWorktreePath: wtNode.worktreePath,
    visualSettings: { parentId: newParentId, sortKey },
  });

  return true;
}
