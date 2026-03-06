/**
 * Component-level types for split layout rendering.
 */

import type { SplitNode } from "@/stores/pane-layout/types";

/** Props for the recursive split node renderer. */
export interface SplitNodeRendererProps {
  node: SplitNode;
  /** Index path from root to this node (used for resize operations). */
  path: number[];
}

/** Props for the resize handle between split children. */
export interface SplitResizeHandleProps {
  /** The split direction of the parent. */
  direction: "horizontal" | "vertical";
  /** Path from root to the parent split node. */
  path: number[];
  /** Index of the child to the right/below this handle. */
  index: number;
  /** Current size percentages of all children in the parent split. */
  sizes: number[];
}

