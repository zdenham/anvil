import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import type { ContentPaneView } from "@/components/content-pane/types";
import { usePaneLayoutStore, getActiveGroup, getActiveTab } from "./store";
import { PaneLayoutPersistedStateSchema, type PaneLayoutPersistedState } from "@core/types/pane-layout.js";
import { removeLeafFromTree, findGroupPath, collectGroupIds } from "./split-tree";
import { createDefaultState, createGroup, createTab, MAX_TABS_PER_GROUP } from "./defaults";
import { migrateTerminalTabsFromSplitTree, migrateRawTerminalPanel } from "./migrations";
import { createTerminalPanelMethods } from "./terminal-panel-service";

const UI_STATE_PATH = "ui/pane-layout.json";

function getPersistedState(): PaneLayoutPersistedState {
  const { root, groups, activeGroupId, terminalPanel } = usePaneLayoutStore.getState();
  return { root, groups, activeGroupId, terminalPanel };
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

/** Checks if a group belongs to the terminal panel's split tree. */
function isTerminalPanelGroup(groupId: string): boolean {
  const { terminalPanel } = usePaneLayoutStore.getState();
  if (!terminalPanel) return false;
  return findGroupPath(terminalPanel.root, groupId) !== null;
}

/** Returns all group IDs in the terminal panel's split tree. */
function getTerminalGroupIds(): Set<string> {
  const { terminalPanel } = usePaneLayoutStore.getState();
  if (!terminalPanel) return new Set();
  return new Set(collectGroupIds(terminalPanel.root));
}

/** Ensure at most one ephemeral tab per group (fix corruption from older versions). */
function sanitizeEphemeralTabs(state: PaneLayoutPersistedState): void {
  for (const group of Object.values(state.groups)) {
    let foundEphemeral = false;
    for (let i = group.tabs.length - 1; i >= 0; i--) {
      if (group.tabs[i].ephemeral) {
        if (foundEphemeral) {
          group.tabs[i] = { ...group.tabs[i], ephemeral: undefined };
        }
        foundEphemeral = true;
      }
    }
  }
}

export const paneLayoutService = {
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
      if (raw) {
        const migrated = migrateRawTerminalPanel(raw);
        const result = PaneLayoutPersistedStateSchema.safeParse(migrated);
        if (result.success) {
          const migrated = migrateTerminalTabsFromSplitTree(result.data);
          sanitizeEphemeralTabs(migrated);
          usePaneLayoutStore.getState().hydrate(migrated);
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
    let targetGroupId = groupId ?? store.activeGroupId;

    // Safety net: never route non-terminal content into the terminal panel group
    if (isTerminalPanelGroup(targetGroupId) && view.type !== "terminal") {
      const terminalIds = getTerminalGroupIds();
      const contentGroupIds = Object.keys(store.groups)
        .filter((id) => !terminalIds.has(id));
      if (contentGroupIds.length > 0) {
        targetGroupId = contentGroupIds[0];
      } else {
        // No content groups exist — reset to defaults (preserving terminal panel)
        const defaults = createDefaultState();
        store.hydrate({ ...defaults, terminalPanel: store.terminalPanel });
        targetGroupId = defaults.activeGroupId;
      }
      usePaneLayoutStore.getState()._applySetActiveGroup(targetGroupId);
    }

    const group = usePaneLayoutStore.getState().groups[targetGroupId];
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

    // Delegate to terminal-specific close if this tab is in a terminal panel group
    if (isTerminalPanelGroup(groupId)) {
      await this.closeTerminalTab(groupId, tabId);
      return;
    }

    const group = store.groups[groupId];
    if (!group) return;

    const terminalIds = getTerminalGroupIds();
    const contentGroupCount = Object.keys(store.groups)
      .filter((id) => !terminalIds.has(id)).length;
    const isLastTabInLastGroup = group.tabs.length === 1 && contentGroupCount <= 1;

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

    // Terminal panel group — collapse terminal tree or hide panel
    if (isTerminalPanelGroup(groupId)) {
      const terminalRoot = store.terminalPanel!.root;
      const terminalGroupCount = collectGroupIds(terminalRoot).length;

      if (terminalGroupCount <= 1) {
        store._applySetTerminalPanelOpen(false);
        return;
      }

      store._applyRemoveGroup(groupId);
      const newTerminalRoot = removeLeafFromTree(terminalRoot, groupId);
      if (newTerminalRoot) {
        usePaneLayoutStore.getState()._applySetTerminalPanelRoot(newTerminalRoot);
      } else {
        usePaneLayoutStore.getState()._applySetTerminalPanelOpen(false);
      }

      // If removed group was active, switch to another terminal group
      if (store.activeGroupId === groupId) {
        const remaining = collectGroupIds(usePaneLayoutStore.getState().terminalPanel!.root);
        if (remaining.length > 0) {
          usePaneLayoutStore.getState()._applySetActiveGroup(remaining[0]);
        }
      }
      return;
    }

    // Content tree group
    const terminalIds = getTerminalGroupIds();
    const contentGroupCount = Object.keys(store.groups)
      .filter((id) => !terminalIds.has(id)).length;

    if (contentGroupCount <= 1) {
      const defaults = createDefaultState();
      store.hydrate({ ...defaults, terminalPanel: store.terminalPanel });
      return;
    }

    store._applyRemoveGroup(groupId);
    const newRoot = removeLeafFromTree(store.root, groupId);
    if (newRoot) {
      usePaneLayoutStore.setState({ root: newRoot });
    }

    // If removed group was active, switch to first remaining content group
    if (store.activeGroupId === groupId) {
      const termIds = getTerminalGroupIds();
      const remaining = Object.keys(usePaneLayoutStore.getState().groups)
        .filter((id) => !termIds.has(id));
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
    initialSizes?: [number, number],
  ): Promise<string> {
    const tab = createTab(view ?? { type: "empty" });
    const newGroup = createGroup(tab);
    usePaneLayoutStore.getState()._applySplitGroup(groupId, direction, newGroup, initialSizes);
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

  async updateTerminalSplitSizes(path: number[], sizes: number[]): Promise<void> {
    usePaneLayoutStore.getState()._applyTerminalUpdateSplitSizes(path, sizes);
    await persistState();
  },

  async splitAndMoveTerminalTab(
    targetGroupId: string,
    direction: "horizontal" | "vertical",
    sourceGroupId: string,
    tabId: string,
  ): Promise<string> {
    const { newGroupId } = usePaneLayoutStore
      .getState()
      ._applyTerminalSplitAndMoveTab(targetGroupId, direction, sourceGroupId, tabId);
    if (!newGroupId) return "";
    usePaneLayoutStore.getState()._applySetActiveGroup(newGroupId);

    const fromGroup = usePaneLayoutStore.getState().groups[sourceGroupId];
    if (fromGroup && fromGroup.tabs.length === 0) {
      await this._removeEmptyGroup(sourceGroupId);
    }

    await persistState();
    logger.debug(
      `[paneLayoutService] Terminal split-and-move tab ${tabId} from ${sourceGroupId} to new group ${newGroupId} (${direction})`,
    );
    return newGroupId;
  },

  async pinTab(groupId: string, tabId: string): Promise<void> {
    const group = usePaneLayoutStore.getState().groups[groupId];
    const tab = group?.tabs.find((t) => t.id === tabId);
    if (!tab?.ephemeral) return; // already pinned or not found
    usePaneLayoutStore.getState()._applyPinTab(groupId, tabId);
    await persistState();
  },

  async pinActiveTabIfEphemeral(): Promise<void> {
    const group = getActiveGroup();
    const tab = getActiveTab();
    if (group && tab?.ephemeral) {
      await this.pinTab(group.id, tab.id);
    }
  },

  async openEphemeralTab(view: ContentPaneView, groupId?: string): Promise<string> {
    const store = usePaneLayoutStore.getState();
    const targetGroupId = groupId ?? store.activeGroupId;

    // If the view already exists as a pinned tab anywhere, just activate it
    for (const group of Object.values(store.groups)) {
      const match = group.tabs.find((t) => viewsMatch(t.view, view) && !t.ephemeral);
      if (match) {
        if (group.id !== targetGroupId) {
          usePaneLayoutStore.getState()._applySetActiveGroup(group.id);
        }
        usePaneLayoutStore.getState()._applySetActiveTab(group.id, match.id);
        await persistState();
        return match.id;
      }
    }

    const group = usePaneLayoutStore.getState().groups[targetGroupId];
    if (!group) throw new Error(`Group ${targetGroupId} not found`);

    // Find existing ephemeral tab in this group
    const existingEphemeral = group.tabs.find((t) => t.ephemeral);
    if (existingEphemeral) {
      // Replace its view and activate
      usePaneLayoutStore.getState()._applySetTabView(targetGroupId, existingEphemeral.id, view);
      usePaneLayoutStore.getState()._applySetActiveTab(targetGroupId, existingEphemeral.id);
      if (targetGroupId !== store.activeGroupId) {
        usePaneLayoutStore.getState()._applySetActiveGroup(targetGroupId);
      }
      await persistState();
      return existingEphemeral.id;
    }

    // No ephemeral tab — create a new one
    if (group.tabs.length >= MAX_TABS_PER_GROUP) {
      await this.closeTab(targetGroupId, group.tabs[0].id);
    }
    const tab = createTab(view, { ephemeral: true });
    usePaneLayoutStore.getState()._applyOpenTab(targetGroupId, tab);
    await persistState();
    return tab.id;
  },

  async findOrOpenTab(view: ContentPaneView, options?: { newTab?: boolean }): Promise<void> {
    const { groups, activeGroupId } = usePaneLayoutStore.getState();

    // Check for existing tab with matching view (pinned or ephemeral)
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

    if (options?.newTab) {
      await this.openTab(view);
    } else {
      // Safety net: if active group is a terminal panel group, route through openTab
      const current = usePaneLayoutStore.getState();
      if (isTerminalPanelGroup(current.activeGroupId)) {
        await this.openTab(view);
      } else {
        await this.openEphemeralTab(view);
      }
    }
  },

  // Terminal panel methods (delegated to terminal-panel-service)
  ...createTerminalPanelMethods(persistState),

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
    default: return true; // empty, settings, logs, archive -- match by type alone
  }
}
