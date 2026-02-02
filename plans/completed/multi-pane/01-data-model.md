# Data Model - Layout Tree Types & Schemas

## Overview

Define the core types and Zod schemas for the pane layout system. This establishes the tree-based data structure that represents how panes are arranged.

**Dependencies**: None
**Parallel with**: None (foundational)

---

## Implementation

### 1. Layout Types

**`src/components/pane-layout/types.ts`**

```typescript
/**
 * Pane Layout Types
 *
 * The layout is represented as a tree:
 * - Leaf nodes are individual panes (reference paneId in content-panes store)
 * - Branch nodes are splits (horizontal or vertical) with multiple children
 *
 * Example: Two panes side by side
 * {
 *   type: "split",
 *   direction: "horizontal",
 *   children: [
 *     { type: "pane", paneId: "abc123" },
 *     { type: "pane", paneId: "def456" }
 *   ],
 *   sizes: [50, 50]
 * }
 */

/**
 * A leaf node representing a single pane.
 * The paneId references a pane in the content-panes store.
 */
export interface PaneNode {
  type: "pane";
  paneId: string;
}

/**
 * A branch node representing a split container.
 * Children are arranged either horizontally (side by side) or vertically (stacked).
 * Sizes are percentages that must sum to 100.
 */
export interface SplitNode {
  type: "split";
  direction: "horizontal" | "vertical";
  children: PaneLayoutNode[];
  sizes: number[]; // Percentages, e.g., [33.3, 33.3, 33.4]
}

/**
 * Union type for any node in the layout tree.
 */
export type PaneLayoutNode = PaneNode | SplitNode;

/**
 * The root layout structure.
 * Always has a root node (even for single pane).
 */
export interface PaneLayout {
  root: PaneLayoutNode;
}

/**
 * Direction for splitting a pane.
 */
export type SplitDirection = "horizontal" | "vertical";

/**
 * Position for inserting a new pane relative to an existing one.
 */
export type InsertPosition = "before" | "after";

/**
 * Drop zone identifiers for drag-and-drop.
 * Used when dragging a tab to create a new split.
 */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";
```

### 2. Zod Schemas

**`src/stores/pane-layout/types.ts`**

```typescript
import { z } from "zod";

/**
 * Zod schemas for pane layout persistence.
 * All disk reads are validated against these schemas.
 */

// Forward-declare for recursive schema
const PaneLayoutNodeSchema: z.ZodType<PaneLayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [PaneNodeSchema, SplitNodeSchema])
);

export const PaneNodeSchema = z.object({
  type: z.literal("pane"),
  paneId: z.string(),
});

export const SplitNodeSchema = z.object({
  type: z.literal("split"),
  direction: z.enum(["horizontal", "vertical"]),
  children: z.array(PaneLayoutNodeSchema).min(2), // At least 2 children
  sizes: z.array(z.number().min(0).max(100)),
});

export const PaneLayoutSchema = z.object({
  root: PaneLayoutNodeSchema,
});

/**
 * Full persisted state schema.
 * Includes both the layout tree and active pane tracking.
 */
export const PaneLayoutPersistedStateSchema = z.object({
  layout: PaneLayoutSchema,
  activePaneId: z.string().nullable(),
});

// Type exports
export type PaneNode = z.infer<typeof PaneNodeSchema>;
export type SplitNode = z.infer<typeof SplitNodeSchema>;
export type PaneLayoutNode = PaneNode | SplitNode;
export type PaneLayout = z.infer<typeof PaneLayoutSchema>;
export type PaneLayoutPersistedState = z.infer<typeof PaneLayoutPersistedStateSchema>;
```

### 3. Layout Utility Types

**Add to `src/components/pane-layout/types.ts`**

```typescript
/**
 * Path to a node in the layout tree.
 * Used for targeted updates without full tree traversal.
 *
 * Example: [0, 1] means root.children[0].children[1]
 */
export type LayoutPath = number[];

/**
 * Result of finding a pane in the tree.
 */
export interface FindPaneResult {
  node: PaneNode;
  path: LayoutPath;
  parent: SplitNode | null;
  indexInParent: number;
}

/**
 * Result of finding a split node in the tree.
 */
export interface FindSplitResult {
  node: SplitNode;
  path: LayoutPath;
  parent: SplitNode | null;
  indexInParent: number;
}

/**
 * Options for splitting a pane.
 */
export interface SplitPaneOptions {
  paneId: string;              // Pane to split
  direction: SplitDirection;   // horizontal or vertical
  position: InsertPosition;    // before or after the existing pane
  newPaneId: string;           // ID for the new pane
  ratio?: number;              // Size ratio (0-1), default 0.5
}

/**
 * Options for moving a pane.
 */
export interface MovePaneOptions {
  sourcePaneId: string;
  targetPaneId: string;
  dropZone: DropZone;
}
```

