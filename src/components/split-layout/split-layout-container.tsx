/**
 * SplitLayoutContainer
 *
 * Root component that replaces ContentPaneContainer.
 * Reads the pane layout store, wraps the tree in a DndContext
 * for tab drag-and-drop, and renders the recursive split tree.
 */

import { useMemo } from "react";
import { DndContext, closestCenter, DragOverlay } from "@dnd-kit/core";
import { usePaneLayoutStore } from "@/stores/pane-layout";
import { SplitNodeRenderer } from "./split-node-renderer";
import { DndBridgeProvider } from "./dnd-context-bridge";
import { TabDragPreview } from "./tab-drag-preview";
import { useTabDnd } from "./use-tab-dnd";

export function SplitLayoutContainer() {
  const root = usePaneLayoutStore((s) => s.root);
  const hydrated = usePaneLayoutStore((s) => s._hydrated);

  const {
    sensors,
    activeDrag,
    activeEdgeZone,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleEdgeDrop,
  } = useTabDnd();

  const bridgeValue = useMemo(
    () => ({ activeDrag, activeEdgeZone, onEdgeDrop: handleEdgeDrop }),
    [activeDrag, activeEdgeZone, handleEdgeDrop],
  );

  if (!hydrated) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <DndBridgeProvider value={bridgeValue}>
        <div
          data-testid="split-layout-container"
          className="flex-1 min-w-0 bg-surface-900"
        >
          <SplitNodeRenderer node={root} path={[]} />
        </div>
      </DndBridgeProvider>
      <DragOverlay>
        {activeDrag ? <TabDragPreview activeDrag={activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
