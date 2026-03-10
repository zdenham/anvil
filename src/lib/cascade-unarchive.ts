/**
 * Cascade unarchive for the visual tree.
 *
 * When a parent node is unarchived, all visual descendants — determined
 * by visualSettings.parentId chains in the archive — are unarchived
 * recursively. This is the counterpart to cascadeArchive.
 */

import type { TreeItemNode } from "@/stores/tree-menu/types";
import { logger } from "@/lib/logger-client";

/**
 * Unarchive all visual descendants of a node.
 * Does NOT unarchive the node itself — the caller handles that.
 *
 * Scans all archived entities and finds those whose visualSettings.parentId
 * chain leads back to the node being unarchived.
 */
export async function cascadeUnarchive(
  nodeId: string,
  nodeType: TreeItemNode["type"],
): Promise<void> {
  logger.info(
    `[cascadeUnarchive] Unarchiving descendants of ${nodeType}:${nodeId}`,
  );

  const { threadService } = await import("@/entities/threads/service");
  const { planService } = await import("@/entities/plans/service");
  const { folderService } = await import("@/entities/folders/service");
  const { pullRequestService } = await import(
    "@/entities/pull-requests/service"
  );

  // 1. Load all archived entities
  const [archivedThreadsResult, archivedPlans, archivedFolders, archivedPrs] =
    await Promise.all([
      threadService.listArchived(),
      planService.listArchived(),
      folderService.listArchived(),
      pullRequestService.listArchived(),
    ]);
  const archivedThreads = archivedThreadsResult.threads;

  // 2. Build a lookup: archived entity ID -> its visualSettings.parentId
  const parentMap = new Map<string, string | undefined>();
  for (const t of archivedThreads)
    parentMap.set(t.id, t.visualSettings?.parentId);
  for (const p of archivedPlans)
    parentMap.set(p.id, p.visualSettings?.parentId);
  for (const f of archivedFolders)
    parentMap.set(f.id, f.visualSettings?.parentId);
  for (const pr of archivedPrs)
    parentMap.set(pr.id, pr.visualSettings?.parentId);

  // 3. Find all archived entities whose parentId chain leads to nodeId
  const descendantIds = findDescendantIds(parentMap, nodeId);

  if (descendantIds.size === 0) {
    logger.info(`[cascadeUnarchive] No archived descendants found`);
    return;
  }

  // 4. Group by entity type and unarchive
  await unarchiveByType(
    descendantIds,
    archivedFolders,
    archivedThreads,
    archivedPlans,
    archivedPrs,
    { threadService, planService, folderService, pullRequestService },
  );

  logger.info(
    `[cascadeUnarchive] Restored ${descendantIds.size} descendants of ${nodeType}:${nodeId}`,
  );
}

/** Walk parentId chains to find all descendants of a target node. */
function findDescendantIds(
  parentMap: Map<string, string | undefined>,
  targetId: string,
): Set<string> {
  const descendantIds = new Set<string>();

  function isDescendantOf(
    entityId: string,
    visited: Set<string>,
  ): boolean {
    if (visited.has(entityId)) return false;
    visited.add(entityId);
    const parentId = parentMap.get(entityId);
    if (!parentId) return false;
    if (parentId === targetId) return true;
    return isDescendantOf(parentId, visited);
  }

  for (const id of parentMap.keys()) {
    if (id === targetId) continue;
    if (isDescendantOf(id, new Set())) {
      descendantIds.add(id);
    }
  }

  return descendantIds;
}

/** Unarchive descendants grouped by entity type. Folders first so parents exist. */
async function unarchiveByType(
  descendantIds: Set<string>,
  archivedFolders: Array<{ id: string }>,
  archivedThreads: Array<{ id: string }>,
  archivedPlans: Array<{ id: string }>,
  archivedPrs: Array<{ id: string }>,
  services: {
    threadService: { unarchive(id: string): Promise<void> };
    planService: { unarchive(id: string): Promise<void> };
    folderService: { unarchive(id: string): Promise<void> };
    pullRequestService: { unarchive(id: string): Promise<void> };
  },
): Promise<void> {
  const folderIds = archivedFolders.filter((f) => descendantIds.has(f.id)).map((f) => f.id);
  const threadIds = archivedThreads.filter((t) => descendantIds.has(t.id)).map((t) => t.id);
  const planIds = archivedPlans.filter((p) => descendantIds.has(p.id)).map((p) => p.id);
  const prIds = archivedPrs.filter((pr) => descendantIds.has(pr.id)).map((pr) => pr.id);

  // Folders first so parents exist before children are restored
  for (const id of folderIds) {
    try {
      await services.folderService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive folder ${id}:`, err);
    }
  }

  for (const id of threadIds) {
    try {
      await services.threadService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive thread ${id}:`, err);
    }
  }

  for (const id of planIds) {
    try {
      await services.planService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive plan ${id}:`, err);
    }
  }

  for (const id of prIds) {
    try {
      await services.pullRequestService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive PR ${id}:`, err);
    }
  }
}
