import { folderService } from "@/entities/folders/service";
import { treeMenuService } from "@/stores/tree-menu/service";

/**
 * Creates a new folder as a child of the given parent and enters rename mode.
 * Called from "New folder" context menu action on worktree and folder items.
 *
 * @param parentId - ID of the parent node (worktree ID or folder ID)
 * @param worktreeId - Worktree ID for boundary enforcement (optional for root-level folders)
 */
export async function createFolderAndRename(
  parentId: string,
  worktreeId?: string,
): Promise<void> {
  const folder = await folderService.create({
    name: "New Folder",
    icon: "folder",
    worktreeId,
    parentId,
  });

  // Expand the parent so the new folder is visible
  await treeMenuService.expandSection(parentId);

  // Enter rename mode on the newly created folder
  treeMenuService.startRename(folder.id);
}

/**
 * Creates a root-level folder (no worktreeId, no parentId) and enters rename mode.
 * Called from the tree container context menu.
 */
export async function createRootFolder(): Promise<void> {
  const folder = await folderService.create({
    name: "New Folder",
    icon: "folder",
  });

  treeMenuService.startRename(folder.id);
}
