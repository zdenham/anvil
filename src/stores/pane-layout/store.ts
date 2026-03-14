import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import { type ContentPaneView, type ViewCategory, getViewCategory } from "@/components/content-pane/types";
import type { PaneLayoutPersistedState, PaneGroup, TabItem, TerminalPanelState, SplitNode } from "@core/types/pane-layout.js";
import { extractVisibleThreadIds } from "@core/lib/pane-layout.js";
import { splitLeafNode, getNodeAtPath, replaceNodeAtPath, collapseSplitAtPath, findGroupPath } from "./split-tree";
import { createGroup } from "./defaults";

interface PaneLayoutState extends PaneLayoutPersistedState {
  _hydrated: boolean;
  lastActiveGroupByCategory: Record<ViewCategory, string | null>;
  hydrate: (state: PaneLayoutPersistedState) => void;
  _applyOpenTab: (groupId: string, tab: TabItem, makeActive?: boolean) => Rollback;
  _applyCloseTab: (groupId: string, tabId: string) => Rollback;
  _applySetActiveTab: (groupId: string, tabId: string) => Rollback;
  _applySetTabView: (groupId: string, tabId: string, view: ContentPaneView) => Rollback;
  _applyMoveTab: (from: string, tabId: string, to: string, index: number) => Rollback;
  _applyReorderTabs: (groupId: string, tabIds: string[]) => Rollback;
  _applySetActiveGroup: (groupId: string) => Rollback;
  _applyCreateGroup: (group: PaneGroup) => Rollback;
  _applyRemoveGroup: (groupId: string) => Rollback;
  _applySplitGroup: (groupId: string, dir: "horizontal" | "vertical", newGroup: PaneGroup, initialSizes?: [number, number]) => Rollback;
  _applyUpdateSplitSizes: (path: number[], sizes: number[]) => Rollback;
  _applyCollapseSplit: (path: number[]) => Rollback;
  _applySplitAndMoveTab: (
    targetGroupId: string,
    direction: "horizontal" | "vertical",
    sourceGroupId: string,
    tabId: string,
  ) => { newGroupId: string; rollback: Rollback };
  _applySetTerminalPanelOpen: (isOpen: boolean) => Rollback;
  _applySetTerminalPanelHeight: (height: number) => Rollback;
  _applySetTerminalPanelMaximized: (isMaximized: boolean) => Rollback;
  _applySetTerminalPanelRoot: (root: SplitNode) => Rollback;
  _applyTerminalSplitGroup: (
    groupId: string,
    dir: "horizontal" | "vertical",
    newGroup: PaneGroup,
    initialSizes?: [number, number],
  ) => Rollback;
  _applyTerminalSplitAndMoveTab: (
    targetGroupId: string,
    direction: "horizontal" | "vertical",
    sourceGroupId: string,
    tabId: string,
  ) => { newGroupId: string; rollback: Rollback };
  _applyTerminalUpdateSplitSizes: (path: number[], sizes: number[]) => Rollback;
}

function updateGroup(s: PaneLayoutState, groupId: string, patch: Partial<PaneGroup>): Partial<PaneLayoutState> {
  const group = s.groups[groupId];
  if (!group) return {};
  return { groups: { ...s.groups, [groupId]: { ...group, ...patch } } };
}

