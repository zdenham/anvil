/**
 * Cascade archive/unarchive for the visual tree.
 *
 * When a parent node (folder, worktree, thread, plan) is archived,
 * all visual descendants — determined by visualSettings.parentId —
 * are archived recursively. This module provides the core functions
 * for that cascade.
 */

import type { TreeItemNode } from "@/stores/tree-menu/types";
import { logger } from "@/lib/logger-client";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Descendants grouped by entity type, for dispatching to the correct service.
 */
export interface DescendantGroup {
  threads: string[];
  plans: string[];
  terminals: string[];
  folders: string[];
  pullRequests: string[];
}

/** Container types that can have visual children */
const CONTAINER_TYPES = new Set(["worktree", "folder", "thread", "plan"]);

// ═══════════════════════════════════════════════════════════════════════════
// getVisualDescendants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Walk the childrenMap recursively from nodeId, collecting all descendant IDs
 * grouped by entity type. Does NOT include the node itself.
 */
export function getVisualDescendants(
  nodeId: string,
  childrenMap: Map<string, TreeItemNode[]>,
): DescendantGroup {
  const result: DescendantGroup = {
    threads: [],
    plans: [],
    terminals: [],
    folders: [],
    pullRequests: [],
  };

  function walk(parentId: string): void {
    const children = childrenMap.get(parentId);
    if (!children) return;

    for (const child of children) {
      switch (child.type) {
        case "thread":
          result.threads.push(child.id);
          break;
        case "plan":
          result.plans.push(child.id);
          break;
        case "terminal":
          result.terminals.push(child.id);
          break;
        case "folder":
          result.folders.push(child.id);
          break;
        case "pull-request":
          result.pullRequests.push(child.id);
          break;
        // "changes" is synthetic — skip
      }

      if (CONTAINER_TYPES.has(child.type)) {
        walk(child.id);
      }
    }
  }

  walk(nodeId);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// buildCurrentChildrenMap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a childrenMap from current Zustand store state.
 * Reads visualSettings.parentId from each entity to determine parent-child.
 * Returns Map<parentId, TreeItemNode[]> where parentId is entity ID or "root".
 */
export function buildCurrentChildrenMap(): Map<string, TreeItemNode[]> {
  // Lazy require to avoid circular dependency at module load time
  const { useThreadStore } = require("@/entities/threads/store");
  const { usePlanStore } = require("@/entities/plans/store");
  const { useTerminalSessionStore } = require("@/entities/terminal-sessions/store");
  const { usePullRequestStore } = require("@/entities/pull-requests/store");
  const { useFolderStore } = require("@/entities/folders/store");

  const map = new Map<string, TreeItemNode[]>();

  function addEntry(
    id: string,
    type: TreeItemNode["type"],
    parentId: string | undefined,
  ): void {
    const key = parentId ?? "root";
    const siblings = map.get(key) ?? [];
    siblings.push({ id, type } as TreeItemNode);
    map.set(key, siblings);
  }

  const threads = useThreadStore.getState().getAllThreads();
  for (const t of threads) {
    addEntry(t.id, "thread", t.visualSettings?.parentId);
  }

  const plans = usePlanStore.getState().getAll();
  for (const p of plans) {
    addEntry(p.id, "plan", p.visualSettings?.parentId);
  }

  const terminals = useTerminalSessionStore.getState().getAllSessions();
  for (const t of terminals) {
    addEntry(t.id, "terminal", t.visualSettings?.parentId);
  }

  const prs = Object.values(
    usePullRequestStore.getState().pullRequests,
  ) as Array<{ id: string; visualSettings?: { parentId?: string } }>;
  for (const pr of prs) {
    addEntry(pr.id, "pull-request", pr.visualSettings?.parentId);
  }

  const folders = useFolderStore.getState().getAll();
  for (const f of folders) {
    addEntry(f.id, "folder", f.visualSettings?.parentId);
  }

  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// cascadeArchive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Archive all visual descendants of a node.
 * Does NOT archive the node itself — the caller handles that.
 *
 * Order: terminals -> PRs -> threads -> plans -> folders (deepest first).
 */
export async function cascadeArchive(
  nodeId: string,
  nodeType: TreeItemNode["type"],
  childrenMap: Map<string, TreeItemNode[]>,
  originInstanceId?: string | null,
): Promise<void> {
  const descendants = getVisualDescendants(nodeId, childrenMap);

  const totalCount =
    descendants.threads.length +
    descendants.plans.length +
    descendants.terminals.length +
    descendants.folders.length +
    descendants.pullRequests.length;

  if (totalCount === 0) return;

  logger.info(
    `[cascadeArchive] Archiving ${totalCount} visual descendants of ${nodeType}:${nodeId}`,
  );

  // Lazy-import services to avoid circular dependencies
  const { threadService } = await import("@/entities/threads/service");
  const { planService } = await import("@/entities/plans/service");
  const { terminalSessionService } = await import(
    "@/entities/terminal-sessions/service"
  );
  const { pullRequestService } = await import(
    "@/entities/pull-requests/service"
  );
  const { folderService } = await import("@/entities/folders/service");

  // 1. Terminals (leaf — kill PTY)
  for (const id of descendants.terminals) {
    try {
      await terminalSessionService.archive(id);
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive terminal ${id}:`, err);
    }
  }

  // 2. Pull requests (leaf)
  for (const id of descendants.pullRequests) {
    try {
      await pullRequestService.archive(id);
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive PR ${id}:`, err);
    }
  }

  // 3. Threads — deepest first (matching folder convention)
  for (const id of descendants.threads.reverse()) {
    try {
      await threadService.archive(id, originInstanceId, {
        skipVisualCascade: true,
      });
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive thread ${id}:`, err);
    }
  }

  // 4. Plans — deepest first (matching folder convention)
  for (const id of descendants.plans.reverse()) {
    try {
      await planService.archive(id, originInstanceId, {
        skipVisualCascade: true,
      });
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive plan ${id}:`, err);
    }
  }

  // 5. Folders (reverse order so deepest folders are archived first)
  for (const id of descendants.folders.reverse()) {
    try {
      await folderService.archive(id);
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive folder ${id}:`, err);
    }
  }
}

// Re-export cascadeUnarchive from its dedicated module
export { cascadeUnarchive } from "./cascade-unarchive";
