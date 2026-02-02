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

  // Otherwise use filename without extension
  return filename.replace(/\.md$/, '');
}

/**
 * Build tree items for a section, handling nested plans.
 * Returns a flat list with depth info for rendering.
 */
function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  sectionId: string,
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>
): TreeItemNode[] {
  const items: TreeItemNode[] = [];

  // Add threads (always depth 0, never folders)
  for (const thread of threads) {
    items.push({
      type: "thread",
      id: thread.id,
      title: thread.name ?? "New Thread",
      status: getThreadStatusVariant(thread),
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
      sectionId,
      depth: 0,
      isFolder: false,
      isExpanded: false,
    });
  }

  // Group plans by parent
  const childrenMap = new Map<string | undefined, PlanMetadata[]>();
  for (const plan of plans) {
    const siblings = childrenMap.get(plan.parentId) || [];
    siblings.push(plan);
    childrenMap.set(plan.parentId, siblings);
  }

  // Recursively add plans with depth
  function addPlanAndChildren(plan: PlanMetadata, depth: number) {
    const children = childrenMap.get(plan.id) || [];
    const isFolder = children.length > 0;
    // Use "plan:planId" key convention for folder expand state
    const isExpanded = expandedSections[`plan:${plan.id}`] ?? true; // Default expanded

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

  // Add root plans (no parentId)
  const rootPlans = childrenMap.get(undefined) || [];
  const sortedRoots = [...rootPlans].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
  for (const plan of sortedRoots) {
    addPlanAndChildren(plan, 0);
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
 * Groups threads and plans by their repo/worktree association.
 * Handles nested plans via buildSectionItems.
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
  // Group threads and plans by "repoId:worktreeId"
  const threadsBySection = new Map<string, ThreadMetadata[]>();
  const plansBySection = new Map<string, PlanMetadata[]>();
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

  // Build sections using the new buildSectionItems helper
  const sections: RepoWorktreeSection[] = [];
  for (const [sectionId, info] of sectionInfo) {
    const sectionThreads = threadsBySection.get(sectionId) || [];
    const sectionPlans = plansBySection.get(sectionId) || [];

    // Use buildSectionItems for proper nested plan handling
    const items = buildSectionItems(
      sectionThreads,
      sectionPlans,
      sectionId,
      expandedSections,
      runningThreadIds
    );

    // Sort items by createdAt descending (most recent first)
    // Note: For nested items, we sort only at the top level - child items are sorted alphabetically
    items.sort((a, b) => {
      // Only sort items at the same depth level
      if (a.depth !== b.depth) {
        // Keep depth order (children come after parents)
        return 0;
      }
      // For top-level items, sort by createdAt descending
      if (a.depth === 0) {
        return b.createdAt - a.createdAt;
      }
      // Nested items keep their alphabetical order from buildSectionItems
      return 0;
    });

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
