import type { PaneLayoutPersistedState } from "./types";
import { removeLeafFromTree, collectGroupIds } from "./split-tree";
import { createDefaultState } from "./defaults";

/**
 * Pre-parse migration: convert old terminal panel { groupId } format
 * to new { root: { type: "leaf", groupId } } format.
 * Runs on raw JSON before Zod parsing.
 */
export function migrateRawTerminalPanel(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.terminalPanel && typeof obj.terminalPanel === "object") {
    const tp = obj.terminalPanel as Record<string, unknown>;
    if ("groupId" in tp && !("root" in tp)) {
      tp.root = { type: "leaf", groupId: tp.groupId };
      delete tp.groupId;
    }
  }
  return raw;
}

/**
 * Migration: strip terminal tabs from split-tree groups.
 * Old layouts may have terminal tabs in the main split tree.
 * This removes them so they don't appear in the wrong place.
 * Does NOT re-open them in the terminal panel -- just cleans up.
 */
export function migrateTerminalTabsFromSplitTree(
  state: PaneLayoutPersistedState,
): PaneLayoutPersistedState {
  const terminalGroupIds = state.terminalPanel
    ? new Set(collectGroupIds(state.terminalPanel.root))
    : new Set<string>();
  const treeGroupIds = new Set(collectGroupIds(state.root));
  const groups = { ...state.groups };
  let root = state.root;
  const groupsToRemove: string[] = [];

  for (const groupId of treeGroupIds) {
    if (terminalGroupIds.has(groupId)) continue;

    const group = groups[groupId];
    if (!group) continue;

    const filtered = group.tabs.filter((t) => t.view.type !== "terminal");
    if (filtered.length === group.tabs.length) continue; // no terminal tabs

    if (filtered.length === 0) {
      groupsToRemove.push(groupId);
    } else {
      const activeStillExists = filtered.some((t) => t.id === group.activeTabId);
      groups[groupId] = {
        ...group,
        tabs: filtered,
        activeTabId: activeStillExists ? group.activeTabId : filtered[0].id,
      };
    }
  }

  // Remove empty groups from the tree
  for (const groupId of groupsToRemove) {
    delete groups[groupId];
    const newRoot = removeLeafFromTree(root, groupId);
    if (newRoot) {
      root = newRoot;
    }
  }

  // If all groups were removed, reset to defaults
  if (Object.keys(groups).length === 0 || (root.type === "leaf" && !groups[root.groupId])) {
    return createDefaultState();
  }

  // Ensure activeGroupId still points to a valid group
  let activeGroupId = state.activeGroupId;
  if (!groups[activeGroupId]) {
    activeGroupId = Object.keys(groups)[0];
  }

  return { ...state, root, groups, activeGroupId };
}
