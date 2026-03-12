import { useState, useCallback } from "react";

export type RightPanelTab = "search" | "files" | "changelog";

export interface RightPanelState {
  isOpen: boolean;
  activeTab: RightPanelTab;
  /** Explicit worktree override from tree menu "Files" button. Cleared when tab switches away. */
  filesWorktreeOverride: { repoId: string; worktreeId: string; rootPath: string } | null;
}

export interface UseRightPanelReturn {
  state: RightPanelState;
  /** Toggle panel open/close. Remembers last active tab. */
  toggle: () => void;
  /** Open panel to a specific tab */
  openTab: (tab: RightPanelTab) => void;
  /** Open Files tab with explicit worktree (from tree menu) */
  openFileBrowser: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Open Search tab (Cmd+Shift+F) */
  openSearch: () => void;
  /** Close the panel */
  close: () => void;
  /** Active tab for external consumers */
  activeTab: RightPanelTab;
  /** Whether panel is open */
  isOpen: boolean;
}

const DEFAULT_STATE: RightPanelState = {
  isOpen: false,
  activeTab: "files",
  filesWorktreeOverride: null,
};

export function useRightPanel(): UseRightPanelReturn {
  const [state, setState] = useState<RightPanelState>(DEFAULT_STATE);

  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
  }, []);

  const openTab = useCallback((tab: RightPanelTab) => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      activeTab: tab,
      filesWorktreeOverride: tab === "files" ? prev.filesWorktreeOverride : null,
    }));
  }, []);

  const openFileBrowser = useCallback(
    (repoId: string, worktreeId: string, worktreePath: string) => {
      setState((prev) => ({
        ...prev,
        isOpen: true,
        activeTab: "files",
        filesWorktreeOverride: { repoId, worktreeId, rootPath: worktreePath },
      }));
    },
    [],
  );

  const openSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      activeTab: "search",
      filesWorktreeOverride: prev.activeTab === "files" ? prev.filesWorktreeOverride : null,
    }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return {
    state,
    toggle,
    openTab,
    openFileBrowser,
    openSearch,
    close,
    activeTab: state.activeTab,
    isOpen: state.isOpen,
  };
}
