import { useState, useCallback, useEffect } from "react";

export interface FileBrowserContext {
  rootPath: string;
  repoId: string;
  worktreeId: string;
}

interface UseFileBrowserPanelReturn {
  fileBrowserContext: FileBrowserContext | null;
  /** Toggle file browser for a worktree. Closes if already open for same worktree. */
  handleOpenFileBrowser: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Close the file browser panel. */
  closeFileBrowser: () => void;
  /** Active worktree ID (for tree menu highlight), or null. */
  fileBrowserWorktreeId: string | null;
}

export function useFileBrowserPanel(): UseFileBrowserPanelReturn {
  const [fileBrowserContext, setFileBrowserContext] = useState<FileBrowserContext | null>(null);

  const handleOpenFileBrowser = useCallback(
    (repoId: string, worktreeId: string, worktreePath: string) => {
      setFileBrowserContext((prev) => {
        // Toggle: if already open for this worktree, close it
        if (prev?.worktreeId === worktreeId) return null;
        return { rootPath: worktreePath, repoId, worktreeId };
      });
    },
    []
  );

  const closeFileBrowser = useCallback(() => {
    setFileBrowserContext(null);
  }, []);

  // Escape key dismisses the panel (per decisions: "Escape key toggles it off")
  useEffect(() => {
    if (!fileBrowserContext) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFileBrowserContext(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fileBrowserContext]);

  return {
    fileBrowserContext,
    handleOpenFileBrowser,
    closeFileBrowser,
    fileBrowserWorktreeId: fileBrowserContext?.worktreeId ?? null,
  };
}
