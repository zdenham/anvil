import type { PaneLayoutPersistedState, PaneGroup, TabItem } from "@core/types/pane-layout.js";

/**
 * Creates a fresh default state with a single empty tab in a single group.
 */
export function createDefaultState(): PaneLayoutPersistedState {
  const groupId = crypto.randomUUID();
  const tabId = crypto.randomUUID();

  return {
    root: { type: "leaf", groupId },
    groups: {
      [groupId]: {
        id: groupId,
        tabs: [{ id: tabId, view: { type: "empty" } }],
        activeTabId: tabId,
      },
    },
    activeGroupId: groupId,
  };
}

/**
 * Creates a new pane group with a single tab.
 */
export function createGroup(tab: TabItem): PaneGroup {
  return {
    id: crypto.randomUUID(),
    tabs: [tab],
    activeTabId: tab.id,
  };
}

/**
 * Creates a new tab with the given view.
 */
export function createTab(view: TabItem["view"], options?: { ephemeral?: boolean }): TabItem {
  return { id: crypto.randomUUID(), view, ...(options?.ephemeral ? { ephemeral: true } : {}) };
}

/** Maximum number of tabs per group. */
export const MAX_TABS_PER_GROUP = 5;