export const usePaneLayoutStore = create<PaneLayoutState>((set, get) => ({
  root: { type: "leaf", groupId: "" },
  groups: {},
  activeGroupId: "",
  _hydrated: false,
  lastActiveGroupByCategory: { terminal: null, content: null },

  hydrate: (state) => set({ ...state, _hydrated: true }),

  _applyOpenTab: (groupId, tab, makeActive = true) => {
    const prev = get().groups[groupId];
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return updateGroup(s, groupId, {
        tabs: [...g.tabs, tab],
        activeTabId: makeActive ? tab.id : g.activeTabId,
      });
    });
    return () => { if (prev) set((s) => ({ groups: { ...s.groups, [groupId]: prev } })); };
  },

  _applyCloseTab: (groupId, tabId) => {
    const prevGroups = get().groups;
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const idx = g.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return s;
      const newTabs = g.tabs.filter((t) => t.id !== tabId);
      let activeTabId = g.activeTabId;
      if (g.activeTabId === tabId) {
        if (idx > 0) activeTabId = newTabs[idx - 1].id;
        else if (newTabs.length > 0) activeTabId = newTabs[0].id;
        else activeTabId = "";
      }
      return updateGroup(s, groupId, { tabs: newTabs, activeTabId });
    });
    return () => set({ groups: prevGroups });
  },

  _applySetActiveTab: (groupId, tabId) => {
    const prev = get().groups[groupId]?.activeTabId;
    set((s) => updateGroup(s, groupId, { activeTabId: tabId }));
    return () => { if (prev !== undefined) set((s) => updateGroup(s, groupId, { activeTabId: prev })); };
  },

  _applySetTabView: (groupId, tabId, view) => {
    const prevTab = get().groups[groupId]?.tabs.find((t) => t.id === tabId);
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return updateGroup(s, groupId, { tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, view } : t)) });
    });
    return () => {
      if (prevTab) set((s) => {
        const g = s.groups[groupId];
        if (!g) return s;
        return updateGroup(s, groupId, { tabs: g.tabs.map((t) => (t.id === tabId ? prevTab : t)) });
      });
    };
  },

  _applyMoveTab: (fromGroupId, tabId, toGroupId, index) => {
    const prevGroups = get().groups;
    set((s) => {
      const from = s.groups[fromGroupId];
      const to = s.groups[toGroupId];
      if (!from || !to) return s;
      const tab = from.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const fromTabs = from.tabs.filter((t) => t.id !== tabId);
      const toTabs = [...to.tabs];
      toTabs.splice(index, 0, tab);
      const fromActive = from.activeTabId === tabId ? (fromTabs[0]?.id ?? "") : from.activeTabId;
      return {
        groups: {
          ...s.groups,
          [fromGroupId]: { ...from, tabs: fromTabs, activeTabId: fromActive },
          [toGroupId]: { ...to, tabs: toTabs, activeTabId: tab.id },
        },
      };
    });
    return () => set({ groups: prevGroups });
  },

  _applyReorderTabs: (groupId, tabIds) => {
    const prevTabs = get().groups[groupId]?.tabs;
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const tabMap = new Map(g.tabs.map((t) => [t.id, t]));
      return updateGroup(s, groupId, { tabs: tabIds.map((id) => tabMap.get(id)!).filter(Boolean) });
    });
    return () => {
      if (prevTabs) set((s) => updateGroup(s, groupId, { tabs: prevTabs }));
    };
  },

  _applySetActiveGroup: (groupId) => {
    const prev = get().activeGroupId;
    const prevMap = { ...get().lastActiveGroupByCategory };
    set((s) => {
      // Terminal panel groups should not participate in category-aware tab routing
      const isTerminalPanelGroup = s.terminalPanel
        ? findGroupPath(s.terminalPanel.root, groupId) !== null
        : false;
      const group = s.groups[groupId];
      const activeTab = group?.tabs.find((t) => t.id === group.activeTabId);
      const category = !isTerminalPanelGroup && activeTab
        ? getViewCategory(activeTab.view.type)
        : null;
      return {
        activeGroupId: groupId,
        lastActiveGroupByCategory: category
          ? { ...s.lastActiveGroupByCategory, [category]: groupId }
          : s.lastActiveGroupByCategory,
      };
    });
    return () => set({ activeGroupId: prev, lastActiveGroupByCategory: prevMap });
  },

  _applyCreateGroup: (group) => {
    set((s) => ({ groups: { ...s.groups, [group.id]: group } }));
    return () => set((s) => { const { [group.id]: _, ...rest } = s.groups; return { groups: rest }; });
  },

  _applyRemoveGroup: (groupId) => {
    const prev = get().groups[groupId];
    const prevMap = { ...get().lastActiveGroupByCategory };
    set((s) => {
      const { [groupId]: _, ...rest } = s.groups;
      const newMap = { ...s.lastActiveGroupByCategory };
      if (newMap.terminal === groupId) newMap.terminal = null;
      if (newMap.content === groupId) newMap.content = null;
      return { groups: rest, lastActiveGroupByCategory: newMap };
    });
    return () => {
      if (prev) set((s) => ({ groups: { ...s.groups, [groupId]: prev }, lastActiveGroupByCategory: prevMap }));
    };
  },

  _applySplitGroup: (groupId, direction, newGroup, initialSizes?) => {
    const prevRoot = get().root;
    const prevGroups = get().groups;
    set((s) => ({
      root: splitLeafNode(s.root, groupId, direction, newGroup.id, initialSizes),
      groups: { ...s.groups, [newGroup.id]: newGroup },
    }));
    return () => set({ root: prevRoot, groups: prevGroups });
  },

  _applyUpdateSplitSizes: (path, sizes) => {
    const prevRoot = get().root;
    set((s) => {
      const node = getNodeAtPath(s.root, path);
      if (!node || node.type !== "split") return s;
      return { root: replaceNodeAtPath(s.root, path, { ...node, sizes }) };
    });
    return () => set({ root: prevRoot });
  },

  _applyCollapseSplit: (path) => {
    const prevRoot = get().root;
    set((s) => ({ root: collapseSplitAtPath(s.root, path) }));
    return () => set({ root: prevRoot });
  },

  _applySplitAndMoveTab: (targetGroupId, direction, sourceGroupId, tabId) => {
    const prevRoot = get().root;
    const prevGroups = get().groups;

    const sourceGroup = prevGroups[sourceGroupId];
    const tab = sourceGroup?.tabs.find((t) => t.id === tabId);
    if (!sourceGroup || !tab) return { newGroupId: "", rollback: () => {} };

    const newGroup = createGroup(tab);

    set((s) => {
      const src = s.groups[sourceGroupId];
      if (!src) return s;

      const srcTabs = src.tabs.filter((t) => t.id !== tabId);
      const srcActive = src.activeTabId === tabId
        ? (srcTabs[0]?.id ?? "")
        : src.activeTabId;

      return {
        root: splitLeafNode(s.root, targetGroupId, direction, newGroup.id),
        groups: {
          ...s.groups,
          [sourceGroupId]: { ...src, tabs: srcTabs, activeTabId: srcActive },
          [newGroup.id]: newGroup,
        },
      };
    });

    return {
      newGroupId: newGroup.id,
      rollback: () => set({ root: prevRoot, groups: prevGroups }),
    };
  },

  _applySetTerminalPanelOpen: (isOpen) => {
    const prev = get().terminalPanel;
    set((s) => ({
      terminalPanel: { ...ensureTerminalPanel(s.terminalPanel), isOpen },
    }));
    return () => set({ terminalPanel: prev });
  },

  _applySetTerminalPanelHeight: (height) => {
    const prev = get().terminalPanel;
    set((s) => ({
      terminalPanel: { ...ensureTerminalPanel(s.terminalPanel), height },
    }));
    return () => set({ terminalPanel: prev });
  },

  _applySetTerminalPanelMaximized: (isMaximized) => {
    const prev = get().terminalPanel;
    set((s) => ({
      terminalPanel: { ...ensureTerminalPanel(s.terminalPanel), isMaximized },
    }));
    return () => set({ terminalPanel: prev });
  },

  _applySetTerminalPanelRoot: (root) => {
    const prev = get().terminalPanel;
    set((s) => ({
      terminalPanel: { ...ensureTerminalPanel(s.terminalPanel), root },
    }));
    return () => set({ terminalPanel: prev });
  },

  _applyTerminalSplitGroup: (groupId, direction, newGroup, initialSizes?) => {
    const prev = get().terminalPanel;
    const prevGroups = get().groups;
    set((s) => {
      const tp = ensureTerminalPanel(s.terminalPanel);
      return {
        terminalPanel: { ...tp, root: splitLeafNode(tp.root, groupId, direction, newGroup.id, initialSizes) },
        groups: { ...s.groups, [newGroup.id]: newGroup },
      };
    });
    return () => set({ terminalPanel: prev, groups: prevGroups });
  },

  _applyTerminalSplitAndMoveTab: (targetGroupId, direction, sourceGroupId, tabId) => {
    const prevTerminal = get().terminalPanel;
    const prevGroups = get().groups;

    const sourceGroup = prevGroups[sourceGroupId];
    const tab = sourceGroup?.tabs.find((t) => t.id === tabId);
    if (!sourceGroup || !tab) return { newGroupId: "", rollback: () => {} };

    const newGroup = createGroup(tab);

    set((s) => {
      const src = s.groups[sourceGroupId];
      if (!src) return s;
      const currentTp = ensureTerminalPanel(s.terminalPanel);

      const srcTabs = src.tabs.filter((t) => t.id !== tabId);
      const srcActive = src.activeTabId === tabId
        ? (srcTabs[0]?.id ?? "")
        : src.activeTabId;

      return {
        terminalPanel: { ...currentTp, root: splitLeafNode(currentTp.root, targetGroupId, direction, newGroup.id) },
        groups: {
          ...s.groups,
          [sourceGroupId]: { ...src, tabs: srcTabs, activeTabId: srcActive },
          [newGroup.id]: newGroup,
        },
      };
    });

    return {
      newGroupId: newGroup.id,
      rollback: () => set({ terminalPanel: prevTerminal, groups: prevGroups }),
    };
  },

  _applyTerminalUpdateSplitSizes: (path, sizes) => {
    const prev = get().terminalPanel;
    set((s) => {
      const tp = ensureTerminalPanel(s.terminalPanel);
      const node = getNodeAtPath(tp.root, path);
      if (!node || node.type !== "split") return s;
      return { terminalPanel: { ...tp, root: replaceNodeAtPath(tp.root, path, { ...node, sizes }) } };
    });
    return () => set({ terminalPanel: prev });
  },
}));

const DEFAULT_TERMINAL_PANEL: TerminalPanelState = {
  root: { type: "leaf", groupId: "" },
  height: 300,
  isOpen: false,
  isMaximized: false,
};

function ensureTerminalPanel(panel: TerminalPanelState | undefined): TerminalPanelState {
  return panel ?? { ...DEFAULT_TERMINAL_PANEL };
}

// Non-reactive selectors

export function getActiveGroup(): PaneGroup | null {
  const { groups, activeGroupId } = usePaneLayoutStore.getState();
  return groups[activeGroupId] ?? null;
}

export function getActiveTab(): TabItem | null {
  const group = getActiveGroup();
  if (!group) return null;
  return group.tabs.find((t) => t.id === group.activeTabId) ?? null;
}

export function getVisibleThreadIds(): string[] {
  const state = usePaneLayoutStore.getState();
  return [...extractVisibleThreadIds(state)];
}
