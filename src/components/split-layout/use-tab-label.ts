/**
 * useTabLabel — derives tab display labels from the same stores the sidebar uses.
 *
 * For each view type, pulls from the matching entity store so that tab labels
 * stay consistent with the sidebar tree.
 */

import { useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import type { ContentPaneView } from "@/components/content-pane/types";
import { getTerminalDisplayName } from "@/entities/terminal-sessions/display-name";

/** Derive plan title identical to sidebar logic (readme.md -> parent dir name). */
function getPlanTitle(relativePath: string): string {
  const parts = relativePath.split("/");
  const filename = parts[parts.length - 1];
  if (filename.toLowerCase() === "readme.md" && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return filename;
}

/**
 * Hook that derives the display label from a ContentPaneView.
 * Uses the same underlying stores as `useTreeData` / sidebar tree items.
 */
export function useTabLabel(view: ContentPaneView): string {
  // Thread label: name or "New Thread", prefixed with "cc: " for TUI threads
  const threadName = useThreadStore(
    useCallback(
      (s) => {
        if (view.type !== "thread") return null;
        const thread = s.threads[view.threadId];
        if (!thread) return null;
        const name = thread.name ?? "New Thread";
        return thread.threadKind ? `cc: ${name}` : name;
      },
      [view],
    ),
  );

  // Plan label: getPlanTitle(relativePath)
  const planLabel = usePlanStore(
    useCallback(
      (s) => {
        if (view.type !== "plan") return null;
        const plan = s.getPlan(view.planId);
        return plan ? getPlanTitle(plan.relativePath) : null;
      },
      [view],
    ),
  );

  // Terminal label: unified display name (user label > lastCommand > auto label)
  const terminalLabel = useTerminalSessionStore(
    useCallback(
      (s) => {
        if (view.type !== "terminal") return null;
        const session = s.sessions[view.terminalId];
        if (!session) return null;
        return getTerminalDisplayName(session);
      },
      [view],
    ),
  );

  // Pull request label: "PR #N: title" or "PR #N"
  const prLabel = usePullRequestStore(
    useCallback(
      (s) => {
        if (view.type !== "pull-request") return null;
        const pr = s.pullRequests[view.prId];
        if (!pr) return null;
        const details = s.prDetails[view.prId];
        return details ? `PR #${pr.prNumber}: ${details.title}` : `PR #${pr.prNumber}`;
      },
      [view],
    ),
  );

  switch (view.type) {
    case "thread":
      return threadName ?? "New Thread"; // threadName already has cc: prefix for TUI threads
    case "plan":
      return planLabel ?? "Plan";
    case "terminal":
      return terminalLabel ?? "Terminal";
    case "file":
      return view.filePath.split("/").pop() ?? "File";
    case "pull-request":
      return prLabel ?? "Pull Request";
    case "settings":
      return "Settings";
    case "logs":
      return "Logs";
    case "archive":
      return "Archive";
    case "changes":
      return "Changes";
    case "empty":
      return "New Tab";
    default:
      return "Tab";
  }
}
