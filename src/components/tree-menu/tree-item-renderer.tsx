import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import { RepoItem } from "./repo-item";
import { WorktreeItem } from "./worktree-item";
import { FolderItem } from "./folder-item";
import { ThreadItem } from "./thread-item";
import { PlanItem } from "./plan-item";
import { TerminalItem } from "./terminal-item";
import { PullRequestItem } from "./pull-request-item";
import { ChangesItem } from "./changes-item";
import { UncommittedItem } from "./uncommitted-item";
import { CommitItem } from "./commit-item";
import { FilesItem } from "./files-item";

export interface TreeItemRendererProps {
  item: TreeItemNode;
  index: number;
  allItems: TreeItemNode[];
  childCount: number;
  selectedItemId: string | null;
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
  onChangesClick: (item: TreeItemNode) => void;
  onUncommittedClick: (item: TreeItemNode) => void;
  onCommitClick: (item: TreeItemNode) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
  onNewRepo?: () => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  onRefresh?: () => void;
  isCreatingWorktree?: boolean;
  onPinToggle?: (worktreeId: string) => void;
  isPinned?: boolean;
  onOpenFiles?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  isFileBrowserOpen?: boolean;
}

/**
 * Dispatches a TreeItemNode to the correct component based on its type.
 * Used by TreeMenu for flat-list rendering.
 */
export function TreeItemRenderer({
  item, index, allItems, childCount, selectedItemId, onItemSelect,
  onChangesClick, onUncommittedClick, onCommitClick,
  onNewThread, onNewTerminal, onCreatePr, onNewWorktree, onNewRepo,
  onArchiveWorktree, onRefresh, isCreatingWorktree,
  onPinToggle, isPinned, onOpenFiles, isFileBrowserOpen,
}: TreeItemRendererProps) {
  const isSelected = selectedItemId === item.id;

  switch (item.type) {
    case "repo":
      return <RepoItem item={item} />;
    case "worktree":
      return (
        <WorktreeItem
          item={item} childCount={childCount} isSelected={isSelected}
          itemIndex={index} allItems={allItems} onItemSelect={onItemSelect}
          onNewThread={onNewThread} onNewTerminal={onNewTerminal}
          onCreatePr={onCreatePr} onNewWorktree={onNewWorktree}
          onNewRepo={onNewRepo} onArchiveWorktree={onArchiveWorktree}
          onRefresh={onRefresh} isCreatingWorktree={isCreatingWorktree}
          onPinToggle={onPinToggle} isPinned={isPinned}
          onOpenFiles={onOpenFiles} isFileBrowserOpen={isFileBrowserOpen}
        />
      );
    case "folder":
      return (
        <FolderItem
          item={item} childCount={childCount} isSelected={isSelected}
          itemIndex={index} allItems={allItems} onItemSelect={onItemSelect}
        />
      );
    case "thread":
      return (
        <ThreadItem
          item={item} isSelected={isSelected} onSelect={onItemSelect}
          itemIndex={index} allItems={allItems}
        />
      );
    case "plan":
      return (
        <PlanItem
          item={item} isSelected={isSelected} onSelect={onItemSelect}
          itemIndex={index} allItems={allItems}
        />
      );
    case "terminal":
      return (
        <TerminalItem
          item={item} isSelected={isSelected} onSelect={onItemSelect}
          itemIndex={index}
        />
      );
    case "pull-request":
      return (
        <PullRequestItem
          item={item} isSelected={isSelected} onSelect={onItemSelect}
          itemIndex={index}
        />
      );
    case "files":
      return item.repoId && item.worktreeId && onOpenFiles ? (
        <FilesItem
          repoId={item.repoId}
          worktreeId={item.worktreeId}
          worktreePath={item.worktreePath ?? ""}
          isActive={isFileBrowserOpen ?? false}
          onOpenFiles={onOpenFiles}
          depth={item.depth}
        />
      ) : null;
    case "changes":
      return (
        <ChangesItem
          item={item} isSelected={isSelected}
          onNavigate={() => onChangesClick(item)}
        />
      );
    case "uncommitted":
      return (
        <UncommittedItem
          item={item} isSelected={isSelected}
          onNavigate={() => onUncommittedClick(item)}
        />
      );
    case "commit":
      return (
        <CommitItem
          item={item} isSelected={isSelected}
          onNavigate={() => onCommitClick(item)}
        />
      );
    default:
      return null;
  }
}
