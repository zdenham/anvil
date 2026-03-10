import { useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  GitBranch,
  MessageSquare,
  FileText,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMoveToStore } from "./use-move-to";
import { useTreeData } from "@/hooks/use-tree-data";
import { validateDrop, buildTreeMaps } from "@/lib/dnd-validation";
import { updateVisualSettings } from "@/lib/visual-settings";
import { generateKeyBetween } from "@/lib/fractional-indexing";
import { logger } from "@/lib/logger-client";
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";
import { LUCIDE_ICON_MAP } from "./icon-picker";

/** Types that can receive children (valid "Move to..." targets). */
const CONTAINER_TYPES: Set<TreeItemType> = new Set([
  "worktree", "folder", "thread", "plan",
]);

type VisualEntityType = "thread" | "plan" | "pull-request" | "terminal" | "folder" | "worktree";

/** Map TreeItemNode type to the entity type used by updateVisualSettings. */
function mapTreeTypeToEntityType(type: TreeItemType): VisualEntityType {
  switch (type) {
    case "thread": return "thread";
    case "plan": return "plan";
    case "pull-request": return "pull-request";
    case "terminal": return "terminal";
    case "folder": return "folder";
    case "worktree": return "worktree";
    default:
      throw new Error(`Cannot move synthetic item type: ${type}`);
  }
}

/** Get the last sortKey among an item's children, or null if no keyed children. */
function getLastChildSortKey(
  parentId: string,
  allItems: TreeItemNode[],
): string | null {
  const keyed = allItems
    .filter((i) => i.parentId === parentId && i.sortKey)
    .map((c) => c.sortKey!)
    .sort();
  return keyed.length > 0 ? keyed[keyed.length - 1] : null;
}

/** Icon for a target row in the dialog. */
function targetIcon(type: TreeItemType, icon?: string): LucideIcon {
  switch (type) {
    case "folder":
      return LUCIDE_ICON_MAP[icon ?? "folder"] ?? Folder;
    case "worktree":
      return GitBranch;
    case "thread":
      return MessageSquare;
    case "plan":
      return FileText;
    default:
      return Folder;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public component — mounts once in tree-menu.tsx
// ═══════════════════════════════════════════════════════════════════════════

export function MoveToDialog() {
  const movingItem = useMoveToStore((s) => s.movingItem);
  const close = useMoveToStore((s) => s.closeMoveDialog);

  if (!movingItem) return null;
  return createPortal(
    <MoveToDialogInner item={movingItem} onClose={close} />,
    document.body,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Inner dialog
// ═══════════════════════════════════════════════════════════════════════════

interface ValidTarget {
  item: TreeItemNode;
  valid: boolean;
  reason?: string;
}

function MoveToDialogInner({
  item,
  onClose,
}: {
  item: TreeItemNode;
  onClose: () => void;
}) {
  const allItems = useTreeData();

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Build valid targets
  const targets = useMemo(
    () => getValidTargets(item, allItems),
    [item, allItems],
  );

  const handleSelect = useCallback(
    async (target: TreeItemNode) => {
      try {
        const newParentId = target.id;
        const lastKey = getLastChildSortKey(newParentId, allItems);
        const newSortKey = generateKeyBetween(lastKey, null);
        const entityType = mapTreeTypeToEntityType(item.type);

        await updateVisualSettings(entityType, item.id, {
          parentId: newParentId,
          sortKey: newSortKey,
        });
      } catch (err) {
        logger.error("[MoveToDialog] Failed to move item:", err);
      }
      onClose();
    },
    [item, allItems, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface-800 border border-surface-700 rounded-lg shadow-xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
          <span className="text-xs text-surface-200 truncate">
            Move &ldquo;{item.title}&rdquo; to:
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-200 p-0.5 rounded hover:bg-surface-700"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — scrollable target list */}
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {targets.length === 0 && (
            <div className="px-2 py-3 text-xs text-surface-500 text-center">
              No valid targets found
            </div>
          )}
          {targets.map(({ item: target, valid, reason }) => (
            <TargetRow
              key={target.id}
              target={target}
              valid={valid}
              reason={reason}
              onClick={() => handleSelect(target)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Target row
// ═══════════════════════════════════════════════════════════════════════════

function TargetRow({
  target,
  valid,
  reason,
  onClick,
}: {
  target: TreeItemNode;
  valid: boolean;
  reason?: string;
  onClick: () => void;
}) {
  const Icon = targetIcon(target.type, target.icon);

  return (
    <button
      type="button"
      disabled={!valid}
      onClick={onClick}
      title={!valid ? reason : undefined}
      style={{ paddingLeft: `${8 + target.depth * 12}px` }}
      className={cn(
        "w-full px-2 py-1.5 text-left text-xs rounded flex items-center gap-2",
        valid
          ? "text-surface-200 hover:bg-surface-700 cursor-pointer"
          : "text-surface-500 cursor-not-allowed opacity-50",
      )}
    >
      <Icon size={11} className="flex-shrink-0" />
      <span className="truncate">{target.title}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Target computation
// ═══════════════════════════════════════════════════════════════════════════

function getValidTargets(
  movingItem: TreeItemNode,
  allItems: TreeItemNode[],
): ValidTarget[] {
  const { nodeMap, parentMap } = buildTreeMaps(allItems);

  return allItems
    .filter((t) => CONTAINER_TYPES.has(t.type) && t.id !== movingItem.id)
    .map((target) => {
      const result = validateDrop(movingItem, target, "inside", nodeMap, parentMap);
      return { item: target, valid: result.valid, reason: result.reason };
    });
}