### 4. Default Layout Factory

**`src/stores/pane-layout/defaults.ts`**

```typescript
import type { PaneLayout, PaneLayoutNode } from "./types";
import { DEFAULT_PANE_ID } from "@/stores/content-panes/types";

/**
 * Create a default single-pane layout.
 * Used for new users or when layout is corrupted.
 */
export function createDefaultLayout(): PaneLayout {
  return {
    root: {
      type: "pane",
      paneId: DEFAULT_PANE_ID,
    },
  };
}

/**
 * Create a layout with a single pane showing the given paneId.
 */
export function createSinglePaneLayout(paneId: string): PaneLayout {
  return {
    root: {
      type: "pane",
      paneId,
    },
  };
}

/**
 * Create a horizontal split layout with two panes.
 */
export function createHorizontalSplitLayout(
  leftPaneId: string,
  rightPaneId: string,
  leftSize: number = 50
): PaneLayout {
  return {
    root: {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "pane", paneId: leftPaneId },
        { type: "pane", paneId: rightPaneId },
      ],
      sizes: [leftSize, 100 - leftSize],
    },
  };
}

/**
 * Create a vertical split layout with two panes.
 */
export function createVerticalSplitLayout(
  topPaneId: string,
  bottomPaneId: string,
  topSize: number = 50
): PaneLayout {
  return {
    root: {
      type: "split",
      direction: "vertical",
      children: [
        { type: "pane", paneId: topPaneId },
        { type: "pane", paneId: bottomPaneId },
      ],
      sizes: [topSize, 100 - topSize],
    },
  };
}
```

### 5. Layout Tree Utilities

**`src/stores/pane-layout/tree-utils.ts`**

