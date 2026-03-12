import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FilesystemClient, type DirEntry } from "@/lib/filesystem-client";
import { navigationService } from "@/stores/navigation-service";
import { logger } from "@/lib/logger-client";
import { useChangesViewStore } from "@/stores/changes-view-store";
import { useFileTree, type FileTreeState } from "./use-file-tree";
import { FileBrowserHeader } from "./file-browser-header";
import { FileTreeNode, type CreatingEntry } from "./file-tree-node";
import { InlineCreationInput } from "./inline-creation-input";
import { FileBrowserError } from "./file-browser-error";
import { filterChangedEntries } from "./filter-changed-files";

const fsClient = new FilesystemClient();

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
  const [creatingEntry, setCreatingEntry] = useState<CreatingEntry>(null);
  const creatingEntryRef = useRef(creatingEntry);
  creatingEntryRef.current = creatingEntry;

  // Changes view state from cross-component store
  const activeWorktreeId = useChangesViewStore((s) => s.activeWorktreeId);
  const changedFilePaths = useChangesViewStore((s) => s.changedFilePaths);
  const selectFile = useChangesViewStore((s) => s.selectFile);
  const isChangesViewActive = activeWorktreeId === worktreeId && changedFilePaths.size > 0;

  // Convert relative changed paths to absolute for filtering
  const changedAbsolutePaths = useMemo(() => {
    if (!isChangesViewActive) return new Set<string>();
    const abs = new Set<string>();
    const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
    for (const relPath of changedFilePaths) {
      abs.add(prefix + relPath);
    }
    return abs;
  }, [isChangesViewActive, changedFilePaths, rootPath]);

  // Auto-expand directories containing changed files
  useEffect(() => {
    if (!isChangesViewActive) return;
    const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
    const dirsToExpand = new Set<string>();
    for (const relPath of changedFilePaths) {
      const parts = relPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        dirsToExpand.add(prefix + parts.slice(0, i).join("/"));
      }
    }
    for (const dirPath of dirsToExpand) {
      if (!tree.expandedPaths.has(dirPath)) {
        tree.toggleFolder(dirPath);
      }
    }
  }, [isChangesViewActive, changedFilePaths, rootPath]);

  // Build filtered tree proxy when changes view is active
  const filteredTree = useMemo((): FileTreeState => {
    if (!isChangesViewActive) return tree;
    return {
      ...tree,
      rootChildren: filterChangedEntries(tree.rootChildren, changedAbsolutePaths).filtered,
      childrenCache: new Map(
        Array.from(tree.childrenCache.entries()).map(([dirPath, children]) => [
          dirPath,
          filterChangedEntries(children, changedAbsolutePaths).filtered,
        ])
      ),
    };
  }, [isChangesViewActive, tree, changedAbsolutePaths]);

  // Keyboard: Escape closes panel (unless in creation mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creatingEntryRef.current) {
        onClose();
      }
    };

    const el = panelRef.current;
    el?.addEventListener("keydown", handleKeyDown);
    return () => el?.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Keyboard: Cmd+Shift+N creates new file at root
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "n") {
        e.preventDefault();
        e.stopPropagation();
        setCreatingEntry({ parentPath: rootPath, type: "file" });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [rootPath]);

  const handleFileClick = useCallback(
    (entry: DirEntry) => {
      if (isChangesViewActive) {
        // Convert absolute path back to relative for the store
        const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
        const relativePath = entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path;
        selectFile(relativePath);
      } else {
        navigationService.navigateToFile(entry.path, { repoId, worktreeId });
      }
    },
    [isChangesViewActive, rootPath, repoId, worktreeId, selectFile]
  );

  const handleStartCreate = useCallback((parentPath: string, type: "file" | "directory") => {
    setCreatingEntry({ parentPath, type });
    if (parentPath !== rootPath && !tree.expandedPaths.has(parentPath)) {
      tree.toggleFolder(parentPath);
    }
  }, [rootPath, tree]);

  const handleConfirmCreate = useCallback(async (name: string) => {
    if (!creatingEntry) return;
    const fullPath = `${creatingEntry.parentPath}/${name}`;
    try {
      if (creatingEntry.type === "file") {
        await fsClient.writeFile(fullPath, "");
        navigationService.navigateToFile(fullPath, { repoId, worktreeId });
      } else {
        await fsClient.mkdir(fullPath);
      }
    } catch (err) {
      logger.error("[FileBrowserPanel] Failed to create entry:", err);
    }
    setCreatingEntry(null);
  }, [creatingEntry, repoId, worktreeId]);

  const handleDelete = useCallback(async (entry: DirEntry) => {
    try {
      if (entry.isDirectory) {
        await fsClient.removeAll(entry.path);
      } else {
        await fsClient.remove(entry.path);
      }
    } catch (err) {
      logger.error("[FileBrowserPanel] Failed to delete:", err);
    }
  }, []);

  const handleCancelCreate = useCallback(() => {
    setCreatingEntry(null);
  }, []);

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
        {creatingEntry?.parentPath === rootPath && (
          <InlineCreationInput
            type={creatingEntry.type}
            depth={0}
            onConfirm={handleConfirmCreate}
            onCancel={handleCancelCreate}
          />
        )}
        {filteredTree.rootChildren.length === 0 ? (
          !creatingEntry && (
            <div className="flex items-center justify-center h-full text-surface-500 text-xs">
              {isChangesViewActive ? "No changed files" : "Empty directory"}
            </div>
          )
        ) : (
          <FileTreeNode
            entries={filteredTree.rootChildren}
            depth={0}
            tree={filteredTree}
            rootPath={rootPath}
            onFileClick={handleFileClick}
            onDelete={handleDelete}
            creatingEntry={creatingEntry}
            onStartCreate={handleStartCreate}
            onConfirmCreate={handleConfirmCreate}
            onCancelCreate={handleCancelCreate}
          />
        )}
      </div>
    </div>
  );
}
