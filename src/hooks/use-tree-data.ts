import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { relationService } from "@/entities/relations/service";
import { getThreadStatusVariant, getPlanStatusVariant } from "@/utils/thread-colors";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { TerminalSession } from "@/entities/terminal-sessions/types";
import type { RepoWorktreeSection, TreeItemNode } from "@/stores/tree-menu/types";

/**
 * Get display title for a plan.
 * For readme.md files, use the parent directory name.
 */
function getPlanTitle(plan: PlanMetadata): string {
  const parts = plan.relativePath.split('/');
  const filename = parts[parts.length - 1];

  // For readme.md, use directory name as title
  if (filename.toLowerCase() === 'readme.md' && parts.length > 1) {
    return parts[parts.length - 2];
  }

  // Use filename with extension for individual markdown plans
  return filename;
}

/**
 * Build tree items for a section, handling nested plans, sub-agent threads, and terminals.
 * Returns a flat list with depth info for rendering.
 *
 * Key insight: We must sort top-level items (threads + root plans + terminals) by createdAt
 * BEFORE building the tree. This ensures children are added immediately after
 * their parent, maintaining correct visual nesting.
 *
 * Sub-agent threads are nested under their parent thread and only appear there
 * (not in date sections independently).
 */
function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  sectionId: string,
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>
): TreeItemNode[] {
  const items: TreeItemNode[] = [];

  // Group plans by parent
  const planChildrenMap = new Map<string | undefined, PlanMetadata[]>();
  for (const plan of plans) {
    const siblings = planChildrenMap.get(plan.parentId) || [];
    siblings.push(plan);
    planChildrenMap.set(plan.parentId, siblings);
  }

  // Separate root threads from sub-agent threads
  const rootThreads = threads.filter(t => !t.parentThreadId);
  const childThreadsMap = new Map<string, ThreadMetadata[]>();

  for (const thread of threads) {
    if (thread.parentThreadId) {
      const siblings = childThreadsMap.get(thread.parentThreadId) || [];
      siblings.push(thread);
      childThreadsMap.set(thread.parentThreadId, siblings);
    }
  }

  // Recursively add thread and its sub-agent children
  function addThreadAndChildren(thread: ThreadMetadata, depth: number) {
    const children = childThreadsMap.get(thread.id) || [];
    const isFolder = children.length > 0;
    // Use "thread:threadId" key convention for folder expand state
    const isExpanded = expandedSections[`thread:${thread.id}`] ?? false; // Default collapsed

    items.push({
      type: "thread" as const,
      id: thread.id,
      title: thread.name ?? "New Thread",
      status: getThreadStatusVariant(thread),
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
      sectionId,
      depth,
      isFolder,
      isExpanded,
      parentId: thread.parentThreadId,
      // Sub-agent indicator
      isSubAgent: !!thread.parentThreadId,
      agentType: thread.agentType,
    });

    // Only add children if expanded
    if (isFolder && isExpanded) {
      // Sort children by createdAt ascending (oldest first, so execution order)
      const sorted = [...children].sort((a, b) => a.createdAt - b.createdAt);
      for (const child of sorted) {
        addThreadAndChildren(child, depth + 1);
      }
    }
  }

  // Recursively add plans with depth
  function addPlanAndChildren(plan: PlanMetadata, depth: number) {
    const children = planChildrenMap.get(plan.id) || [];
    const isFolder = children.length > 0;
    // Use "plan:planId" key convention for folder expand state
    const isExpanded = expandedSections[`plan:${plan.id}`] ?? false; // Default collapsed

    // Determine if any thread related to this plan is running
    const relations = relationService.getByPlan(plan.id);
    const relatedThreadIds = relations.map((r) => r.threadId);
    const hasRunningThread = relatedThreadIds.some((id) => runningThreadIds.has(id));

    items.push({
      type: "plan",
      id: plan.id,
      title: getPlanTitle(plan),
      status: getPlanStatusVariant(plan.isRead, hasRunningThread, plan.stale),
      updatedAt: plan.updatedAt,
      createdAt: plan.createdAt,
      sectionId,
      depth,
      isFolder,
      isExpanded,
      parentId: plan.parentId,
      phaseInfo: plan.phaseInfo,
    });

    // Only add children if expanded
    if (isFolder && isExpanded) {
      const sorted = [...children].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
      );
      for (const child of sorted) {
        addPlanAndChildren(child, depth + 1);
      }
    }
  }

  // Get root plans (no parentId)
  const rootPlans = planChildrenMap.get(undefined) || [];

  // Add terminal item
  function addTerminal(terminal: TerminalSession) {
    // Terminals are never folders, always depth 0
    items.push({
      type: "terminal" as const,
      id: terminal.id,
      title: terminal.lastCommand ?? terminal.worktreePath.split("/").pop() ?? "terminal",
      // Show "read" for alive terminals, "unread" for exited (dimmed)
      status: terminal.isAlive ? "read" : "unread",
      updatedAt: terminal.createdAt, // Terminals don't have updatedAt
      createdAt: terminal.createdAt,
      sectionId,
      depth: 0,
      isFolder: false,
      isExpanded: false,
      parentId: undefined,
    });
  }

  // Create a unified list of top-level items for sorting
  interface TopLevelItem {
    type: "thread" | "root-plan" | "terminal";
    createdAt: number;
    thread?: ThreadMetadata; // For threads
    plan?: PlanMetadata; // For plans
    terminal?: TerminalSession; // For terminals
  }

  const topLevel: TopLevelItem[] = [
    ...rootThreads.map((thread) => ({ type: "thread" as const, createdAt: thread.createdAt, thread })),
    ...rootPlans.map((plan) => ({ type: "root-plan" as const, createdAt: plan.createdAt, plan })),
    ...terminals.map((terminal) => ({ type: "terminal" as const, createdAt: terminal.createdAt, terminal })),
  ];

  // Sort top-level items by createdAt descending (newest first)
  topLevel.sort((a, b) => b.createdAt - a.createdAt);

  // Add items in sorted order - threads/plans recursively add their children immediately after
  for (const item of topLevel) {
    if (item.type === "thread" && item.thread) {
      addThreadAndChildren(item.thread, 0);
    } else if (item.type === "root-plan" && item.plan) {
      addPlanAndChildren(item.plan, 0);
    } else if (item.type === "terminal" && item.terminal) {
      addTerminal(item.terminal);
    }
  }

  return items;
}

