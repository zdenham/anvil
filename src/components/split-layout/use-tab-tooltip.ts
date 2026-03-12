/**
 * useTabTooltip — builds a breadcrumb-style tooltip string for tab hover.
 *
 * Format: "repoName / worktreeName / category / itemLabel"
 * Includes worktreeName in the path.
 */

import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { useShallow } from "zustand/react/shallow";
import { useTabLabel } from "./use-tab-label";
import type { ContentPaneView } from "@/components/content-pane/types";

interface ViewIds {
  repoId: string | undefined;
  worktreeId: string | undefined;
  category: string;
  itemLabel: string;
}

function useViewIds(view: ContentPaneView): ViewIds {
  const thread = useThreadStore(
    useShallow((s) => {
      if (view.type !== "thread") return null;
      const t = s.threads[view.threadId];
      return t ? { repoId: t.repoId, worktreeId: t.worktreeId, name: t.name } : null;
    }),
  );

  const plan = usePlanStore(
    useShallow((s) => {
      if (view.type !== "plan") return null;
      const p = s.getPlan(view.planId);
      return p ? { repoId: p.repoId, worktreeId: p.worktreeId } : null;
    }),
  );

  switch (view.type) {
    case "thread":
      return {
        repoId: thread?.repoId,
        worktreeId: thread?.worktreeId,
        category: "threads",
        itemLabel: thread?.name ?? "New Thread",
      };
    case "plan":
      return {
        repoId: plan?.repoId,
        worktreeId: plan?.worktreeId,
        category: "plans",
        itemLabel: "", // filled by useTabLabel
      };
    case "changes":
      return {
        repoId: view.repoId,
        worktreeId: view.worktreeId,
        category: "changes",
        itemLabel: "",
      };
    default:
      return { repoId: undefined, worktreeId: undefined, category: view.type, itemLabel: "" };
  }
}

export function useTabTooltip(view: ContentPaneView): string {
  const { repoId, worktreeId, category, itemLabel } = useViewIds(view);
  const tabLabel = useTabLabel(view);

  const getRepoName = useRepoWorktreeLookupStore((s) => s.getRepoName);
  const getWorktreeName = useRepoWorktreeLookupStore((s) => s.getWorktreeName);

  const repoName = repoId ? getRepoName(repoId) : undefined;
  const worktreeName =
    repoId && worktreeId ? getWorktreeName(repoId, worktreeId) : undefined;

  const label = itemLabel || tabLabel;
  const parts: string[] = [];

  if (repoName) parts.push(repoName);
  if (worktreeName) parts.push(worktreeName);
  parts.push(category);
  parts.push(label);

  return parts.join(" / ");
}
