/**
 * useTabDnd — hook encapsulating DnD logic for tab reordering and cross-group moves.
 *
 * Provides sensors, active drag state, edge zone detection via onDragMove,
 * and event handlers for the single DndContext wrapping SplitLayoutContainer.
 */

import { useState, useCallback, useRef } from "react";
import {
  useSensors,
  useSensor,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { logger } from "@/lib/logger-client";
import {
  paneLayoutService,
  usePaneLayoutStore,
  canSplitHorizontal,
  canSplitVertical,
} from "@/stores/pane-layout";
import type { ContentPaneView } from "@/components/content-pane/types";
import type { EdgeZone } from "./drop-zone-overlay";

/** Data attached to each draggable tab item. */
export interface TabDragData {
  type: "tab";
  tabId: string;
  groupId: string;
  view: ContentPaneView;
}

/** Active drag state exposed to overlay and drop zone components. */
export interface ActiveDragState {
  tabId: string;
  sourceGroupId: string;
  view: ContentPaneView;
}

/** Which edge zone is currently hovered, if any. */
export interface ActiveEdgeZone {
  groupId: string;
  zone: NonNullable<EdgeZone>;
}

/** Fraction of panel dimension used for edge detection zones. */
const EDGE_FRACTION = 0.3;
/** Minimum pixel threshold so small panels stay usable. */
const MIN_EDGE_PX = 30;

/**
 * Detect which edge zone (if any) the cursor is over.
 *
 * Checks all pane groups by querying the DOM for their bounding rects.
 * Returns null if the cursor is inside the tab bar or not on any edge.
 */
function detectEdgeZoneAtPoint(
  clientX: number,
  clientY: number,
  sourceGroupId: string,
): ActiveEdgeZone | null {
  const { root, groups } = usePaneLayoutStore.getState();

  for (const groupId of Object.keys(groups)) {
    const el = document.querySelector(`[data-testid="pane-group-${groupId}"]`);
    if (!el) continue;

    const rect = el.getBoundingClientRect();
    // Skip groups the cursor isn't over
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      continue;

    // Need 2+ tabs for same-group split (one must remain behind)
    if (groupId === sourceGroupId && (groups[groupId]?.tabs.length ?? 0) < 2)
      return null;

    // Skip if cursor is in the tab bar area
    const tabBarEl = el.querySelector(`[data-testid="tab-bar-${groupId}"]`);
    const tabBarBottom = tabBarEl
      ? tabBarEl.getBoundingClientRect().bottom
      : rect.top + 32;
    if (clientY < tabBarBottom) return null;

    const canH = canSplitHorizontal(root, groupId);
    const canV = canSplitVertical(root, groupId);

    const relX = clientX - rect.left;
    const contentTop = tabBarBottom - rect.top;
    const contentRelY = clientY - rect.top - contentTop;
    const contentHeight = rect.height - contentTop;

    const edgeY = Math.max(contentHeight * EDGE_FRACTION, MIN_EDGE_PX);
    const edgeX = Math.max(rect.width * EDGE_FRACTION, MIN_EDGE_PX);

    if (contentRelY < edgeY && canV)
      return { groupId, zone: "top" };
    if (contentRelY > contentHeight - edgeY && canV)
      return { groupId, zone: "bottom" };
    if (relX < edgeX && canH)
      return { groupId, zone: "left" };
    if (relX > rect.width - edgeX && canH)
      return { groupId, zone: "right" };

    // Inside the group content area but not on an edge
    return null;
  }

  return null;
}

export function useTabDnd() {
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
  const [activeEdgeZone, setActiveEdgeZone] = useState<ActiveEdgeZone | null>(
    null,
  );
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const edgeDropHandledRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as TabDragData | undefined;
    if (!data || data.type !== "tab") return;

    edgeDropHandledRef.current = false;
    const drag: ActiveDragState = {
      tabId: data.tabId,
      sourceGroupId: data.groupId,
      view: data.view,
    };
    activeDragRef.current = drag;
    setActiveDrag(drag);
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const drag = activeDragRef.current;
    if (!drag) return;

    const activatorEvent = event.activatorEvent as PointerEvent;
    const clientX = activatorEvent.clientX + event.delta.x;
    const clientY = activatorEvent.clientY + event.delta.y;

    const result = detectEdgeZoneAtPoint(clientX, clientY, drag.sourceGroupId);
    setActiveEdgeZone((prev) => {
      if (prev?.groupId === result?.groupId && prev?.zone === result?.zone)
        return prev;
      return result;
    });
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Tracked by SortableContext; no custom logic needed
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const drag = activeDragRef.current;
    activeDragRef.current = null;
    setActiveDrag(null);
    setActiveEdgeZone(null);

    // If edge drop already handled this drag, skip
    if (edgeDropHandledRef.current) {
      edgeDropHandledRef.current = false;
      return;
    }

    if (!drag) return;

    const { active, over } = event;
    const activeData = active.data.current as TabDragData | undefined;
    if (!activeData || activeData.type !== "tab") return;

    // Compute final cursor position
    const activatorEvent = event.activatorEvent as PointerEvent;
    const finalX = activatorEvent.clientX + event.delta.x;
    const finalY = activatorEvent.clientY + event.delta.y;

    // Check if cursor is in an edge zone — if so, split instead of reorder
    const edgeResult = detectEdgeZoneAtPoint(
      finalX,
      finalY,
      drag.sourceGroupId,
    );
    if (edgeResult) {
      const { groupId: targetGroupId, zone } = edgeResult;
      const direction =
        zone === "left" || zone === "right" ? "horizontal" : "vertical";

      logger.debug(
        `[useTabDnd] Edge drop: tab ${drag.tabId} on ${zone} of group ${targetGroupId}`,
      );

      await paneLayoutService.splitAndMoveTab(
        targetGroupId,
        direction,
        drag.sourceGroupId,
        drag.tabId,
      );
      return;
    }

    // No edge zone — check if cursor is within a tab bar for reordering
    if (!over) return;
    const overData = over.data.current as TabDragData | undefined;
    if (!overData || overData.type !== "tab") return;

    const fromGroupId = activeData.groupId;
    const toGroupId = overData.groupId;

    // Only allow reorder/move if cursor is within the target tab bar
    const tabBarEl = document.querySelector(
      `[data-testid="tab-bar-${toGroupId}"]`,
    );
    if (tabBarEl) {
      const tabBarRect = tabBarEl.getBoundingClientRect();
      if (finalY > tabBarRect.bottom) {
        // Cursor is below the tab bar — don't reorder
        return;
      }
    }

    if (fromGroupId === toGroupId) {
      await handleSameGroupReorder(
        fromGroupId,
        activeData.tabId,
        overData.tabId,
      );
    } else {
      await handleCrossGroupMove(
        fromGroupId,
        activeData.tabId,
        toGroupId,
        overData.tabId,
      );
    }
  }, []);

  /**
   * Handle an edge-zone drop (drag-to-split).
   * Called by DropZoneOverlay when a tab is dropped on a pane edge.
   * Kept for backwards compatibility but edge detection now happens
   * primarily in handleDragEnd.
   */
  const handleEdgeDrop = useCallback(
    async (targetGroupId: string, zone: EdgeZone) => {
      const drag = activeDragRef.current;
      if (!drag || !zone) return;

      edgeDropHandledRef.current = true;
      const { tabId, sourceGroupId } = drag;
      const direction =
        zone === "left" || zone === "right" ? "horizontal" : "vertical";

      logger.debug(
        `[useTabDnd] Edge drop: tab ${tabId} on ${zone} of group ${targetGroupId}`,
      );

      await paneLayoutService.splitAndMoveTab(
        targetGroupId,
        direction,
        sourceGroupId,
        tabId,
      );

      setActiveDrag(null);
      setActiveEdgeZone(null);
      activeDragRef.current = null;
    },
    [],
  );

  return {
    sensors,
    activeDrag,
    activeEdgeZone,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleEdgeDrop,
  };
}

