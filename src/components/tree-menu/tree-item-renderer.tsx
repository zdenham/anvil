import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import { RepoItem } from "./repo-item";
import { WorktreeItem } from "./worktree-item";
import { FolderItem } from "./folder-item";
import { ThreadItem } from "./thread-item";
import { PlanItem } from "./plan-item";
import { TerminalItem } from "./terminal-item";
import { PullRequestItem } from "./pull-request-item";
import { ChangesItem } from "./changes-item";
import { FilesItem } from "./files-item";

export interface TreeItemRendererProps {
  item: TreeItemNode;
  index: number;
  allItems: TreeItemNode[];
  childCount: number;
  selectedItemId: string | null;
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
  onChangesClick: (item: TreeItemNode) => void;
  onFilesClick: (item: TreeItemNode) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onNewClaudeSession?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewManagedThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  onRefresh?: () => void;
  isCreatingWorktree?: boolean;
  onPinToggle?: (worktreeId: string) => void;
  isPinned?: boolean;
  onHideRepo?: (repoId: string) => void;
  onRemoveRepo?: (repoId: string, repoName: string) => void;
  onHideWorktree?: (worktreeId: string) => void;
}

/**
 * Dispatches a TreeItemNode to the correct component based on its type.
 * Used by TreeMenu for flat-list rendering.
 */
export function TreeItemRenderer({
  item, index, allItems, childCount, selectedItemId, onItemSelect,
  onChangesClick, onFilesClick,
  onNewThread, onNewTerminal, onNewClaudeSession, onNewManagedThread, onCreatePr, onNewWorktree,
  onArchiveWorktree, onRefresh, isCreatingWorktree,
  onPinToggle, isPinned,
  onHideRepo, onRemoveRepo, onHideWorktree,
}: TreeItemRendererProps) {
  const isSelected = selectedItemId === item.id;

  switch (item.type) {
    case "repo":
      return <RepoItem item={item} onHideRepo={onHideRepo} onRemoveRepo={onRemoveRepo} />;
    case "worktree":
      return (
        <WorktreeItem
          item={item} childCount={childCount} isSelected={isSelected}
          itemIndex={index} allItems={allItems} onItemSelect={onItemSelect}
          onNewThread={onNewThread} onNewTerminal={onNewTerminal}
          onNewClaudeSession={onNewClaudeSession}
          onNewManagedThread={onNewManagedThread}
          onCreatePr={onCreatePr} onNewWorktree={onNewWorktree}
          onArchiveWorktree={onArchiveWorktree}
          onRefresh={onRefresh} isCreatingWorktree={isCreatingWorktree}
          onPinToggle={onPinToggle} isPinned={isPinned}
          onHideWorktree={onHideWorktree}
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
    case "terminal": {
      const siblingTerminals = allItems.filter(
        i => i.type === "terminal" && i.worktreeId === item.worktreeId
      );
      return (
        <TerminalItem
          item={item} isSelected={isSelected} onSelect={onItemSelect}
          itemIndex={index}
          isLastInWorktree={siblingTerminals.length <= 1}
        />
      );
    }
    case "pull-request":
      return (
        <PullRequestItem
          item={item} isSelected={isSelected} onSelect={onItemSelect}
          itemIndex={index}
        />
      );
    case "changes":
      return (
        <ChangesItem
          item={item} isSelected={isSelected}
          onNavigate={() => onChangesClick(item)}
        />
      );
    case "files":
      return (
        <FilesItem
          item={item} isSelected={isSelected}
          onNavigate={() => onFilesClick(item)}
        />
      );
    default:
      return null;
  }
}
