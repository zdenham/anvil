import { useEffect, useCallback, useRef } from "react";
import type { DirEntry } from "@/lib/filesystem-client";
import { navigationService } from "@/stores/navigation-service";
import { useFileTree } from "./use-file-tree";
import { FileBrowserHeader } from "./file-browser-header";
import { FileTreeNode } from "./file-tree-node";
import { FileBrowserError } from "./file-browser-error";

export interface FileBrowserPanelProps {
  /** Root directory to browse (worktree path) */
  rootPath: string;
  /** Worktree context for file navigation */
  repoId: string;
  worktreeId: string;
  /** Called when panel should close */
  onClose: () => void;
}

export function FileBrowserPanel({
  rootPath,
  repoId,
  worktreeId,
  onClose,
}: FileBrowserPanelProps) {
  const tree = useFileTree(rootPath, worktreeId);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard: Escape closes panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const el = panelRef.current;
    el?.addEventListener("keydown", handleKeyDown);
    return () => el?.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFileClick = useCallback(
    (entry: DirEntry) => {
      navigationService.navigateToFile(entry.path, { repoId, worktreeId });
    },
    [repoId, worktreeId]
  );

  // Error state — matches StalePlanView pattern
  if (tree.error) {
    return (
      <FileBrowserError
        error={tree.error}
        currentPath={rootPath}
        onClose={onClose}
      />
    );
  }

  return (
    <div ref={panelRef} className="flex flex-col h-full" tabIndex={-1}>
      <FileBrowserHeader
        rootPath={rootPath}
        onRefresh={tree.refreshAll}
        onClose={onClose}
      />
      <div className="overflow-y-auto flex-1 py-1">
        {tree.rootChildren.length === 0 ? (
          <div className="flex items-center justify-center h-full text-surface-500 text-xs">
            Empty directory
          </div>
        ) : (
          <FileTreeNode
            entries={tree.rootChildren}
            depth={0}
            tree={tree}
            rootPath={rootPath}
            onFileClick={handleFileClick}
          />
        )}
      </div>
    </div>
  );
}
