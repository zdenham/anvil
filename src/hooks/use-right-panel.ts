import { useState, useCallback } from "react";

export type RightPanelState =
  | { type: "none" }
  | { type: "file-browser"; rootPath: string; repoId: string; worktreeId: string }
  | { type: "search" };

export interface UseRightPanelReturn {
  state: RightPanelState;
  openFileBrowser: (repoId: string, worktreeId: string, worktreePath: string) => void;
  openSearch: () => void;
  close: () => void;
  /** For tree menu highlight */
  fileBrowserWorktreeId: string | null;
}

export function useRightPanel(): UseRightPanelReturn {
  const [state, setState] = useState<RightPanelState>({ type: "none" });

  const openFileBrowser = useCallback(
    (repoId: string, worktreeId: string, worktreePath: string) => {
      setState((prev) => {
        // Toggle: if already open for this worktree, close it
        if (prev.type === "file-browser" && prev.worktreeId === worktreeId) {
          return { type: "none" };
        }
        return { type: "file-browser", rootPath: worktreePath, repoId, worktreeId };
      });
    },
    []
  );

  const openSearch = useCallback(() => {
    setState((prev) => {
      // If already showing search, do nothing (re-focus handled by component)
      if (prev.type === "search") return prev;
      return { type: "search" };
    });
  }, []);

  const close = useCallback(() => {
    setState({ type: "none" });
  }, []);

  const fileBrowserWorktreeId =
    state.type === "file-browser" ? state.worktreeId : null;

  return {
    state,
    openFileBrowser,
    openSearch,
    close,
    fileBrowserWorktreeId,
  };
}
