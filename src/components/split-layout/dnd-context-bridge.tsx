/**
 * DndContextBridge — React context for passing DnD state through the split tree.
 *
 * Avoids prop drilling activeDrag and onEdgeDrop through the recursive
 * SplitNodeRenderer. Provided by SplitLayoutContainer, consumed by PaneGroup.
 */

import { createContext, useContext } from "react";
import type { ActiveDragState, ActiveEdgeZone } from "./use-tab-dnd";
import type { EdgeZone } from "./drop-zone-overlay";

interface DndBridgeValue {
  activeDrag: ActiveDragState | null;
  activeEdgeZone: ActiveEdgeZone | null;
  onEdgeDrop: (targetGroupId: string, zone: EdgeZone) => void;
}

const DndBridgeContext = createContext<DndBridgeValue>({
  activeDrag: null,
  activeEdgeZone: null,
  onEdgeDrop: () => {},
});

export const DndBridgeProvider = DndBridgeContext.Provider;

export function useDndBridge(): DndBridgeValue {
  return useContext(DndBridgeContext);
}
