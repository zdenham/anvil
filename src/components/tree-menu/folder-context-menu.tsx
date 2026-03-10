import { ChevronRight, Pencil, Archive, FolderPlus } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuItemDanger,
  ContextMenuDivider,
} from "@/components/ui/context-menu";

// ── Archive confirmation sub-menu ────────────────────────────────────────

interface FolderArchiveConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/** Two-click confirmation for archiving a folder with children. */
export function FolderArchiveConfirm({ onConfirm, onCancel }: FolderArchiveConfirmProps) {
  return (
    <>
      <div className="px-2.5 py-1 text-[11px] text-surface-400">
        Archive this folder and all contents?
      </div>
      <ContextMenuItemDanger icon={Archive} label="Confirm archive" onClick={onConfirm} />
      <ContextMenuItem icon={ChevronRight} label="Cancel" onClick={onCancel} />
    </>
  );
}

// ── Standard folder context menu items ───────────────────────────────────

interface FolderContextMenuItemsProps {
  onEdit: () => void;
  onArchive: () => void;
  onNewFolder: () => void;
  hasChildren: boolean;
  canArchive: boolean;
}

/** Context menu items for a folder: New folder, Edit, Archive. */
export function FolderContextMenuItems({
  onEdit, onArchive, onNewFolder,
  hasChildren, canArchive,
}: FolderContextMenuItemsProps) {
  return (
    <>
      <ContextMenuItem icon={FolderPlus} label="New folder" onClick={onNewFolder} />
      <ContextMenuDivider />
      <ContextMenuItem icon={Pencil} label="Edit" onClick={onEdit} />
      {canArchive && (
        <>
          <ContextMenuDivider />
          <ContextMenuItemDanger
            icon={Archive}
            label={hasChildren ? "Archive folder and contents" : "Archive folder"}
            onClick={onArchive}
          />
        </>
      )}
    </>
  );
}
