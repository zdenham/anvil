/**
 * Unified tree builder and React hooks for the sidebar tree.
 *
 * Replaces the old two-tier model (RepoWorktreeSection + TreeItemNode)
 * with a single flat TreeItemNode[] where worktrees are regular nodes.
 */
import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { usePermissionStore } from "@/entities/permissions/store";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { useFolderStore } from "@/entities/folders/store";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { useCommitStore } from "@/stores/commit-store";
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { TerminalSession } from "@/entities/terminal-sessions/types";
import type { PullRequestMetadata } from "@/entities/pull-requests/types";
import type { FolderMetadata } from "@/entities/folders/types";
import {
  repoToNode,
  worktreeToNode,
  folderToNode,
  threadToNode,
  planToNode,
  terminalToNode,
  prToNode,
  buildFilesNode,
  buildChangesNodes,
} from "./tree-node-builders";
import { ensureVisualSettings, persistVisualSettings } from "@/lib/visual-settings";

// ═══════════════════════════════════════════════════════════════════════════
// Public interfaces consumed by tree-node-builders and external callers
// ═══════════════════════════════════════════════════════════════════════════

export interface WorktreeInfo {
  worktreeId: string;
  repoId: string;
  repoName: string;
  worktreeName: string;
  worktreePath: string;
  visualSettings?: { parentId?: string; sortKey?: string };
}

