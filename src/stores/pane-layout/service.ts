import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import type { ContentPaneView } from "@/components/content-pane/types";
import { usePaneLayoutStore, getActiveGroup, getActiveTab } from "./store";
import { PaneLayoutPersistedStateSchema, type PaneLayoutPersistedState } from "./types";
import { removeLeafFromTree, findGroupPath } from "./split-tree";
import { createDefaultState, createGroup, createTab, MAX_TABS_PER_GROUP } from "./defaults";

const UI_STATE_PATH = "ui/pane-layout.json";

function getPersistedState(): PaneLayoutPersistedState {
  const { root, groups, activeGroupId } = usePaneLayoutStore.getState();
  return { root, groups, activeGroupId };
}

/** Strip ephemeral fields (autoFocus) before persisting. */
function stripEphemeral(state: PaneLayoutPersistedState): PaneLayoutPersistedState {
  const groups = { ...state.groups };
  for (const [id, group] of Object.entries(groups)) {
    groups[id] = {
      ...group,
      tabs: group.tabs.map((tab) => {
        if (tab.view.type === "thread" && tab.view.autoFocus) {
          const { autoFocus: _, ...view } = tab.view;
          return { ...tab, view };
        }
        return tab;
      }),
    };
  }
  return { ...state, groups };
}

async function persistState(): Promise<void> {
  const state = stripEphemeral(getPersistedState());
  await appData.ensureDir("ui");
  await appData.writeJson(UI_STATE_PATH, state);
}

