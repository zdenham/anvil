import { logger } from "@/lib/logger-client";
import { usePaneLayoutStore } from "./store";
import { collectGroupIds, removeLeafFromTree } from "./split-tree";
import type { PaneGroup, TerminalPanelState } from "./types";
import { createGroup, createTab, MAX_TABS_PER_GROUP } from "./defaults";

/**
 * Terminal panel service methods.
 * These are mixed into paneLayoutService — they need `persistState` injected
 * to avoid circular imports.
 */
export function createTerminalPanelMethods(persistState: () => Promise<void>) {
  return {
    async openTerminal(terminalId: string): Promise<string> {
      const store = usePaneLayoutStore.getState();

      // Check if this terminal already has a tab in any terminal group
      const terminalGroupIds = store.terminalPanel
        ? collectGroupIds(store.terminalPanel.root).filter((id) => store.groups[id])
        : [];

      for (const gid of terminalGroupIds) {
        const group = store.groups[gid];
        const existing = group?.tabs.find(
          (t) => t.view.type === "terminal" && t.view.terminalId === terminalId,
        );
        if (existing) {
          store._applySetActiveTab(gid, existing.id);
          store._applySetTerminalPanelOpen(true);
          await persistState();
          return existing.id;
        }
      }

      const panelGroupId = getOrCreateTerminalPanelGroup();
      const group = usePaneLayoutStore.getState().groups[panelGroupId];
      if (!group) throw new Error(`Terminal panel group ${panelGroupId} not found`);

      // Enforce max tabs: close leftmost if at cap
      if (group.tabs.length >= MAX_TABS_PER_GROUP) {
        await this.closeTerminalTab(panelGroupId, group.tabs[0].id);
      }

      const tab = createTab({ type: "terminal", terminalId });
      usePaneLayoutStore.getState()._applyOpenTab(panelGroupId, tab);
      usePaneLayoutStore.getState()._applySetTerminalPanelOpen(true);
      await persistState();
      logger.debug(`[paneLayoutService] Opened terminal ${terminalId} in panel group ${panelGroupId}`);
      return tab.id;
    },

    async closeTerminalTab(groupId: string, tabId: string): Promise<void> {
      const store = usePaneLayoutStore.getState();
      store._applyCloseTab(groupId, tabId);

      const updatedGroup = usePaneLayoutStore.getState().groups[groupId];
      if (!updatedGroup || updatedGroup.tabs.length === 0) {
        const terminalRoot = usePaneLayoutStore.getState().terminalPanel?.root;
        if (!terminalRoot) return;

        const terminalGroupCount = collectGroupIds(terminalRoot).length;

        if (terminalGroupCount <= 1) {
          // Last terminal group — hide the panel
          usePaneLayoutStore.getState()._applySetTerminalPanelOpen(false);
        } else {
          // Remove empty group from terminal tree
          usePaneLayoutStore.getState()._applyRemoveGroup(groupId);
          const newRoot = removeLeafFromTree(terminalRoot, groupId);
          if (newRoot) {
            usePaneLayoutStore.getState()._applySetTerminalPanelRoot(newRoot);
          } else {
            usePaneLayoutStore.getState()._applySetTerminalPanelOpen(false);
          }

          // If removed group was active, switch to another terminal group
          if (usePaneLayoutStore.getState().activeGroupId === groupId) {
            const remaining = collectGroupIds(usePaneLayoutStore.getState().terminalPanel!.root);
            if (remaining.length > 0) {
              usePaneLayoutStore.getState()._applySetActiveGroup(remaining[0]);
            }
          }
        }
      }
      await persistState();
    },

    toggleTerminalPanel(): "opened" | "closed" | "needs-terminal" {
      const store = usePaneLayoutStore.getState();
      const panel = store.terminalPanel;

      if (panel?.isOpen) {
        store._applySetTerminalPanelOpen(false);
        persistState();
        return "closed";
      }

      // Panel is closed -- check if any terminal group has tabs to reopen
      if (panel) {
        const groupIds = collectGroupIds(panel.root);
        for (const gid of groupIds) {
          const group = store.groups[gid];
          if (group && group.tabs.length > 0) {
            store._applySetTerminalPanelOpen(true);
            persistState();
            return "opened";
          }
        }
      }

      // No tabs exist -- caller needs to create a terminal first
      return "needs-terminal";
    },

    async splitTerminalGroup(
      groupId: string,
      direction: "horizontal" | "vertical",
    ): Promise<string> {
      const tab = createTab({ type: "empty" });
      const newGroup = createGroup(tab);
      usePaneLayoutStore.getState()._applyTerminalSplitGroup(groupId, direction, newGroup);
      usePaneLayoutStore.getState()._applySetActiveGroup(newGroup.id);
      await persistState();
      logger.debug(`[paneLayoutService] Terminal split group ${groupId} ${direction}, new group ${newGroup.id}`);
      return newGroup.id;
    },

    async maximizeTerminalPanel(): Promise<void> {
      usePaneLayoutStore.getState()._applySetTerminalPanelMaximized(true);
      await persistState();
    },

    async restoreTerminalPanel(): Promise<void> {
      usePaneLayoutStore.getState()._applySetTerminalPanelMaximized(false);
      await persistState();
    },

    getTerminalPanelGroup(): PaneGroup | null {
      const store = usePaneLayoutStore.getState();
      if (!store.terminalPanel) return null;
      const groupIds = collectGroupIds(store.terminalPanel.root);
      for (const gid of groupIds) {
        if (store.groups[gid]) return store.groups[gid];
      }
      return null;
    },

    getTerminalPanelState(): TerminalPanelState | null {
      return usePaneLayoutStore.getState().terminalPanel ?? null;
    },

    async setTerminalPanelHeight(height: number): Promise<void> {
      usePaneLayoutStore.getState()._applySetTerminalPanelHeight(height);
      await persistState();
    },
  };
}

/** Gets or creates the terminal panel group, returning its groupId. */
export function getOrCreateTerminalPanelGroup(): string {
  const store = usePaneLayoutStore.getState();

  if (store.terminalPanel) {
    const groupIds = collectGroupIds(store.terminalPanel.root);
    // Find first existing group
    for (const gid of groupIds) {
      if (store.groups[gid]) return gid;
    }
  }

  // No valid group found — create a new one
  const tab = createTab({ type: "empty" });
  const group = createGroup(tab);
  store._applyCreateGroup(group);
  // Remove the placeholder empty tab immediately -- openTerminal will add the real tab
  usePaneLayoutStore.getState()._applyCloseTab(group.id, tab.id);
  usePaneLayoutStore.getState()._applySetTerminalPanelRoot({ type: "leaf", groupId: group.id });
  usePaneLayoutStore.getState()._applySetTerminalPanelOpen(false);

  return group.id;
}
