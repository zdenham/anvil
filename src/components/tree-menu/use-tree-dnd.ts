/**
 * useTreeDnd -- hook encapsulating DnD state, sensors, and event handlers
 * for the sidebar tree. Follows the use-tab-dnd.ts pattern.
 *
 * Drop zone detection is handled manually via document.elementsFromPoint()
 * because dnd-kit's built-in collision algorithms don't support the
 * 25%/50%/25% positional hit regions.
 */
import { useState, useCallback, useRef } from "react";
import {
  useSensors,
  useSensor,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragCancelEvent,
} from "@dnd-kit/core";
import { logger } from "@/lib/logger-client";
import {
  validateDrop,
  getDropPosition,
  buildTreeMaps,
  type DropPosition,
  type DropValidationResult,
} from "@/lib/dnd-validation";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { executeDrop } from "./tree-dnd-drop-executor";

/** Data attached to each draggable tree item via useSortable({ data }). */
export interface TreeDragData {
  type: "tree-item";
  item: TreeItemNode;
}

export interface ActiveDragState {
  item: TreeItemNode;
}

export interface DropTargetState {
  item: TreeItemNode;
  position: DropPosition;
  validation: DropValidationResult;
}

const AUTO_EXPAND_DELAY_MS = 500;

export function useTreeDnd(items: TreeItemNode[]) {
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const dropTargetRef = useRef<DropTargetState | null>(null);

  // Auto-expand timer for collapsed containers
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandTargetRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandTargetRef.current = null;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as TreeDragData | undefined;
    if (!data || data.type !== "tree-item") return;
    const state: ActiveDragState = { item: data.item };
    activeDragRef.current = state;
    setActiveDrag(state);
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const drag = activeDragRef.current;
    if (!drag) return;

    const activatorEvent = event.activatorEvent as PointerEvent;
    const cursorX = activatorEvent.clientX + event.delta.x;
    const cursorY = activatorEvent.clientY + event.delta.y;

    const targetEl = findTreeItemAtPoint(cursorX, cursorY);
    if (!targetEl) {
      clearDropState();
      return;
    }

    const targetId = targetEl.getAttribute("data-tree-item-id")!;
    const { nodeMap, parentMap } = buildTreeMaps(items);
    const targetItem = nodeMap.get(targetId);
    if (!targetItem) {
      clearDropState();
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const position = getDropPosition(cursorY, rect, targetItem.type);
    const validation = validateDrop(drag.item, targetItem, position, nodeMap, parentMap);

    const newDropTarget = { item: targetItem, position, validation };
    setDropTarget(newDropTarget);
    dropTargetRef.current = newDropTarget;

    handleAutoExpand(targetId, targetItem, position, validation);
  }, [items, clearAutoExpandTimer]);

  const handleDragEnd = useCallback(async (_event: DragEndEvent) => {
    const drag = activeDragRef.current;
    const currentDropTarget = dropTargetRef.current;
    resetDragState();

    if (!drag || !currentDropTarget || !currentDropTarget.validation.valid) return;

    try {
      await executeDrop(drag.item, currentDropTarget.item, currentDropTarget.position, items);
    } catch (err) {
      logger.error("[useTreeDnd] Drop failed:", err);
    }
  }, [items, clearAutoExpandTimer]);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    resetDragState();
  }, [clearAutoExpandTimer]);

  // -- Internal helpers --

  function clearDropState(): void {
    setDropTarget(null);
    dropTargetRef.current = null;
    clearAutoExpandTimer();
  }

  function resetDragState(): void {
    activeDragRef.current = null;
    setActiveDrag(null);
    setDropTarget(null);
    dropTargetRef.current = null;
    clearAutoExpandTimer();
  }

  function handleAutoExpand(
    targetId: string,
    targetItem: TreeItemNode,
    position: DropPosition,
    validation: DropValidationResult,
  ): void {
    if (
      position === "inside" &&
      targetItem.isFolder &&
      !targetItem.isExpanded &&
      validation.valid
    ) {
      if (autoExpandTargetRef.current !== targetId) {
        clearAutoExpandTimer();
        autoExpandTargetRef.current = targetId;
        autoExpandTimerRef.current = setTimeout(async () => {
          const key = getExpandKey(targetItem);
          await treeMenuService.expandSection(key);
          autoExpandTargetRef.current = null;
        }, AUTO_EXPAND_DELAY_MS);
      }
    } else if (autoExpandTargetRef.current !== targetId) {
      clearAutoExpandTimer();
    }
  }

  return {
    sensors,
    activeDrag,
    dropTarget,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}

/** Find the tree item element under the cursor via data attribute. */
function findTreeItemAtPoint(x: number, y: number): HTMLElement | undefined {
  const elements = document.elementsFromPoint(x, y);
  return elements.find(
    (el) => el.hasAttribute("data-tree-item-id"),
  ) as HTMLElement | undefined;
}

/** Get the expansion key for a node (matches convention in use-tree-data.ts). */
function getExpandKey(item: TreeItemNode): string {
  switch (item.type) {
    case "worktree": return item.id;
    case "folder": return `folder:${item.id}`;
    case "plan": return `plan:${item.id}`;
    case "thread": return `thread:${item.id}`;
    default: return item.id;
  }
}