export interface TreeBuildContext {
  expandedSections: Record<string, boolean>;
  runningThreadIds: Set<string>;
  threadsWithPendingInput: Set<string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tree builder
// ═══════════════════════════════════════════════════════════════════════════

const ROOT = "__ROOT__";

/** Type-based sort priority — lower number sorts first within a parent.
 *  Only applies to items without an explicit sortKey (non-DnD items). */
const TYPE_SORT_PRIORITY: Partial<Record<TreeItemType, number>> = {
  files: 0,
  "pull-request": 1,
  terminal: 1,
  changes: 2,
};

function typePriority(node: TreeItemNode): number {
  return TYPE_SORT_PRIORITY[node.type] ?? 3;
}

/** Resolve the expand-state key for a given node */
function expandKey(node: TreeItemNode): string {
  if (node.type === "worktree" || node.type === "repo") return node.id;
  return `${node.type}:${node.id}`;
}

/**
 * Build a map of parentId -> child nodes from all entities.
 * Uses visualSettings.parentId for placement.
 * Keys: entity ID or ROOT for top-level items.
 *
 * This is the same mapping used internally by buildUnifiedTree().
 * Exported for use outside React (e.g., cascade-archive).
 */
export function buildChildrenMap(
  allNodes: TreeItemNode[],
): Map<string, TreeItemNode[]> {
  const map = new Map<string, TreeItemNode[]>();
  const nodeById = new Map<string, TreeItemNode>();

  for (const node of allNodes) {
    nodeById.set(node.id, node);
  }

  for (const node of allNodes) {
    let parentKey = node.parentId ?? ROOT;
    // If parentId references a non-existent node, fall back to the
    // worktree node (handles archived parent threads). If the worktree
    // node is also missing, the entity was already filtered out upstream.
    if (parentKey !== ROOT && !nodeById.has(parentKey)) {
      if (node.worktreeId && nodeById.has(node.worktreeId)) {
        parentKey = node.worktreeId;
      } else {
        parentKey = ROOT;
      }
    }
    const siblings = map.get(parentKey);
    if (siblings) {
      siblings.push(node);
    } else {
      map.set(parentKey, [node]);
    }
  }

  return map;
}

/**
 * Build a unified flat tree from all entity stores.
 * Returns a depth-annotated TreeItemNode[] ready for rendering.
 */
export function buildUnifiedTree(
  worktrees: WorktreeInfo[],
  folders: FolderMetadata[],
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  pullRequests: PullRequestMetadata[],
  ctx: TreeBuildContext,
): TreeItemNode[] {
  // Step 0: On-demand visual settings backfill for legacy entities.
  // SKIP if visualSettings already exists — never overwrite.
  for (const thread of threads) {
    if (thread.visualSettings) continue;
    thread.visualSettings = ensureVisualSettings("thread", thread);
    persistVisualSettings("thread", thread.id, thread.visualSettings);
  }
  for (const plan of plans) {
    if (plan.visualSettings) continue;
    plan.visualSettings = ensureVisualSettings("plan", plan);
    persistVisualSettings("plan", plan.id, plan.visualSettings);
  }
  for (const pr of pullRequests) {
    if (pr.visualSettings) continue;
    pr.visualSettings = ensureVisualSettings("pull-request", pr);
    persistVisualSettings("pull-request", pr.id, pr.visualSettings);
  }
  for (const terminal of terminals) {
    if (terminal.visualSettings) continue;
    terminal.visualSettings = ensureVisualSettings("terminal", terminal);
    persistVisualSettings("terminal", terminal.id, terminal.visualSettings);
  }
  for (const folder of folders) {
    if (folder.visualSettings) continue;
    folder.visualSettings = ensureVisualSettings("folder", folder);
    persistVisualSettings("folder", folder.id, folder.visualSettings);
  }

  // Step 0b: Filter out entities whose worktreeId no longer exists.
  // This prevents orphaned threads (e.g. from deleted worktrees) from
  // falling back to ROOT and rendering at the top level.
  const knownWorktreeIds = new Set(worktrees.map((w) => w.worktreeId));
  const validThreads = threads.filter((t) => knownWorktreeIds.has(t.worktreeId));
  const validPlans = plans.filter((p) => knownWorktreeIds.has(p.worktreeId));
  const validTerminals = terminals.filter((t) => knownWorktreeIds.has(t.worktreeId));
  const validPRs = pullRequests.filter((pr) => knownWorktreeIds.has(pr.worktreeId));
  const validFolders = folders.filter((f) => !f.worktreeId || knownWorktreeIds.has(f.worktreeId));

  // Step 1: Pool all entity nodes
  const allNodes: TreeItemNode[] = [];

  // Create repo group nodes
  const repoIds = new Set(worktrees.map(w => w.repoId));
  for (const repoId of repoIds) {
    const repoName = worktrees.find(w => w.repoId === repoId)!.repoName;
    allNodes.push(repoToNode(repoId, repoName));
  }

  for (const wt of worktrees) {
    const node = worktreeToNode(wt);
    if (!node.parentId) {
      node.parentId = wt.repoId;
    }
    allNodes.push(node);
  }
  for (const folder of validFolders) {
    allNodes.push(folderToNode(folder));
  }
  for (const thread of validThreads) {
    allNodes.push(threadToNode(thread, ctx));
  }
  for (const plan of validPlans) {
    allNodes.push(planToNode(plan, ctx.runningThreadIds));
  }
  for (const terminal of validTerminals) {
    allNodes.push(terminalToNode(terminal));
  }
  for (const pr of validPRs) {
    allNodes.push(prToNode(pr));
  }

  // Step 1b: Add synthetic Files + Changes/Uncommitted/Commit per worktree
  for (const wt of worktrees) {
    allNodes.push(buildFilesNode(wt.worktreeId, wt.repoId, wt.worktreePath));
    allNodes.push(...buildChangesNodes(wt.worktreeId));
  }

  // Step 2: Build children map (extracted into reusable utility)
  const childrenMap = buildChildrenMap(allNodes);

  // Step 3: Sort children per parent.
  // Items with sortKey are ordered lexicographically (ascending).
  // Items without sortKey are ordered by createdAt descending (newest first).
  // Items with sortKey sort before items without, so DnD-positioned items
  // appear in their designated spot.
  for (const children of childrenMap.values()) {
    children.sort((a, b) => {
      if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
      if (a.sortKey && !b.sortKey) return -1;
      if (!a.sortKey && b.sortKey) return 1;
      // Type priority: operational items above conversations
      const pa = typePriority(a);
      const pb = typePriority(b);
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
  }

  // Step 3b: Set isFolder dynamically based on whether node has children
  for (const node of allNodes) {
    const children = childrenMap.get(node.id);
    if (children && children.length > 0) {
      node.isFolder = true;
    }
  }

  // Step 3c: Apply expansion state
  for (const node of allNodes) {
    if (!node.isFolder) continue;
    const key = expandKey(node);
    const defaultExpanded = node.type === "worktree" || node.type === "repo"; // worktrees and repos default expanded
    node.isExpanded = ctx.expandedSections[key] ?? defaultExpanded;
  }

  // Step 4: Recursive flatten
  const result: TreeItemNode[] = [];

  function addNodeAndChildren(node: TreeItemNode, depth: number): void {
    node.depth = depth;
    result.push(node);
    if (!node.isFolder || !node.isExpanded) return;
    const children = childrenMap.get(node.id);
    if (!children) return;
    const childDepth = node.type === "repo" ? depth : depth + 1;
    for (const child of children) {
      addNodeAndChildren(child, childDepth);
    }
  }

  const roots = childrenMap.get(ROOT) ?? [];
  for (const root of roots) {
    addNodeAndChildren(root, 0);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// React hooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook that provides tree data derived from entity stores.
 * Automatically updates when any entity store or expansion state changes.
 * Returns a flat TreeItemNode[] with depth annotation for rendering.
 */
export function useTreeData(): TreeItemNode[] {
  // Reactive subscriptions to all entity stores
  const threads = useThreadStore((state) => state._threadsArray);
  const plans = usePlanStore((state) => state._plansArray);
  const terminals = useTerminalSessionStore((state) => state._sessionsArray);
  const pullRequests = usePullRequestStore((state) => state._prsArray);
  const prDetails = usePullRequestStore((state) => state.prDetails);
  const folders = useFolderStore((state) => state._foldersArray);
  const expandedSections = useTreeMenuStore((state) => state.expandedSections);
  const commitsByWorktree = useCommitStore((state) => state.commitsByWorktree);
  const pinnedWorktreeId = useTreeMenuStore((state) => state.pinnedWorktreeId);
  const repos = useRepoWorktreeLookupStore((state) => state.repos);

  // Derived: worktree info list
  const worktrees = useMemo((): WorktreeInfo[] => {
    const result: WorktreeInfo[] = [];
    for (const [repoId, repoInfo] of repos) {
      for (const [worktreeId, wtInfo] of repoInfo.worktrees) {
        result.push({
          worktreeId,
          repoId,
          repoName: repoInfo.name,
          worktreeName: wtInfo.name,
          worktreePath: wtInfo.path,
          visualSettings: wtInfo.visualSettings,
        });
      }
    }
    return result;
  }, [repos]);

  // Derived: running thread IDs
  const runningThreadIds = useMemo(
    () => new Set(threads.filter((t) => t.status === "running").map((t) => t.id)),
    [threads],
  );

  // Derived: threads with pending permission input
  const permissionRequests = usePermissionStore((state) => state.requests);
  const threadsWithPendingInput = useMemo(() => {
    const ids = new Set<string>();
    for (const req of Object.values(permissionRequests)) {
      if (req.status === "pending") ids.add(req.threadId);
    }
    return ids;
  }, [permissionRequests]);

  return useMemo(() => {
    const ctx: TreeBuildContext = {
      expandedSections,
      runningThreadIds,
      threadsWithPendingInput,
    };

    const allNodes = buildUnifiedTree(
      worktrees, folders, threads, plans, terminals, pullRequests, ctx,
    );

    // Pin filtering: show only the pinned worktree's subtree
    if (pinnedWorktreeId) {
      return allNodes.filter(
        (node) => node.id === pinnedWorktreeId || node.worktreeId === pinnedWorktreeId,
      );
    }

    return allNodes;
  }, [
    threads, plans, terminals, pullRequests, prDetails, folders,
    expandedSections, commitsByWorktree, runningThreadIds, worktrees,
    pinnedWorktreeId, threadsWithPendingInput,
  ]);
}

/**
 * Hook for getting the currently selected tree item.
 * Searches the flat items array.
 */
export function useSelectedTreeItem(): TreeItemNode | null {
  const selectedItemId = useTreeMenuStore((state) => state.selectedItemId);
  const items = useTreeData();

  return useMemo(() => {
    if (!selectedItemId) return null;
    return items.find((item) => item.id === selectedItemId) ?? null;
  }, [selectedItemId, items]);
}

/**
 * Hook for getting expansion state.
 */
export function useExpandedSections(): Record<string, boolean> {
  return useTreeMenuStore((state) => state.expandedSections);
}
