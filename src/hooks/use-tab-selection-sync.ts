/**
 * Tab Selection Sync Hook
 *
 * Subscribes to the pane layout store and syncs the sidebar tree selection
 * whenever the active tab changes (e.g., user clicks a tab directly).
 *
 * Maps view types to their corresponding tree item IDs:
 * - thread -> threadId
 * - plan -> planId
 * - terminal -> terminalId
 * - pull-request -> prId
 * - others -> null (no tree item)
 */

import { useEffect, useRef } from "react";
import { usePaneLayoutStore } from "@/stores/pane-layout";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { ContentPaneView } from "@/components/content-pane/types";

/** Derives the tree item ID from a content pane view. */
function getTreeItemId(view: ContentPaneView): string | null {
  switch (view.type) {
    case "thread": return view.threadId;
    case "plan": return view.planId;
    case "terminal": return view.terminalId;
    case "pull-request": return view.prId;
    default: return null;
  }
}

/**
 * Syncs tree selection when the active tab changes via direct tab clicks.
 * Should be called once in the root layout component.
 */
export function useTabSelectionSync(): void {
  const prevViewRef = useRef<ContentPaneView | null>(null);

  useEffect(() => {
    const unsubscribe = usePaneLayoutStore.subscribe((state) => {
      const group = state.groups[state.activeGroupId];
      if (!group) return;
      const tab = group.tabs.find((t) => t.id === group.activeTabId);
      if (!tab) return;

      const currentView = tab.view;
      const prevView = prevViewRef.current;

      // Only sync when the view actually changed
      if (prevView && viewsEqual(prevView, currentView)) return;
      prevViewRef.current = currentView;

      const treeItemId = getTreeItemId(currentView);
      treeMenuService.setSelectedItem(treeItemId);
    });

    return unsubscribe;
  }, []);
}

/** Shallow equality check for views to avoid redundant syncs. */
function viewsEqual(a: ContentPaneView, b: ContentPaneView): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "thread": return b.type === "thread" && a.threadId === b.threadId;
    case "plan": return b.type === "plan" && a.planId === b.planId;
    case "terminal": return b.type === "terminal" && a.terminalId === b.terminalId;
    case "file": return b.type === "file" && a.filePath === b.filePath;
    case "pull-request": return b.type === "pull-request" && a.prId === b.prId;
    case "changes":
      return b.type === "changes" && a.repoId === b.repoId && a.worktreeId === b.worktreeId;
    default: return true;
  }
}
