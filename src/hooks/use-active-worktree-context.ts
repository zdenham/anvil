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

  // Return store entities directly (stable references) — creating new object
  // literals in selectors triggers useSyncExternalStore's "getSnapshot should
  // be cached" warning because each call produces a fresh reference.
  const thread = useThreadStore((s) =>
    activeView?.type === "thread" ? s.threads[activeView.threadId] ?? null : null,
  );

  const plan = usePlanStore((s) =>
    activeView?.type === "plan" ? s.plans[activeView.planId] ?? null : null,
  );

  const terminal = useTerminalSessionStore((s) =>
    activeView?.type === "terminal" ? s.sessions[activeView.terminalId] ?? null : null,
  );

  // Derive repoId/worktreeId from the active view
  let repoId: string | null = null;
  let worktreeId: string | null = null;

  switch (activeView?.type) {
    case "thread":
      repoId = thread?.repoId ?? null;
      worktreeId = thread?.worktreeId ?? null;
      break;
    case "plan":
      repoId = plan?.repoId ?? null;
      worktreeId = plan?.worktreeId ?? null;
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
      worktreeId = terminal?.worktreeId ?? null;
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
  if (activeView?.type === "terminal" && terminal?.worktreePath) {
    return { workingDirectory: terminal.worktreePath, repoId, worktreeId };
  }

  // Fall back to MRU worktree
  return {
    workingDirectory: mru.workingDirectory,
    repoId: mru.repoId,
    worktreeId: mru.worktreeId,
  };
}
