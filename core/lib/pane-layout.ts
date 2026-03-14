import type { PaneLayoutPersistedState } from "../types/pane-layout.js";

/**
 * Extracts thread IDs from the active tab of each pane group.
 * Pure function — no store dependency. Works with both frontend state
 * and parsed pane-layout.json from disk.
 */
export function extractVisibleThreadIds(state: PaneLayoutPersistedState): Set<string> {
  const ids = new Set<string>();
  for (const group of Object.values(state.groups)) {
    const activeTab = group.tabs.find((t) => t.id === group.activeTabId);
    if (activeTab?.view.type === "thread") {
      ids.add(activeTab.view.threadId);
    }
  }
  return ids;
}