interface RepoWithWorktrees {
  repoId: string;
  repoName: string;
  worktrees: Array<{ worktreeId: string; name: string; path: string }>;
}

/**
 * Builds tree structure from entity stores.
 * Groups threads, plans, and terminals by their repo/worktree association.
 * Handles nested plans via buildSectionItems.
 *
 * @param threads - All threads from store
 * @param plans - All plans from store
 * @param terminals - All terminals from store
 * @param expandedSections - Expansion state from tree menu store
 * @param runningThreadIds - Set of thread IDs with running status
 * @param allRepos - All known repos with their worktrees (for showing empty sections)
 * @param getRepoName - Function to resolve repo name from ID
 * @param getWorktreeName - Function to resolve worktree name from IDs
 * @param getWorktreePath - Function to resolve worktree path from IDs
 */
export function buildTreeFromEntities(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>,
  allRepos: RepoWithWorktrees[],
  getRepoName: (repoId: string) => string,
  getWorktreeName: (repoId: string, worktreeId: string) => string,
  getWorktreePath: (repoId: string, worktreeId: string) => string
): RepoWorktreeSection[] {
  // Group threads, plans, and terminals by "repoId:worktreeId"
  const threadsBySection = new Map<string, ThreadMetadata[]>();
  const plansBySection = new Map<string, PlanMetadata[]>();
  const terminalsBySection = new Map<string, TerminalSession[]>();
  const sectionInfo = new Map<string, {
    repoId: string;
    worktreeId: string;
    repoName: string;
    worktreeName: string;
    worktreePath: string;
    earliestCreated: number;
  }>();

  // Helper to ensure section exists
  const ensureSection = (repoId: string, worktreeId: string) => {
    const sectionId = `${repoId}:${worktreeId}`;
    if (!sectionInfo.has(sectionId)) {
      sectionInfo.set(sectionId, {
        repoId,
        worktreeId,
        repoName: getRepoName(repoId),
        worktreeName: getWorktreeName(repoId, worktreeId),
        worktreePath: getWorktreePath(repoId, worktreeId),
        earliestCreated: Infinity,
      });
      threadsBySection.set(sectionId, []);
      plansBySection.set(sectionId, []);
      terminalsBySection.set(sectionId, []);
    }
    return sectionId;
  };

  // First, create sections for ALL known repos/worktrees (even empty ones)
  for (const repo of allRepos) {
    for (const wt of repo.worktrees) {
      ensureSection(repo.repoId, wt.worktreeId);
    }
  }

  // Group threads by section
  for (const thread of threads) {
    const sectionId = ensureSection(thread.repoId, thread.worktreeId);
    threadsBySection.get(sectionId)!.push(thread);

    const info = sectionInfo.get(sectionId)!;
    if (thread.createdAt < info.earliestCreated) {
      info.earliestCreated = thread.createdAt;
    }
  }

  // Group plans by section
  for (const plan of plans) {
    const sectionId = ensureSection(plan.repoId, plan.worktreeId);
    plansBySection.get(sectionId)!.push(plan);

    const info = sectionInfo.get(sectionId)!;
    if (plan.createdAt < info.earliestCreated) {
      info.earliestCreated = plan.createdAt;
    }
  }

  // Group terminals by section (using worktreeId only - terminals store worktreeId)
  for (const terminal of terminals) {
    // Find the section ID for this terminal's worktreeId
    for (const [sectionId, info] of sectionInfo) {
      if (info.worktreeId === terminal.worktreeId) {
        terminalsBySection.get(sectionId)!.push(terminal);

        if (terminal.createdAt < info.earliestCreated) {
          info.earliestCreated = terminal.createdAt;
        }
        break;
      }
    }
  }

  // Build sections using the new buildSectionItems helper
  const sections: RepoWorktreeSection[] = [];
  for (const [sectionId, info] of sectionInfo) {
    const sectionThreads = threadsBySection.get(sectionId) || [];
    const sectionPlans = plansBySection.get(sectionId) || [];
    const sectionTerminals = terminalsBySection.get(sectionId) || [];

    // Use buildSectionItems for proper nested plan handling
    // Note: buildSectionItems already sorts top-level items by createdAt descending
    // and ensures children immediately follow their parents
    const items = buildSectionItems(
      sectionThreads,
      sectionPlans,
      sectionTerminals,
      sectionId,
      expandedSections,
      runningThreadIds
    );

    sections.push({
      type: "repo-worktree",
      id: sectionId,
      repoName: info.repoName,
      worktreeName: info.worktreeName,
      repoId: info.repoId,
      worktreeId: info.worktreeId,
      worktreePath: info.worktreePath,
      items,
      isExpanded: expandedSections[sectionId] ?? true, // Default to expanded
    });
  }

  // Sort sections by earliest item creation (descending - newest worktrees first)
  // This provides stable ordering that doesn't change when new threads are added
  sections.sort((a, b) => {
    const aEarliest = sectionInfo.get(a.id)?.earliestCreated ?? Infinity;
    const bEarliest = sectionInfo.get(b.id)?.earliestCreated ?? Infinity;
    // Descending: worktrees you started using more recently appear first
    return bEarliest - aEarliest;
  });

  return sections;
}

