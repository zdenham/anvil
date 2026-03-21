/**
 * Helper functions that convert entities to TreeItemNode.
 * One function per entity type, consumed by buildUnifiedTree().
 */
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { relationService } from "@/entities/relations/service";
import { getThreadStatusVariant, getPlanStatusVariant } from "@/utils/thread-colors";
import { derivePrStatusDot } from "@/utils/pr-status";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { TerminalSession } from "@/entities/terminal-sessions/types";
import { getTerminalDisplayName } from "@/entities/terminal-sessions/display-name";
import type { PullRequestMetadata } from "@/entities/pull-requests/types";
import type { PullRequestDetails } from "@/entities/pull-requests/types";
import type { FolderMetadata } from "@/entities/folders/types";
import type { WorktreeInfo, TreeBuildContext } from "./use-tree-data";

function deriveReviewIcon(
  details: PullRequestDetails | undefined,
): TreeItemNode["reviewIcon"] {
  if (!details) return undefined;
  if (details.state === "MERGED") return "merged";
  if (details.state === "CLOSED") return "closed";
  if (details.isDraft) return "draft";
  if (details.reviewDecision === "APPROVED") return "approved";
  if (details.reviewDecision === "CHANGES_REQUESTED") return "changes-requested";
  return "review-required";
}

/**
 * Get display title for a plan.
 * For readme.md files, use the parent directory name.
 */
function getPlanTitle(plan: PlanMetadata): string {
  const parts = plan.relativePath.split("/");
  const filename = parts[parts.length - 1];
  if (filename.toLowerCase() === "readme.md" && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return filename;
}

export function repoToNode(repoId: string, repoName: string): TreeItemNode {
  return {
    type: "repo",
    id: repoId,
    title: repoName,
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    depth: 0,
    isFolder: true,
    isExpanded: true,
    repoId,
    repoName,
  };
}

export function worktreeToNode(wt: WorktreeInfo): TreeItemNode {
  return {
    type: "worktree",
    id: wt.worktreeId,
    title: wt.worktreeName,
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    depth: 0,
    isFolder: true,
    isExpanded: true,
    worktreeId: wt.worktreeId,
    parentId: wt.visualSettings?.parentId,
    sortKey: wt.visualSettings?.sortKey,
    repoName: wt.repoName,
    worktreeName: wt.worktreeName,
    worktreePath: wt.worktreePath,
    repoId: wt.repoId,
    isExternal: wt.isExternal,
  };
}

export function folderToNode(folder: FolderMetadata): TreeItemNode {
  return {
    type: "folder",
    id: folder.id,
    title: folder.name,
    status: "read",
    updatedAt: folder.updatedAt,
    createdAt: folder.createdAt,
    depth: 0,
    isFolder: true,
    isExpanded: false,
    worktreeId: folder.worktreeId,
    parentId: folder.visualSettings?.parentId,
    sortKey: folder.visualSettings?.sortKey,
    icon: folder.icon,
  };
}

export function threadToNode(
  thread: ThreadMetadata,
  ctx: TreeBuildContext,
): TreeItemNode {
  const baseName = thread.name ?? "New Thread";
  const title = thread.threadKind ? `cc ${baseName}` : baseName;
  return {
    type: "thread",
    id: thread.id,
    title,
    status: getThreadStatusVariant(thread, ctx.threadsWithPendingInput.has(thread.id)),
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId: thread.worktreeId,
    parentId: thread.visualSettings?.parentId ?? thread.worktreeId,
    sortKey: thread.visualSettings?.sortKey,
    isSubAgent: !!thread.parentThreadId,
    agentType: thread.agentType,
  };
}

export function planToNode(
  plan: PlanMetadata,
  runningThreadIds: Set<string>,
): TreeItemNode {
  const relations = relationService.getByPlan(plan.id);
  const hasRunningThread = relations.some((r) => runningThreadIds.has(r.threadId));

  return {
    type: "plan",
    id: plan.id,
    title: getPlanTitle(plan),
    status: getPlanStatusVariant(plan.isRead, hasRunningThread, plan.stale),
    updatedAt: plan.updatedAt,
    createdAt: plan.createdAt,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId: plan.worktreeId,
    parentId: plan.visualSettings?.parentId ?? plan.worktreeId,
    sortKey: plan.visualSettings?.sortKey,
    phaseInfo: plan.phaseInfo,
  };
}

export function terminalToNode(terminal: TerminalSession): TreeItemNode {
  return {
    type: "terminal",
    id: terminal.id,
    title: getTerminalDisplayName(terminal),
    status: terminal.isAlive ? "read" : "unread",
    updatedAt: terminal.createdAt,
    createdAt: terminal.createdAt,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId: terminal.worktreeId,
    parentId: terminal.visualSettings?.parentId ?? terminal.worktreeId,
    sortKey: terminal.visualSettings?.sortKey,
  };
}

export function prToNode(pr: PullRequestMetadata): TreeItemNode {
  const details = usePullRequestStore.getState().getPrDetails(pr.id);
  return {
    type: "pull-request",
    id: pr.id,
    title: details ? `PR #${pr.prNumber}: ${details.title}` : `PR #${pr.prNumber}`,
    status: derivePrStatusDot(details),
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId: pr.worktreeId,
    parentId: pr.visualSettings?.parentId ?? pr.worktreeId,
    sortKey: pr.visualSettings?.sortKey,
    prNumber: pr.prNumber,
    isViewed: pr.isViewed ?? true,
    reviewIcon: deriveReviewIcon(details),
  };
}

/** Build a flat Changes leaf node for a worktree. */
export function buildChangesNode(worktreeId: string): TreeItemNode {
  return {
    type: "changes",
    id: `changes:${worktreeId}`,
    title: "Changes",
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId,
    parentId: worktreeId,
  };
}

/** Build a flat Files leaf node for a worktree. */
export function buildFilesNode(worktreeId: string): TreeItemNode {
  return {
    type: "files",
    id: `files:${worktreeId}`,
    title: "Files",
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId,
    parentId: worktreeId,
  };
}
