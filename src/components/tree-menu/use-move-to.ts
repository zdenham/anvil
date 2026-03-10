import { create } from "zustand";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface MoveToState {
  /** Item currently being moved, or null if dialog is closed */
  movingItem: TreeItemNode | null;
  /** Open the "Move to..." dialog for an item */
  openMoveDialog: (item: TreeItemNode) => void;
  /** Close the dialog */
  closeMoveDialog: () => void;
}

export const useMoveToStore = create<MoveToState>((set) => ({
  movingItem: null,
  openMoveDialog: (item) => set({ movingItem: item }),
  closeMoveDialog: () => set({ movingItem: null }),
}));