export const paneLayoutService = {
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
      if (raw) {
        const result = PaneLayoutPersistedStateSchema.safeParse(raw);
        if (result.success) {
          usePaneLayoutStore.getState().hydrate(result.data);
          logger.debug("[paneLayoutService] Hydrated from disk");
          return;
        }
        logger.warn("[paneLayoutService] Invalid state on disk, using defaults:", result.error);
      }
      const defaults = createDefaultState();
      usePaneLayoutStore.getState().hydrate(defaults);
      await persistState();
      logger.debug("[paneLayoutService] Created default state");
    } catch (err) {
      logger.error("[paneLayoutService] Failed to hydrate:", err);
      const defaults = createDefaultState();
      usePaneLayoutStore.getState().hydrate(defaults);
    }
  },

  async openTab(view: ContentPaneView, groupId?: string): Promise<string> {
    const store = usePaneLayoutStore.getState();
    const targetGroupId = groupId ?? store.activeGroupId;
    const group = store.groups[targetGroupId];
    if (!group) throw new Error(`Group ${targetGroupId} not found`);

    // Enforce max tabs: close leftmost if at cap
    if (group.tabs.length >= MAX_TABS_PER_GROUP) {
      await this.closeTab(targetGroupId, group.tabs[0].id);
    }

    const tab = createTab(view);
    store._applyOpenTab(targetGroupId, tab);
    await persistState();
    logger.debug(`[paneLayoutService] Opened tab ${tab.id} in group ${targetGroupId}`);
    return tab.id;
  },

  async closeTab(groupId: string, tabId: string): Promise<void> {
    const store = usePaneLayoutStore.getState();
    const group = store.groups[groupId];
    if (!group) return;

    const groupCount = Object.keys(store.groups).length;
    const isLastTabInLastGroup = group.tabs.length === 1 && groupCount <= 1;

    if (isLastTabInLastGroup) {
      store._applySetTabView(groupId, tabId, { type: "empty" });
      await persistState();
      return;
    }

    store._applyCloseTab(groupId, tabId);
    const updatedGroup = usePaneLayoutStore.getState().groups[groupId];

    if (!updatedGroup || updatedGroup.tabs.length === 0) {
      await this._removeEmptyGroup(groupId);
    }
    await persistState();
  },

  /** Removes an empty group and collapses its parent split. Resets to default if last group.
   *  Note: closeTab guards against this for the last-tab-in-last-group case (switches to empty view).
   *  This reset path is a fallback for edge cases like split cleanup. */
  async _removeEmptyGroup(groupId: string): Promise<void> {
    const store = usePaneLayoutStore.getState();
    const groupCount = Object.keys(store.groups).length;

    if (groupCount <= 1) {
      // Fallback: last group reset (closeTab normally handles this via empty-view transition)
      const defaults = createDefaultState();
      store.hydrate(defaults);
      return;
    }

    store._applyRemoveGroup(groupId);
    const newRoot = removeLeafFromTree(store.root, groupId);
    if (newRoot) {
      usePaneLayoutStore.setState({ root: newRoot });
    }

    // If removed group was active, switch to first remaining
    if (store.activeGroupId === groupId) {
      const remaining = Object.keys(usePaneLayoutStore.getState().groups);
      if (remaining.length > 0) {
        usePaneLayoutStore.getState()._applySetActiveGroup(remaining[0]);
      }
    }
  },

  async setActiveTab(groupId: string, tabId: string): Promise<void> {
    usePaneLayoutStore.getState()._applySetActiveTab(groupId, tabId);
    await persistState();
  },

  async setActiveTabView(view: ContentPaneView): Promise<void> {
    const group = getActiveGroup();
    const tab = getActiveTab();
    if (!group || !tab) return;
    usePaneLayoutStore.getState()._applySetTabView(group.id, tab.id, view);
    await persistState();
  },

  async moveTab(fromGroupId: string, tabId: string, toGroupId: string, index: number): Promise<void> {
    usePaneLayoutStore.getState()._applyMoveTab(fromGroupId, tabId, toGroupId, index);
    await persistState();
  },

  async reorderTabs(groupId: string, tabIds: string[]): Promise<void> {
    usePaneLayoutStore.getState()._applyReorderTabs(groupId, tabIds);
    await persistState();
  },

  async setActiveGroup(groupId: string): Promise<void> {
    usePaneLayoutStore.getState()._applySetActiveGroup(groupId);
    await persistState();
  },

  async splitGroup(
    groupId: string,
    direction: "horizontal" | "vertical",
    view?: ContentPaneView,
  ): Promise<string> {
    const tab = createTab(view ?? { type: "empty" });
    const newGroup = createGroup(tab);
    usePaneLayoutStore.getState()._applySplitGroup(groupId, direction, newGroup);
    usePaneLayoutStore.getState()._applySetActiveGroup(newGroup.id);
    await persistState();
    logger.debug(`[paneLayoutService] Split group ${groupId} ${direction}, new group ${newGroup.id}`);
    return newGroup.id;
  },

  async splitAndMoveTab(
    targetGroupId: string,
    direction: "horizontal" | "vertical",
    sourceGroupId: string,
    tabId: string,
  ): Promise<string> {
    const { newGroupId } = usePaneLayoutStore
      .getState()
      ._applySplitAndMoveTab(targetGroupId, direction, sourceGroupId, tabId);
    if (!newGroupId) return "";
    usePaneLayoutStore.getState()._applySetActiveGroup(newGroupId);

    // Clean up empty source group
    const fromGroup = usePaneLayoutStore.getState().groups[sourceGroupId];
    if (fromGroup && fromGroup.tabs.length === 0) {
      await this._removeEmptyGroup(sourceGroupId);
    }

    await persistState();
    logger.debug(
      `[paneLayoutService] Split-and-move tab ${tabId} from ${sourceGroupId} to new group ${newGroupId} (${direction})`,
    );
    return newGroupId;
  },

  async updateSplitSizes(path: number[], sizes: number[]): Promise<void> {
    usePaneLayoutStore.getState()._applyUpdateSplitSizes(path, sizes);
    await persistState();
  },

  async openInBottomPane(view: ContentPaneView): Promise<string> {
    const { root, activeGroupId } = usePaneLayoutStore.getState();

    // If root is already a vertical split, reuse the last child leaf as the bottom group
    if (root.type === "split" && root.direction === "vertical") {
      const lastChild = root.children[root.children.length - 1];
      if (lastChild.type === "leaf") {
        const tabId = await this.openTab(view, lastChild.groupId);
        usePaneLayoutStore.getState()._applySetActiveGroup(lastChild.groupId);
        return tabId;
      }
    }

    // Otherwise, split the active group vertically to create a bottom pane
    const newGroupId = await this.splitGroup(activeGroupId, "vertical", view);

    // Adjust sizes to 65/35 (main on top, terminal on bottom)
    const newRoot = usePaneLayoutStore.getState().root;
    const groupPath = findGroupPath(newRoot, newGroupId);
    if (groupPath && groupPath.length > 0) {
      const parentPath = groupPath.slice(0, -1);
      await this.updateSplitSizes(parentPath, [65, 35]);
    }

    return newGroupId;
  },

  async findOrOpenTab(
    view: ContentPaneView,
    options?: { newTab?: boolean },
  ): Promise<void> {
    const { groups, activeGroupId } = usePaneLayoutStore.getState();

    // Search all groups for a matching tab
    for (const group of Object.values(groups)) {
      const match = group.tabs.find((t) => viewsMatch(t.view, view));
      if (match) {
        if (group.id !== activeGroupId) {
          usePaneLayoutStore.getState()._applySetActiveGroup(group.id);
        }
        usePaneLayoutStore.getState()._applySetActiveTab(group.id, match.id);
        await persistState();
        return;
      }
    }

    // Not found: open new tab or replace active
    if (options?.newTab) {
      await this.openTab(view);
    } else {
      await this.setActiveTabView(view);
    }
  },

  getActiveGroup,
  getActiveTab,
};

/** Checks if two views match by type and primary identifier. */
function viewsMatch(a: ContentPaneView, b: ContentPaneView): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "thread": return b.type === "thread" && a.threadId === b.threadId;
    case "plan": return b.type === "plan" && a.planId === b.planId;
    case "terminal": return b.type === "terminal" && a.terminalId === b.terminalId;
    case "file": return b.type === "file" && a.filePath === b.filePath;
    case "pull-request": return b.type === "pull-request" && a.prId === b.prId;
    case "changes":
      return b.type === "changes" &&
        a.repoId === b.repoId &&
        a.worktreeId === b.worktreeId &&
        a.commitHash === b.commitHash &&
        a.uncommittedOnly === b.uncommittedOnly;
    default: return true; // empty, settings, logs, archive — match by type alone
  }
}
