/**
 * Pane Layout Event Listeners
 *
 * Handles archive events to close tabs showing archived content
 * across all groups. If closing tabs leaves a group empty,
 * the group is removed and the split tree collapses.
 *
 * Also handles worktree touch on active tab changes to keep MRU data fresh.
 */

import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "@/entities/events";
import { worktreeService } from "@/entities/worktrees";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import type { ContentPaneView } from "@/components/content-pane/types";
import { paneLayoutService } from "./service";
import { usePaneLayoutStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Close all tabs matching a predicate across every pane group.
 * Handles empty-group cleanup automatically via paneLayoutService.closeTab.
 */
async function closeMatchingTabs(
  predicate: (view: { type: string; [key: string]: unknown }) => boolean,
): Promise<void> {
  const { groups } = usePaneLayoutStore.getState();

  for (const group of Object.values(groups)) {
    for (const tab of group.tabs) {
      if (predicate(tab.view)) {
        await paneLayoutService.closeTab(group.id, tab.id);
      }
    }
  }
}

/**
 * Close all tabs belonging to a worktree.
 * Takes pre-resolved entity IDs to avoid coupling to entity services.
 */
export async function closeTabsByWorktree(opts: {
  worktreeId: string;
  threadIds: Set<string>;
  planIds: Set<string>;
  terminalIds: Set<string>;
}): Promise<void> {
  await closeMatchingTabs((view) => {
    switch (view.type) {
      case "thread":
        return opts.threadIds.has(view.threadId as string);
      case "plan":
        return opts.planIds.has(view.planId as string);
      case "terminal":
        return opts.terminalIds.has(view.terminalId as string);
      case "changes":
        return view.worktreeId === opts.worktreeId;
      case "file":
        return view.worktreeId === opts.worktreeId;
      default:
        return false;
    }
  });
}

/**
 * Setup pane layout event listeners.
 * Handles THREAD_ARCHIVED and PLAN_ARCHIVED events to close
 * tabs showing archived content across all groups.
 */
export function setupPaneLayoutListeners(): void {
  eventBus.on(
    EventName.THREAD_ARCHIVED,
    ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
      closeMatchingTabs(
        (view) => view.type === "thread" && view.threadId === threadId,
      ).catch((e) => {
        logger.error(`[PaneLayoutListener] Failed to close archived thread tabs ${threadId}:`, e);
      });
      logger.info(`[PaneLayoutListener] Closed tabs for archived thread ${threadId}`);
    },
  );

  eventBus.on(
    EventName.PLAN_ARCHIVED,
    ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
      closeMatchingTabs(
        (view) => view.type === "plan" && view.planId === planId,
      ).catch((e) => {
        logger.error(`[PaneLayoutListener] Failed to close archived plan tabs ${planId}:`, e);
      });
      logger.info(`[PaneLayoutListener] Closed tabs for archived plan ${planId}`);
    },
  );

  eventBus.on(
    EventName.TERMINAL_ARCHIVED,
    ({ terminalId }: EventPayloads[typeof EventName.TERMINAL_ARCHIVED]) => {
      closeMatchingTabs(
        (view) => view.type === "terminal" && view.terminalId === terminalId,
      ).catch((e) => {
        logger.error(`[PaneLayoutListener] Failed to close archived terminal tabs ${terminalId}:`, e);
      });
      logger.info(`[PaneLayoutListener] Closed tabs for archived terminal ${terminalId}`);
    },
  );

  // Touch worktree on active tab changes to keep MRU data fresh
  setupWorktreeTouchListener();

  logger.debug("[PaneLayoutListener] Pane layout listeners initialized");
}

/**
 * Resolve repoName and worktreePath from a view.
 * Returns null for views without worktree context.
 */
function resolveWorktreeFromView(
  view: ContentPaneView,
): { repoName: string; worktreePath: string; worktreeId: string } | null {
  let repoId: string | null = null;
  let worktreeId: string | null = null;

  switch (view.type) {
    case "thread": {
      const t = useThreadStore.getState().threads[view.threadId];
      if (!t) return null;
      repoId = t.repoId;
      worktreeId = t.worktreeId;
      break;
    }
    case "plan": {
      const p = usePlanStore.getState().plans[view.planId];
      if (!p) return null;
      repoId = p.repoId;
      worktreeId = p.worktreeId;
      break;
    }
    case "file":
      if (!view.repoId || !view.worktreeId) return null;
      repoId = view.repoId;
      worktreeId = view.worktreeId;
      break;
    case "changes":
      repoId = view.repoId;
      worktreeId = view.worktreeId;
      break;
    case "terminal": {
      const session = useTerminalSessionStore.getState().sessions[view.terminalId];
      if (!session) return null;
      worktreeId = session.worktreeId;
      // Find repoId from worktreeId
      const { repos } = useRepoWorktreeLookupStore.getState();
      for (const [rid, repo] of repos) {
        if (repo.worktrees.has(worktreeId)) {
          repoId = rid;
          break;
        }
      }
      break;
    }
    default:
      return null;
  }

  if (!repoId || !worktreeId) return null;

  const lookup = useRepoWorktreeLookupStore.getState();
  const repoName = lookup.getRepoName(repoId);
  const worktreePath = lookup.getWorktreePath(repoId, worktreeId);
  if (!worktreePath || repoName === "Unknown") return null;

  return { repoName, worktreePath, worktreeId };
}

/**
 * Subscribe to active tab changes and touch the worktree when it changes.
 * Fire-and-forget to avoid blocking tab switches.
 */
function setupWorktreeTouchListener(): void {
  let lastWorktreeId: string | null = null;

  usePaneLayoutStore.subscribe((state) => {
    const group = state.groups[state.activeGroupId];
    if (!group) return;
    const tab = group.tabs.find((t) => t.id === group.activeTabId);
    if (!tab) return;

    const resolved = resolveWorktreeFromView(tab.view);
    if (!resolved) return;

    // Only touch when worktree actually changes
    if (resolved.worktreeId === lastWorktreeId) return;
    lastWorktreeId = resolved.worktreeId;

    worktreeService.touch(resolved.repoName, resolved.worktreePath).catch((e) => {
      logger.warn("[PaneLayoutListener] Failed to touch worktree:", e);
    });
  });
}