/** Reorder tabs within the same group. */
async function handleSameGroupReorder(
  groupId: string,
  activeTabId: string,
  overTabId: string,
): Promise<void> {
  if (activeTabId === overTabId) return;

  const group = usePaneLayoutStore.getState().groups[groupId];
  if (!group) return;

  const tabIds = group.tabs.map((t) => t.id);
  const oldIndex = tabIds.indexOf(activeTabId);
  const newIndex = tabIds.indexOf(overTabId);
  if (oldIndex === -1 || newIndex === -1) return;

  const reordered = arrayMove(tabIds, oldIndex, newIndex);
  await paneLayoutService.reorderTabs(groupId, reordered);
}

/** Move a tab from one group to another at the target tab's position. */
async function handleCrossGroupMove(
  fromGroupId: string,
  tabId: string,
  toGroupId: string,
  overTabId: string,
): Promise<void> {
  const toGroup = usePaneLayoutStore.getState().groups[toGroupId];
  if (!toGroup) return;

  const insertIndex = toGroup.tabs.findIndex((t) => t.id === overTabId);
  const targetIndex = insertIndex === -1 ? toGroup.tabs.length : insertIndex;

  await paneLayoutService.moveTab(fromGroupId, tabId, toGroupId, targetIndex);

  // Clean up empty source group
  const fromGroup = usePaneLayoutStore.getState().groups[fromGroupId];
  if (fromGroup && fromGroup.tabs.length === 0) {
    await paneLayoutService._removeEmptyGroup(fromGroupId);
  }
}