```typescript
import type {
  PaneLayout,
  PaneLayoutNode,
  PaneNode,
  SplitNode,
  LayoutPath,
  FindPaneResult,
  SplitPaneOptions,
} from "./types";

/**
 * Check if a node is a pane (leaf).
 */
export function isPaneNode(node: PaneLayoutNode): node is PaneNode {
  return node.type === "pane";
}

/**
 * Check if a node is a split (branch).
 */
export function isSplitNode(node: PaneLayoutNode): node is SplitNode {
  return node.type === "split";
}

/**
 * Find a pane by ID in the layout tree.
 * Returns the node, path, and parent info.
 */
export function findPane(
  layout: PaneLayout,
  paneId: string
): FindPaneResult | null {
  function search(
    node: PaneLayoutNode,
    path: LayoutPath,
    parent: SplitNode | null,
    indexInParent: number
  ): FindPaneResult | null {
    if (isPaneNode(node)) {
      if (node.paneId === paneId) {
        return { node, path, parent, indexInParent };
      }
      return null;
    }

    // It's a split node - search children
    for (let i = 0; i < node.children.length; i++) {
      const result = search(node.children[i], [...path, i], node, i);
      if (result) return result;
    }
    return null;
  }

  return search(layout.root, [], null, -1);
}

/**
 * Get all pane IDs in the layout.
 */
export function getAllPaneIds(layout: PaneLayout): string[] {
  const ids: string[] = [];

  function collect(node: PaneLayoutNode) {
    if (isPaneNode(node)) {
      ids.push(node.paneId);
    } else {
      node.children.forEach(collect);
    }
  }

  collect(layout.root);
  return ids;
}

/**
 * Count the number of panes in the layout.
 */
export function countPanes(layout: PaneLayout): number {
  return getAllPaneIds(layout).length;
}

/**
 * Get the first pane ID in the layout (for fallback active pane).
 */
export function getFirstPaneId(layout: PaneLayout): string | null {
  function findFirst(node: PaneLayoutNode): string | null {
    if (isPaneNode(node)) {
      return node.paneId;
    }
    for (const child of node.children) {
      const found = findFirst(child);
      if (found) return found;
    }
    return null;
  }
  return findFirst(layout.root);
}

/**
 * Deep clone a layout tree.
 */
export function cloneLayout(layout: PaneLayout): PaneLayout {
  return JSON.parse(JSON.stringify(layout));
}

/**
 * Split a pane, creating a new split node.
 * Returns a new layout (immutable).
 */
export function splitPane(
  layout: PaneLayout,
  options: SplitPaneOptions
): PaneLayout {
  const { paneId, direction, position, newPaneId, ratio = 0.5 } = options;

  const newLayout = cloneLayout(layout);
  const found = findPane(newLayout, paneId);

  if (!found) {
    throw new Error(`Pane ${paneId} not found in layout`);
  }

  const existingPane: PaneNode = { type: "pane", paneId };
  const newPane: PaneNode = { type: "pane", paneId: newPaneId };

  const children = position === "before"
    ? [newPane, existingPane]
    : [existingPane, newPane];

  const sizes = position === "before"
    ? [ratio * 100, (1 - ratio) * 100]
    : [(1 - ratio) * 100, ratio * 100];

  const splitNode: SplitNode = {
    type: "split",
    direction,
    children,
    sizes,
  };

  // Replace the pane node with the split node
  if (found.parent) {
    found.parent.children[found.indexInParent] = splitNode;
  } else {
    // Pane was root
    newLayout.root = splitNode;
  }

  return newLayout;
}

/**
 * Remove a pane from the layout.
 * If removing leaves a split with one child, collapse it.
 * Returns new layout or null if layout becomes empty.
 */
export function removePane(
  layout: PaneLayout,
  paneId: string
): PaneLayout | null {
  // If single pane and it's the one being removed, return null
  if (isPaneNode(layout.root) && layout.root.paneId === paneId) {
    return null;
  }

  const newLayout = cloneLayout(layout);

  function remove(
    node: PaneLayoutNode,
    parent: SplitNode | null,
    indexInParent: number
  ): PaneLayoutNode | null {
    if (isPaneNode(node)) {
      return node.paneId === paneId ? null : node;
    }

    // Process children
    const newChildren: PaneLayoutNode[] = [];
    const newSizes: number[] = [];
    let removedSize = 0;

    for (let i = 0; i < node.children.length; i++) {
      const result = remove(node.children[i], node, i);
      if (result) {
        newChildren.push(result);
        newSizes.push(node.sizes[i]);
      } else {
        removedSize += node.sizes[i];
      }
    }

    if (newChildren.length === 0) {
      return null;
    }

    if (newChildren.length === 1) {
      // Collapse single-child split
      return newChildren[0];
    }

    // Redistribute removed size proportionally
    const totalRemaining = newSizes.reduce((a, b) => a + b, 0);
    const adjustedSizes = newSizes.map(
      (s) => s + (removedSize * s) / totalRemaining
    );

    return {
      ...node,
      children: newChildren,
      sizes: adjustedSizes,
    };
  }

  const newRoot = remove(newLayout.root, null, -1);
  if (!newRoot) return null;

  newLayout.root = newRoot;
  return newLayout;
}

/**
 * Update sizes in a split node at the given path.
 */
export function updateSplitSizes(
  layout: PaneLayout,
  path: LayoutPath,
  newSizes: number[]
): PaneLayout {
  const newLayout = cloneLayout(layout);

  let node: PaneLayoutNode = newLayout.root;
  for (const index of path) {
    if (!isSplitNode(node)) {
      throw new Error("Invalid path - expected split node");
    }
    node = node.children[index];
  }

  if (!isSplitNode(node)) {
    throw new Error("Target node is not a split");
  }

  node.sizes = newSizes;
  return newLayout;
}

/**
 * Normalize sizes to sum to 100.
 */
export function normalizeSizes(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return sizes.map(() => 100 / sizes.length);
  return sizes.map((s) => (s / total) * 100);
}

/**
 * Validate that a layout is structurally correct.
 */
export function validateLayout(layout: PaneLayout): boolean {
  function validate(node: PaneLayoutNode): boolean {
    if (isPaneNode(node)) {
      return typeof node.paneId === "string" && node.paneId.length > 0;
    }

    if (node.children.length < 2) return false;
    if (node.sizes.length !== node.children.length) return false;

    const totalSize = node.sizes.reduce((a, b) => a + b, 0);
    if (Math.abs(totalSize - 100) > 0.1) return false;

    return node.children.every(validate);
  }

  return validate(layout.root);
}
```

---

## Checklist

- [ ] Create `src/components/pane-layout/types.ts` with layout type definitions
- [ ] Create `src/stores/pane-layout/types.ts` with Zod schemas
- [ ] Create `src/stores/pane-layout/defaults.ts` with factory functions
- [ ] Create `src/stores/pane-layout/tree-utils.ts` with tree manipulation utilities
- [ ] Add unit tests for tree utilities (split, remove, find operations)
- [ ] Ensure recursive Zod schema handles deeply nested layouts

---

## Testing Notes

Key scenarios to test:

1. **Find pane** - Find pane at various depths
2. **Split pane** - Split root pane, split nested pane, split in both directions
3. **Remove pane** - Remove from 2-pane split (collapses), remove from 3+ pane split
4. **Nested splits** - Create complex layouts with horizontal and vertical splits
5. **Size normalization** - Ensure sizes always sum to 100 after operations
6. **Validation** - Reject invalid layouts (wrong size count, <2 children, etc.)
