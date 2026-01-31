import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { relationService } from "@/entities/relations/service";
import { getThreadStatusVariant, getPlanStatusVariant } from "@/utils/thread-colors";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { RepoWorktreeSection, TreeItemNode } from "@/stores/tree-menu/types";

interface RepoWithWorktrees {
  repoId: string;
  repoName: string;
  worktrees: Array<{ worktreeId: string; name: string; path: string }>;
}

/**
 * Builds tree structure from entity stores.
 * Groups threads and plans by their repo/worktree association.
 * Sorts items within each section by createdAt descending (newest first).
 *
 * @param threads - All threads from store
 * @param plans - All plans from store
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
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>,
  allRepos: RepoWithWorktrees[],
  getRepoName: (repoId: string) => string,
  getWorktreeName: (repoId: string, worktreeId: string) => string,
  getWorktreePath: (repoId: string, worktreeId: string) => string
): RepoWorktreeSection[] {
  // Group items by "repoId:worktreeId"
  const sectionMap = new Map<string, {
    repoId: string;
    worktreeId: string;
    repoName: string;
    worktreeName: string;
    worktreePath: string;
    items: TreeItemNode[];
    earliestCreated: number;
  }>();

  // Helper to get or create section
  const getSection = (repoId: string, worktreeId: string) => {
    const sectionId = `${repoId}:${worktreeId}`;
    if (!sectionMap.has(sectionId)) {
      sectionMap.set(sectionId, {
        repoId,
        worktreeId,
        repoName: getRepoName(repoId),
        worktreeName: getWorktreeName(repoId, worktreeId),
        worktreePath: getWorktreePath(repoId, worktreeId),
        items: [],
        earliestCreated: Infinity,
      });
    }
    return sectionMap.get(sectionId)!;
  };

  // First, create sections for ALL known repos/worktrees (even empty ones)
  for (const repo of allRepos) {
    for (const wt of repo.worktrees) {
      getSection(repo.repoId, wt.worktreeId);
    }
  }

  // Process threads
  for (const thread of threads) {
    const status = getThreadStatusVariant(thread);
    const section = getSection(thread.repoId, thread.worktreeId);
    const sectionId = `${thread.repoId}:${thread.worktreeId}`;

    section.items.push({
      type: "thread",
      id: thread.id,
      title: thread.name ?? "New Thread",
      status,
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
      sectionId,
    });

    if (thread.createdAt < section.earliestCreated) {
      section.earliestCreated = thread.createdAt;
    }
  }

  // Process plans
  for (const plan of plans) {
    // Determine if any thread related to this plan is running
    const relations = relationService.getByPlan(plan.id);
    const relatedThreadIds = relations.map((r) => r.threadId);
    const hasRunningThread = relatedThreadIds.some((id) => runningThreadIds.has(id));

    const status = getPlanStatusVariant(plan.isRead, hasRunningThread, plan.stale);
    const section = getSection(plan.repoId, plan.worktreeId);
    const sectionId = `${plan.repoId}:${plan.worktreeId}`;

    // Extract filename from relativePath
    const filename = plan.relativePath.split("/").pop() ?? plan.relativePath;

    section.items.push({
      type: "plan",
      id: plan.id,
      title: filename,
      status,
      updatedAt: plan.updatedAt,
      createdAt: plan.createdAt,
      sectionId,
    });

    if (plan.createdAt < section.earliestCreated) {
      section.earliestCreated = plan.createdAt;
    }
  }

  // Convert to array and sort
  const sections: RepoWorktreeSection[] = [];
  for (const [sectionId, data] of sectionMap) {
    // Sort items by createdAt descending (most recent first)
    data.items.sort((a, b) => b.createdAt - a.createdAt);

    sections.push({
      type: "repo-worktree",
      id: sectionId,
      repoName: data.repoName,
      worktreeName: data.worktreeName,
      repoId: data.repoId,
      worktreeId: data.worktreeId,
      worktreePath: data.worktreePath,
      items: data.items,
      isExpanded: expandedSections[sectionId] ?? true, // Default to expanded
    });
  }

  // Sort sections by earliest item creation (descending - newest worktrees first)
  // This provides stable ordering that doesn't change when new threads are added
  sections.sort((a, b) => {
    const aEarliest = sectionMap.get(a.id)?.earliestCreated ?? Infinity;
    const bEarliest = sectionMap.get(b.id)?.earliestCreated ?? Infinity;
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
      expandedSections,
      runningThreadIds,
      allRepos,
      getRepoName,
      getWorktreeName,
      getWorktreePath
    );
  }, [threads, plans, expandedSections, runningThreadIds, allRepos, getRepoName, getWorktreeName, getWorktreePath]);
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
