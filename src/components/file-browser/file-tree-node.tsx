import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import type { DirEntry } from "@/lib/filesystem-client";
import { getFileIconUrl } from "./file-icons";
import type { FileTreeState } from "./use-file-tree";
import { getTreeIndentPx } from "@/lib/tree-indent";

interface FileTreeNodeProps {
  /** Directory entries to render at this level */
  entries: DirEntry[];
  /** Current nesting depth (0 = root level) */
  depth: number;
  /** Tree state from useFileTree hook */
  tree: FileTreeState;
  /** Called when a file entry is clicked */
  onFileClick: (entry: DirEntry) => void;
}

/**
 * Recursive tree node component that renders directory entries
 * with expand/collapse for folders and file icons for files.
 */
export function FileTreeNode({
  entries,
  depth,
  tree,
  onFileClick,
}: FileTreeNodeProps) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeEntry
          key={entry.path}
          entry={entry}
          depth={depth}
          tree={tree}
          onFileClick={onFileClick}
        />
      ))}
    </>
  );
}

interface FileTreeEntryProps {
  entry: DirEntry;
  depth: number;
  tree: FileTreeState;
  onFileClick: (entry: DirEntry) => void;
}

function FileTreeEntry({
  entry,
  depth,
  tree,
  onFileClick,
}: FileTreeEntryProps) {
  const isExpanded = tree.expandedPaths.has(entry.path);
  const isLoading = tree.loadingPaths.has(entry.path);
  const children = tree.childrenCache.get(entry.path);

  if (entry.isDirectory) {
    return (
      <FolderEntry
        entry={entry}
        depth={depth}
        isExpanded={isExpanded}
        isLoading={isLoading}
        tree={tree}
        onFileClick={onFileClick}
        children={children}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => onFileClick(entry)}
      className="flex items-center gap-1 w-full py-1 text-xs text-surface-200 hover:bg-surface-800 cursor-pointer select-none truncate"
      style={{ paddingLeft: getTreeIndentPx(depth) }}
    >
      <img
        src={getFileIconUrl(entry.name)}
        alt=""
        className="w-3 h-3 flex-shrink-0"
      />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

interface FolderEntryProps {
  entry: DirEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  tree: FileTreeState;
  onFileClick: (entry: DirEntry) => void;
  children: DirEntry[] | undefined;
}

function FolderEntry({
  entry,
  depth,
  isExpanded,
  isLoading,
  tree,
  onFileClick,
  children,
}: FolderEntryProps) {
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <button
        type="button"
        onClick={() => tree.toggleFolder(entry.path)}
        className="flex items-center gap-1 w-full py-1 text-xs text-surface-200 hover:bg-surface-800 cursor-pointer select-none truncate"
        style={{ paddingLeft: getTreeIndentPx(depth) }}
      >
        {isLoading ? (
          <Loader2 size={12} className="flex-shrink-0 text-surface-400 animate-spin" />
        ) : (
          <ChevronIcon size={12} className="flex-shrink-0 text-surface-400" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>

      {isExpanded && children && (
        <FileTreeNode
          entries={children}
          depth={depth + 1}
          tree={tree}
          onFileClick={onFileClick}
        />
      )}
    </>
  );
}