/**
 * Hook that provides tree data derived from entity stores.
 * Automatically updates when threads, plans, or expansion state changes.
 *
 * Uses pre-loaded repo/worktree lookup store for synchronous name resolution.
 * The lookup store is hydrated at app init, so by the time React renders,
 * all lookups are synchronous O(1) Map accesses.
 */
export function useTreeData(): RepoWorktreeSection[] {
  // Entity stores - reactive subscriptions
  const threads = useThreadStore((state) => state._threadsArray);
  const plans = usePlanStore((state) => state.getAll());
  const terminals = useTerminalSessionStore((state) => state._sessionsArray);
  const expandedSections = useTreeMenuStore((state) => state.expandedSections);

  // Lookup functions - from pre-hydrated store (synchronous)
  const getRepoName = useRepoWorktreeLookupStore((state) => state.getRepoName);
  const getWorktreeName = useRepoWorktreeLookupStore((state) => state.getWorktreeName);
  const getWorktreePath = useRepoWorktreeLookupStore((state) => state.getWorktreePath);
  // Subscribe to repos Map directly so we re-render when repos change
  const repos = useRepoWorktreeLookupStore((state) => state.repos);

  // Get all known repos/worktrees for showing empty sections
  const allRepos = useMemo((): RepoWithWorktrees[] => {
    const result: RepoWithWorktrees[] = [];
    for (const [repoId, repoInfo] of repos) {
      const worktrees: Array<{ worktreeId: string; name: string; path: string }> = [];
      for (const [worktreeId, wtInfo] of repoInfo.worktrees) {
        worktrees.push({ worktreeId, name: wtInfo.name, path: wtInfo.path });
      }
      result.push({ repoId, repoName: repoInfo.name, worktrees });
    }
    return result;
  }, [repos]);

  // Get running thread IDs for plan status derivation
  const runningThreadIds = useMemo(() => {
    return new Set(threads.filter((t) => t.status === "running").map((t) => t.id));
  }, [threads]);

  return useMemo(() => {
    return buildTreeFromEntities(
      threads,
      plans,
      terminals,
      expandedSections,
      runningThreadIds,
      allRepos,
      getRepoName,
      getWorktreeName,
      getWorktreePath
    );
  }, [threads, plans, terminals, expandedSections, runningThreadIds, allRepos, getRepoName, getWorktreeName, getWorktreePath]);
}

/**
 * Hook for getting all tree sections (just the sections array).
 */
export function useTreeSections(): RepoWorktreeSection[] {
  return useTreeData();
}

/**
 * Hook for getting the currently selected tree item.
 */
export function useSelectedTreeItem(): TreeItemNode | null {
  const selectedItemId = useTreeMenuStore((state) => state.selectedItemId);
  const sections = useTreeData();

  return useMemo(() => {
    if (!selectedItemId) return null;
    for (const section of sections) {
      const item = section.items.find((i) => i.id === selectedItemId);
      if (item) return item;
    }
    return null;
  }, [selectedItemId, sections]);
}

/**
 * Hook for getting items in a specific section.
 */
export function useSectionItems(sectionId: string): TreeItemNode[] {
  const sections = useTreeData();
  return useMemo(() => {
    const section = sections.find((s) => s.id === sectionId);
    return section?.items ?? [];
  }, [sections, sectionId]);
}

/**
 * Hook for getting expansion state.
 */
export function useExpandedSections(): Record<string, boolean> {
  return useTreeMenuStore((state) => state.expandedSections);
}
