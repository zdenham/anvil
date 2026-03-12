/**
 * useActiveWorktreeContext Hook
 *
 * Derives the current worktree context from the active tab's view.
 * Falls back to MRU (most recently used) worktree for views without
 * worktree context (empty, settings, logs, archive, pull-request).
 *
 * Used by the command palette to determine which worktree's files to search.
 */

import { usePaneLayoutStore } from "@/stores/pane-layout/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { useMRUWorktree } from "./use-mru-worktree";

export interface ActiveWorktreeContext {
  workingDirectory: string | null;
  repoId: string | null;
  worktreeId: string | null;
}

/**
 * Derives worktree context from the currently active pane tab.
 * Returns { workingDirectory, repoId, worktreeId }.
 * Falls back to MRU worktree when the active tab has no worktree context.
 */
export function useActiveWorktreeContext(): ActiveWorktreeContext {
  const mru = useMRUWorktree();

  const activeView = usePaneLayoutStore((s) => {
    const group = s.groups[s.activeGroupId];
    if (!group) return null;
    const tab = group.tabs.find((t) => t.id === group.activeTabId);
    return tab?.view ?? null;
  });

  const threadContext = useThreadStore((s) => {
    if (activeView?.type !== "thread") return null;
    const t = s.threads[activeView.threadId];
    return t ? { repoId: t.repoId, worktreeId: t.worktreeId } : null;
  });

  const planContext = usePlanStore((s) => {
    if (activeView?.type !== "plan") return null;
    const p = s.plans[activeView.planId];
    return p ? { repoId: p.repoId, worktreeId: p.worktreeId } : null;
  });

  const terminalContext = useTerminalSessionStore((s) => {
    if (activeView?.type !== "terminal") return null;
    const t = s.sessions[activeView.terminalId];
    return t ? { worktreeId: t.worktreeId, worktreePath: t.worktreePath } : null;
  });

  // Derive repoId/worktreeId from the active view
  let repoId: string | null = null;
  let worktreeId: string | null = null;

  switch (activeView?.type) {
    case "thread":
      repoId = threadContext?.repoId ?? null;
      worktreeId = threadContext?.worktreeId ?? null;
      break;
    case "plan":
      repoId = planContext?.repoId ?? null;
      worktreeId = planContext?.worktreeId ?? null;
      break;
    case "file":
      repoId = activeView.repoId ?? null;
      worktreeId = activeView.worktreeId ?? null;
      break;
    case "changes":
      repoId = activeView.repoId;
      worktreeId = activeView.worktreeId;
      break;
    case "terminal": {
      worktreeId = terminalContext?.worktreeId ?? null;
      // Terminal sessions don't store repoId — find it from the lookup store
      if (worktreeId) {
        const { repos } = useRepoWorktreeLookupStore.getState();
        for (const [rid, repo] of repos) {
          if (repo.worktrees.has(worktreeId)) {
            repoId = rid;
            break;
          }
        }
      }
      break;
    }
  }

  // Resolve working directory from the lookup store
  if (repoId && worktreeId) {
    const path = useRepoWorktreeLookupStore.getState().getWorktreePath(repoId, worktreeId);
    if (path) {
      return { workingDirectory: path, repoId, worktreeId };
    }
  }

  // Terminal sessions carry worktreePath directly — use as fallback
  if (activeView?.type === "terminal" && terminalContext?.worktreePath) {
    return { workingDirectory: terminalContext.worktreePath, repoId, worktreeId };
  }

  // Fall back to MRU worktree
  return {
    workingDirectory: mru.workingDirectory,
    repoId: mru.repoId,
    worktreeId: mru.worktreeId,
  };
}
