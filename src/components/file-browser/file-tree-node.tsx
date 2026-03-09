import { ChevronRight, ChevronDown, Loader2, Copy, FileText, Folder, ExternalLink, FilePlus, FolderPlus } from "lucide-react";
import { Command } from "@tauri-apps/plugin-shell";
import type { DirEntry } from "@/lib/filesystem-client";
import { useChangesViewStore } from "@/stores/changes-view-store";
import { getFileIconUrl } from "./file-icons";
import type { FileTreeState } from "./use-file-tree";
import { getTreeIndentPx } from "@/lib/tree-indent";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuDivider,
  useContextMenu,
} from "@/components/ui/context-menu";
import { InlineCreationInput } from "./inline-creation-input";

export type CreatingEntry = {
  parentPath: string;
  type: "file" | "directory";
} | null;

export interface CreationProps {
  creatingEntry: CreatingEntry;
  onStartCreate: (parentPath: string, type: "file" | "directory") => void;
  onConfirmCreate: (name: string) => void;
  onCancelCreate: () => void;
}

interface FileTreeNodeProps extends CreationProps {
  entries: DirEntry[];
  depth: number;
  tree: FileTreeState;
  rootPath: string;
  onFileClick: (entry: DirEntry) => void;
}

export function FileTreeNode({
  entries, depth, tree, rootPath, onFileClick,
  creatingEntry, onStartCreate, onConfirmCreate, onCancelCreate,
}: FileTreeNodeProps) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeEntry
          key={entry.path}
          entry={entry}
          depth={depth}
          tree={tree}
          rootPath={rootPath}
          onFileClick={onFileClick}
          creatingEntry={creatingEntry}
          onStartCreate={onStartCreate}
          onConfirmCreate={onConfirmCreate}
          onCancelCreate={onCancelCreate}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared context menu for both files and folders
// ---------------------------------------------------------------------------

function EntryContextMenu({
  entry, rootPath, menu, onStartCreate,
}: {
  entry: DirEntry;
  rootPath: string;
  menu: ReturnType<typeof useContextMenu>;
  onStartCreate: (parentPath: string, type: "file" | "directory") => void;
}) {
  if (!menu.show) return null;

  const relativePath = entry.path.startsWith(rootPath)
    ? entry.path.slice(rootPath.length).replace(/^\//, "")
    : entry.name;

  const targetPath = entry.isDirectory
    ? entry.path
    : entry.path.substring(0, entry.path.lastIndexOf("/"));

  return (
    <ContextMenu position={menu.position} onClose={menu.close}>
      <ContextMenuItem icon={Copy} label="Copy relative path" onClick={() => { navigator.clipboard.writeText(relativePath); menu.close(); }} />
      <ContextMenuItem icon={Copy} label="Copy absolute path" onClick={() => { navigator.clipboard.writeText(entry.path); menu.close(); }} />
      <ContextMenuItem icon={entry.isDirectory ? Folder : FileText} label="Copy name" onClick={() => { navigator.clipboard.writeText(entry.name); menu.close(); }} />
      <ContextMenuDivider />
      <ContextMenuItem icon={FilePlus} label="New File…" onClick={() => { menu.close(); onStartCreate(targetPath, "file"); }} />
      <ContextMenuItem icon={FolderPlus} label="New Folder…" onClick={() => { menu.close(); onStartCreate(targetPath, "directory"); }} />
      <ContextMenuDivider />
      <ContextMenuItem
        icon={ExternalLink}
        label="Open in Cursor"
        onClick={async () => {
          menu.close();
          const cmd = Command.create("open", ["-a", "Cursor", entry.path]);
          await cmd.execute();
        }}
      />
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// FileTreeEntry (dispatch to file button or FolderEntry)
// ---------------------------------------------------------------------------

interface FileTreeEntryProps extends CreationProps {
  entry: DirEntry;
  depth: number;
  tree: FileTreeState;
  rootPath: string;
  onFileClick: (entry: DirEntry) => void;
}

function FileTreeEntry({
  entry, depth, tree, rootPath, onFileClick,
  creatingEntry, onStartCreate, onConfirmCreate, onCancelCreate,
}: FileTreeEntryProps) {
  const isExpanded = tree.expandedPaths.has(entry.path);
  const isLoading = tree.loadingPaths.has(entry.path);
  const children = tree.childrenCache.get(entry.path);
  const menu = useContextMenu();

  if (entry.isDirectory) {
    return (
      <FolderEntry
        entry={entry} depth={depth} isExpanded={isExpanded} isLoading={isLoading}
        tree={tree} rootPath={rootPath} onFileClick={onFileClick} children={children}
        creatingEntry={creatingEntry} onStartCreate={onStartCreate}
        onConfirmCreate={onConfirmCreate} onCancelCreate={onCancelCreate}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onFileClick(entry)}
        onContextMenu={menu.open}
        className="flex items-center gap-1 w-full py-1 text-xs text-surface-200 hover:bg-surface-800 cursor-pointer select-none truncate"
        style={{ paddingLeft: getTreeIndentPx(depth) }}
      >
        <img src={getFileIconUrl(entry.name)} alt="" className="w-3 h-3 flex-shrink-0" />
        <span className="truncate flex-1 text-left">{entry.name}</span>
        <DiffStats entryPath={entry.path} rootPath={rootPath} />
      </button>
      <EntryContextMenu entry={entry} rootPath={rootPath} menu={menu} onStartCreate={onStartCreate} />
    </>
  );
}

// ---------------------------------------------------------------------------
// DiffStats — +/- indicators shown in diff mode
// ---------------------------------------------------------------------------

function DiffStats({ entryPath, rootPath }: { entryPath: string; rootPath: string }) {
  const fileStats = useChangesViewStore((s) => s.fileStats);
  if (fileStats.size === 0) return null;

  const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  const relativePath = entryPath.startsWith(prefix) ? entryPath.slice(prefix.length) : entryPath;
  const stats = fileStats.get(relativePath);
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null;

  return (
    <span className="text-[10px] flex-shrink-0 ml-auto mr-1">
      {stats.additions > 0 && <span className="text-green-400">+{stats.additions}</span>}
      {stats.additions > 0 && stats.deletions > 0 && " "}
      {stats.deletions > 0 && <span className="text-red-400">-{stats.deletions}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FolderEntry
// ---------------------------------------------------------------------------

interface FolderEntryProps extends CreationProps {
  entry: DirEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  tree: FileTreeState;
  rootPath: string;
  onFileClick: (entry: DirEntry) => void;
  children: DirEntry[] | undefined;
}

function FolderEntry({
  entry, depth, isExpanded, isLoading, tree, rootPath, onFileClick, children,
  creatingEntry, onStartCreate, onConfirmCreate, onCancelCreate,
}: FolderEntryProps) {
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;
  const menu = useContextMenu();

  return (
    <>
      <button
        type="button"
        onClick={() => tree.toggleFolder(entry.path)}
        onContextMenu={menu.open}
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
      <EntryContextMenu entry={entry} rootPath={rootPath} menu={menu} onStartCreate={onStartCreate} />

      {isExpanded && (
        <>
          {creatingEntry?.parentPath === entry.path && (
            <InlineCreationInput
              type={creatingEntry.type}
              depth={depth + 1}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          )}
          {children && (
            <FileTreeNode
              entries={children} depth={depth + 1} tree={tree}
              rootPath={rootPath} onFileClick={onFileClick}
              creatingEntry={creatingEntry} onStartCreate={onStartCreate}
              onConfirmCreate={onConfirmCreate} onCancelCreate={onCancelCreate}
            />
          )}
        </>
      )}
    </>
  );
}
