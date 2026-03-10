# 05a — Drag and Drop

**Layer 4 — parallel with 05b. Depends on 04a.**

## Summary

Add drag-and-drop to the sidebar tree using the already-installed `@dnd-kit/core` + `@dnd-kit/sortable` packages. A single `DndContext` wraps the `TreeMenu` flat item list. Implements custom collision detection for positional drop zones (reorder above/below vs. nest inside), `canCrossWorktreeBoundary()` validation, fractional sort key generation via the `fractional-indexing` npm package, and visual drop indicators.

## Dependencies

- **04a-rendering-components** — `TreeMenu` must iterate a flat `TreeItemNode[]` via type-based dispatch (`WorktreeItem`, `FolderItem`, `ThreadItem`, `PlanItem`, `TerminalItem`, `PullRequestItem`, `ChangesItem`, `UncommittedItem`, `CommitItem`)
- **03-unified-tree-model** — `TreeItemNode.type` includes `"worktree"` and `"folder"`, `worktreeId` field on every node, `buildUnifiedTree()` returns flat `TreeItemNode[]`, `useTreeData()` returns `TreeItemNode[]`
- **01-visual-settings-foundation** — `updateVisualSettings()` dispatcher at `src/lib/visual-settings.ts`
- **02b-folder-entity** — `folderService` available for updating folder `worktreeId`

## Installed Packages

Already in `package.json` (no install needed):

- `@dnd-kit/core@^6.3.1`
- `@dnd-kit/sortable@^10.0.0`
- `@dnd-kit/utilities@^3.2.2`

**New package to install:**

```bash
pnpm add fractional-indexing
```

This provides `generateKeyBetween(a: string | null, b: string | null): string` for lexicographic sort key generation. Keys are case-sensitive; use raw string comparison (not `localeCompare`).

## Key Files

| File | Change |
| --- | --- |
| `src/components/tree-menu/tree-menu.tsx` | Wrap flat item list with `DndContext`, add `DragOverlay`, handle `onDragStart`/`onDragEnd`/`onDragMove` |
| `src/components/tree-menu/use-tree-dnd.ts` | **New** — custom hook encapsulating all DnD state and handlers (follows `use-tab-dnd.ts` pattern) |
| `src/components/tree-menu/tree-dnd-overlay.tsx` | **New** — drag overlay component rendered inside `<DragOverlay>` |
| `src/components/tree-menu/drop-indicator.tsx` | **New** — blue line (reorder) and highlight (nest) indicator components |
| `src/lib/dnd-validation.ts` | **New** — `canCrossWorktreeBoundary()`, `validateDrop()`, `isAncestor()`, `findWorktreeAncestor()`, `getDropPosition()`, `buildTreeMaps()` |
| `src/lib/sort-key.ts` | **New** — thin wrapper around `fractional-indexing`'s `generateKeyBetween` |
| `src/stores/tree-menu/types.ts` | Add `sortKey?: string` to `TreeItemNode` |
| `src/hooks/use-tree-data.ts` | Populate `sortKey` from `visualSettings.sortKey` when building nodes |
| `src/components/tree-menu/worktree-item.tsx` | Add `useSortable()` hook + `data-tree-item-id` attribute |
| `src/components/tree-menu/folder-item.tsx` | Add `useSortable()` hook + `data-tree-item-id` attribute |
| `src/components/tree-menu/thread-item.tsx` | Add `useSortable()` hook + `data-tree-item-id` attribute |
| `src/components/tree-menu/plan-item.tsx` | Add `useSortable()` hook + `data-tree-item-id` attribute |
| `src/components/tree-menu/terminal-item.tsx` | Add `useSortable()` hook + `data-tree-item-id` attribute |
| `src/components/tree-menu/pull-request-item.tsx` | Add `useSortable()` hook + `data-tree-item-id` attribute |
| `src/lib/visual-settings.ts` | Already exists from 01 — called by drop handler to persist `parentId` + `sortKey` |

## Existing DnD Patterns in Codebase

The codebase already uses `@dnd-kit` in two places:

1. **Tab reordering** (`src/components/split-layout/`) — `SplitLayoutContainer` wraps content in `DndContext` with `closestCenter` collision detection. `useTabDnd()` hook encapsulates sensors, drag state, and event handlers. `TabItem` uses `useSortable()`. Custom edge-zone detection in `onDragMove` callback.

2. **Quick actions settings** (`src/components/settings/quick-actions-settings.tsx`) — simple `DndContext` + `SortableContext` + `verticalListSortingStrategy` for reordering a flat list.

The sidebar `DndContext` is in a different React subtree from both. In `MainWindowLayout`, `TreeMenu` lives inside the left `ResizablePanel`, while `SplitLayoutContainer` (with its own `DndContext`) is a sibling in the center panel. No nesting conflicts.

## Implementation

### 1. Sort Key Utility (`src/lib/sort-key.ts`)

```typescript
import { generateKeyBetween } from "fractional-indexing";
import type { TreeItemNode } from "@/stores/tree-menu/types";

/**
 * Generate a sort key between two adjacent items.
 * @param before - sortKey of the item before the insertion point, or null for start
 * @param after - sortKey of the item after the insertion point, or null for end
 * @returns A string key that sorts between `before` and `after`
 */
export function generateSortKey(
  before: string | null,
  after: string | null,
): string {
  return generateKeyBetween(before, after);
}

/**
 * Given the siblings of the target parent and an insertion index,
 * compute the sortKey for the dropped item.
 *
 * @param siblings - The current children of the target parent, sorted in display order
 * @param insertionIndex - Where in the sibling list the item is being inserted (0-based)
 * @returns The new sortKey string
 */
export function computeSortKeyForInsertion(
  siblings: TreeItemNode[],
  insertionIndex: number,
): string {
  const before = insertionIndex > 0
    ? siblings[insertionIndex - 1].sortKey ?? null
    : null;
  const after = insertionIndex < siblings.length
    ? siblings[insertionIndex].sortKey ?? null
    : null;
  return generateKeyBetween(before, after);
}
```

**Type change:** Add `sortKey?: string` to `TreeItemNode` in `src/stores/tree-menu/types.ts`. Populate it from `entity.visualSettings?.sortKey` inside `buildUnifiedTree()` in `src/hooks/use-tree-data.ts` when constructing each node.

### 2. Drop Validation (`src/lib/dnd-validation.ts`)

```typescript
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";

/** Types that can contain children (accept drops "inside"). */
const CONTAINER_TYPES: Set<TreeItemType> = new Set([
  "worktree", "folder", "plan", "thread",
]);

/** Types that are synthetic and cannot be dragged or dropped onto. */
const SYNTHETIC_TYPES: Set<TreeItemType> = new Set([
  "changes", "uncommitted", "commit",
]);

/** Types that are leaf-only and cannot accept drops "inside". */
const LEAF_TYPES: Set<TreeItemType> = new Set([
  "terminal", "pull-request", "changes", "uncommitted", "commit",
]);

export type DropPosition = "above" | "inside" | "below";

export interface DropValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Per-type override for worktree boundary enforcement.
 * Returns true if the given type is allowed to move between worktrees.
 * Currently all types are locked to their worktree.
 * Future: return type === "plan" to allow plans to cross worktree boundaries.
 */
export function canCrossWorktreeBoundary(type: TreeItemType): boolean {
  return false;
}

/**
 * Check if `potentialAncestorId` is an ancestor of `nodeId` in the tree.
 * Used for cycle detection — cannot drop a node into its own descendant.
 */
export function isAncestor(
  nodeId: string,
  potentialAncestorId: string,
  parentMap: Map<string, string | undefined>,
): boolean {
  let current = parentMap.get(nodeId);
  const visited = new Set<string>();
  while (current) {
    if (current === potentialAncestorId) return true;
    if (visited.has(current)) return false; // safety: break cycles
    visited.add(current);
    current = parentMap.get(current);
  }
  return false;
}

/**
 * Walk up the ancestor chain from a node to find the worktree node it belongs to.
 * Returns the worktree node ID, or undefined if the node is at root level.
 */
export function findWorktreeAncestor(
  nodeId: string,
  nodeMap: Map<string, TreeItemNode>,
  parentMap: Map<string, string | undefined>,
): string | undefined {
  let currentId: string | undefined = nodeId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) return undefined;
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (node?.type === "worktree") return node.id;
    currentId = parentMap.get(currentId);
  }
  return undefined;
}

/**
 * Validate whether a drop operation is allowed.
 */
export function validateDrop(
  draggedItem: TreeItemNode,
  targetItem: TreeItemNode,
  dropPosition: DropPosition,
  nodeMap: Map<string, TreeItemNode>,
  parentMap: Map<string, string | undefined>,
): DropValidationResult {
  // 1. Cannot drag synthetic items
  if (SYNTHETIC_TYPES.has(draggedItem.type)) {
    return { valid: false, reason: "This item cannot be moved" };
  }

  // 2. Cannot drop onto synthetic items
  if (SYNTHETIC_TYPES.has(targetItem.type)) {
    return { valid: false, reason: "Cannot drop here" };
  }

  // 3. Cannot nest inside leaf-only types
  if (dropPosition === "inside" && LEAF_TYPES.has(targetItem.type)) {
    return { valid: false, reason: `Cannot nest inside ${targetItem.type}` };
  }

  // 4. Dropping on self is a no-op
  if (draggedItem.id === targetItem.id) {
    return { valid: false };
  }

  // 5. Cycle detection: cannot drop a node into its own descendant
  if (dropPosition === "inside" && isAncestor(targetItem.id, draggedItem.id, parentMap)) {
    return { valid: false, reason: "Cannot drop a node into its own descendant" };
  }

  // 6. Determine the effective new parent
  const newParentId = dropPosition === "inside"
    ? targetItem.id
    : parentMap.get(targetItem.id);

  // 7. Worktrees cannot nest inside other worktrees
  if (draggedItem.type === "worktree" && dropPosition === "inside" && targetItem.type === "worktree") {
    return { valid: false, reason: "Cannot nest a worktree inside another worktree" };
  }

  // 8. Worktree boundary enforcement for non-worktree, non-folder types
  if (
    draggedItem.type !== "worktree" &&
    draggedItem.type !== "folder" &&
    !canCrossWorktreeBoundary(draggedItem.type)
  ) {
    const draggedWorktree = draggedItem.worktreeId;
    if (draggedWorktree) {
      const targetWorktree = newParentId
        ? findWorktreeAncestor(newParentId, nodeMap, parentMap)
        : undefined;
      if (!targetWorktree || targetWorktree !== draggedWorktree) {
        return { valid: false, reason: "Cannot move between worktrees" };
      }
    }
  }

  // 9. Folders with worktree-bound children cannot move to a different worktree
  if (draggedItem.type === "folder" && draggedItem.worktreeId) {
    const targetWorktree = newParentId
      ? findWorktreeAncestor(newParentId, nodeMap, parentMap)
      : undefined;
    if (targetWorktree && targetWorktree !== draggedItem.worktreeId) {
      return { valid: false, reason: "Folder contains items from a different worktree" };
    }
  }

  return { valid: true };
}

/**
 * Determine drop position based on cursor Y position within the target element.
 * Container types: top 25% = above, middle 50% = inside, bottom 25% = below
 * Leaf types: top 50% = above, bottom 50% = below
 */
export function getDropPosition(
  cursorY: number,
  targetRect: DOMRect,
  targetType: TreeItemType,
): DropPosition {
  const relativeY = cursorY - targetRect.top;
  const height = targetRect.height;

  if (CONTAINER_TYPES.has(targetType)) {
    if (relativeY < height * 0.25) return "above";
    if (relativeY > height * 0.75) return "below";
    return "inside";
  }

  // Leaf types: no nesting
  return relativeY < height * 0.5 ? "above" : "below";
}

/**
 * Build lookup maps from the flat tree items array.
 */
export function buildTreeMaps(items: TreeItemNode[]): {
  nodeMap: Map<string, TreeItemNode>;
  parentMap: Map<string, string | undefined>;
} {
  const nodeMap = new Map<string, TreeItemNode>();
  const parentMap = new Map<string, string | undefined>();
  for (const item of items) {
    nodeMap.set(item.id, item);
    parentMap.set(item.id, item.parentId);
  }
  return { nodeMap, parentMap };
}
```

### 3. Tree DnD Hook (`src/components/tree-menu/use-tree-dnd.ts`)

Follows the `src/components/split-layout/use-tab-dnd.ts` pattern: one hook encapsulating sensors, state, and event handlers.

```typescript
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
import { updateVisualSettings } from "@/lib/visual-settings";
import { computeSortKeyForInsertion } from "@/lib/sort-key";
import {
  validateDrop,
  getDropPosition,
  buildTreeMaps,
  findWorktreeAncestor,
  type DropPosition,
  type DropValidationResult,
} from "@/lib/dnd-validation";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";

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

    // Find the tree item element under the cursor via data attribute
    const elements = document.elementsFromPoint(cursorX, cursorY);
    const targetEl = elements.find(
      (el) => el.hasAttribute("data-tree-item-id"),
    ) as HTMLElement | undefined;

    if (!targetEl) {
      setDropTarget(null);
      dropTargetRef.current = null;
      clearAutoExpandTimer();
      return;
    }

    const targetId = targetEl.getAttribute("data-tree-item-id")!;
    const { nodeMap, parentMap } = buildTreeMaps(items);
    const targetItem = nodeMap.get(targetId);
    if (!targetItem) {
      setDropTarget(null);
      dropTargetRef.current = null;
      clearAutoExpandTimer();
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const position = getDropPosition(cursorY, rect, targetItem.type);
    const validation = validateDrop(drag.item, targetItem, position, nodeMap, parentMap);

    const newDropTarget = { item: targetItem, position, validation };
    setDropTarget(newDropTarget);
    dropTargetRef.current = newDropTarget;

    // Auto-expand collapsed containers on sustained hover
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
          const expandKey = getExpandKey(targetItem);
          await treeMenuService.expandSection(expandKey);
          autoExpandTargetRef.current = null;
        }, AUTO_EXPAND_DELAY_MS);
      }
    } else if (autoExpandTargetRef.current !== targetId) {
      clearAutoExpandTimer();
    }
  }, [items, clearAutoExpandTimer]);

  const handleDragEnd = useCallback(async (_event: DragEndEvent) => {
    const drag = activeDragRef.current;
    const currentDropTarget = dropTargetRef.current;
    activeDragRef.current = null;
    setActiveDrag(null);
    setDropTarget(null);
    dropTargetRef.current = null;
    clearAutoExpandTimer();

    if (!drag || !currentDropTarget || !currentDropTarget.validation.valid) return;

    try {
      await executeDrop(drag.item, currentDropTarget.item, currentDropTarget.position, items);
    } catch (err) {
      logger.error("[useTreeDnd] Drop failed:", err);
    }
  }, [items, clearAutoExpandTimer]);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    activeDragRef.current = null;
    setActiveDrag(null);
    setDropTarget(null);
    dropTargetRef.current = null;
    clearAutoExpandTimer();
  }, [clearAutoExpandTimer]);

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

/**
 * Get the expansion key for a node (matches convention in use-tree-data.ts buildUnifiedTree).
 */
function getExpandKey(item: TreeItemNode): string {
  switch (item.type) {
    case "worktree": return item.id;
    case "folder": return `folder:${item.id}`;
    case "plan": return `plan:${item.id}`;
    case "thread": return `thread:${item.id}`;
    default: return item.id;
  }
}

/**
 * Execute the drop: compute new parentId + sortKey, persist via updateVisualSettings.
 */
async function executeDrop(
  draggedItem: TreeItemNode,
  targetItem: TreeItemNode,
  position: DropPosition,
  allItems: TreeItemNode[],
): Promise<void> {
  // 1. Determine new parentId
  const newParentId = position === "inside"
    ? targetItem.id
    : targetItem.parentId ?? undefined;

  // 2. Find siblings in the new parent (excluding the dragged item itself)
  const siblings = allItems.filter(
    (item) => item.parentId === newParentId && item.id !== draggedItem.id,
  );

  // 3. Determine insertion index among siblings
  let insertionIndex: number;
  if (position === "inside") {
    insertionIndex = siblings.length; // append at end of container
  } else {
    const targetIndex = siblings.findIndex((s) => s.id === targetItem.id);
    insertionIndex = position === "above"
      ? Math.max(targetIndex, 0)
      : (targetIndex >= 0 ? targetIndex + 1 : siblings.length);
  }

  // 4. Generate sort key
  const sortKey = computeSortKeyForInsertion(siblings, insertionIndex);

  // 5. Persist via updateVisualSettings dispatcher (src/lib/visual-settings.ts)
  const entityType = mapTreeItemTypeToEntityType(draggedItem.type);
  await updateVisualSettings(entityType, draggedItem.id, {
    parentId: newParentId,
    sortKey,
  });

  // 6. If moving a folder, update its worktreeId if worktree context changed
  if (draggedItem.type === "folder") {
    const { nodeMap, parentMap } = buildTreeMaps(allItems);
    parentMap.set(draggedItem.id, newParentId); // use new parent for lookup
    const newWorktreeId = newParentId
      ? findWorktreeAncestor(newParentId, nodeMap, parentMap)
      : undefined;
    if (newWorktreeId !== draggedItem.worktreeId) {
      const { folderService } = await import("@/entities/folders/service");
      await folderService.update(draggedItem.id, { worktreeId: newWorktreeId });
    }
  }

  logger.debug(`[useTreeDnd] Dropped ${draggedItem.type} "${draggedItem.title}" ${position} "${targetItem.title}"`);
}

function mapTreeItemTypeToEntityType(
  type: TreeItemType,
): "thread" | "plan" | "pull-request" | "terminal" | "folder" | "worktree" {
  switch (type) {
    case "thread": return "thread";
    case "plan": return "plan";
    case "pull-request": return "pull-request";
    case "terminal": return "terminal";
    case "folder": return "folder";
    case "worktree": return "worktree";
    default: throw new Error(`Cannot move item of type: ${type}`);
  }
}
```

### 4. Drag Overlay (`src/components/tree-menu/tree-dnd-overlay.tsx`)

Semi-transparent preview of the dragged item inside `<DragOverlay>`:

```tsx
import type { ActiveDragState } from "./use-tree-dnd";

interface TreeDndOverlayProps {
  activeDrag: ActiveDragState;
}

export function TreeDndOverlay({ activeDrag }: TreeDndOverlayProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface-800 border border-surface-600 rounded text-[13px] text-surface-200 opacity-80 shadow-lg pointer-events-none max-w-[240px]">
      <span className="truncate">{activeDrag.item.title}</span>
    </div>
  );
}
```

### 5. Drop Indicator (`src/components/tree-menu/drop-indicator.tsx`)

Renders visual drop feedback overlaid on the tree. Positioned absolutely within the scroll container.

Three states:

| State | Visual |
| --- | --- |
| Valid reorder (above/below) | 2px blue horizontal line at the edge of the target row |
| Valid nest (inside) | Accent background highlight on the target row |
| Invalid drop | Red-tinted overlay on the target row, `title` attribute shows reason |

```tsx
import { getTreeIndentPx } from "@/lib/tree-indent";
import type { DropTargetState } from "./use-tree-dnd";

interface DropIndicatorProps {
  dropTarget: DropTargetState;
}

export function DropIndicator({ dropTarget }: DropIndicatorProps) {
  const { item, position, validation } = dropTarget;

  const targetEl = document.querySelector(
    `[data-tree-item-id="${item.id}"]`,
  ) as HTMLElement | null;
  if (!targetEl) return null;

  const containerEl = targetEl.closest("[data-testid='tree-menu']");
  if (!containerEl) return null;

  const rect = targetEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const scrollTop = containerEl.scrollTop;

  // Position relative to scroll container (accounts for scroll offset)
  const top = rect.top - containerRect.top + scrollTop;
  const indent = getTreeIndentPx(item.depth);

  if (!validation.valid && validation.reason) {
    return (
      <div
        className="absolute pointer-events-none bg-red-500/10 border border-red-500/30 rounded-sm z-10"
        style={{
          top: `${top}px`,
          left: `${indent}px`,
          width: `calc(100% - ${indent}px)`,
          height: `${rect.height}px`,
        }}
        title={validation.reason}
      />
    );
  }

  if (!validation.valid) return null; // no-reason invalid (e.g. drop on self)

  if (position === "inside") {
    return (
      <div
        className="absolute pointer-events-none bg-accent-500/15 border border-accent-500/40 rounded-sm z-10"
        style={{
          top: `${top}px`,
          left: `${indent}px`,
          width: `calc(100% - ${indent}px)`,
          height: `${rect.height}px`,
        }}
      />
    );
  }

  // Reorder line
  const lineTop = position === "above" ? top : top + rect.height;
  return (
    <div
      className="absolute pointer-events-none h-[2px] bg-accent-400 rounded-full z-10"
      style={{
        top: `${lineTop}px`,
        left: `${indent}px`,
        width: `calc(100% - ${indent}px)`,
      }}
    />
  );
}
```

### 6. TreeMenu Integration (`src/components/tree-menu/tree-menu.tsx`)

After 04a, `TreeMenu` iterates a flat `TreeItemNode[]` with type-based dispatch. Add `DndContext` wrapper:

```tsx
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useTreeDnd } from "./use-tree-dnd";
import { TreeDndOverlay } from "./tree-dnd-overlay";
import { DropIndicator } from "./drop-indicator";

export function TreeMenu({ /* ...existing props */ }) {
  const items = useTreeData(); // TreeItemNode[] after 03/04a

  const {
    sensors,
    activeDrag,
    dropTarget,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = useTreeDnd(items);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        ref={containerRef}
        role="tree"
        aria-label="Sidebar tree"
        data-testid="tree-menu"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={`flex-1 overflow-auto focus:outline-none pl-2 relative ${className ?? ""}`}
      >
        {items.map((item, index) => (
          <TreeItemRenderer key={item.id} item={item} index={index} /* ...props */ />
        ))}

        {/* Drop indicator overlay (absolute positioned within scroll container) */}
        {dropTarget && <DropIndicator dropTarget={dropTarget} />}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag ? <TreeDndOverlay activeDrag={activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
```

**Key decisions:**

- **No** `collisionDetection` **prop** on `DndContext`. Drop zone detection is handled manually in `onDragMove` via `document.elementsFromPoint()` because dnd-kit's built-in algorithms (closestCenter, rectIntersection) don't support the 25%/50%/25% positional hit regions.
- `dropAnimation={null}` on `DragOverlay` to disable the spring-back animation.
- `relative` class on the scroll container so `DropIndicator` positions correctly with `absolute`.

### 7. Making Items Draggable

Each draggable item component needs three changes:

1. Add `data-tree-item-id={item.id}` attribute on the root element (for `elementsFromPoint` lookup).
2. Use `useSortable()` hook from `@dnd-kit/sortable` with `TreeDragData`.
3. Apply `setNodeRef`, `attributes`, `listeners`, `transform`, `transition`, `isDragging` to the root element.

**Pattern to apply to each of:** `worktree-item.tsx`**,** `folder-item.tsx`**,** `thread-item.tsx`**,** `plan-item.tsx`**,** `terminal-item.tsx`**,** `pull-request-item.tsx`**:**

```tsx
import { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TreeDragData } from "./use-tree-dnd";

export function ThreadItem({ item, /* ...other props */ }: ThreadItemProps) {
  const dragData: TreeDragData = useMemo(
    () => ({ type: "tree-item", item }),
    [item],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: dragData });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${indentPx}px`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-tree-item-id={item.id}
      role="treeitem"
      aria-selected={isSelected}
      className={cn(
        /* ...existing classes */
        isDragging && "opacity-50",
      )}
      onClick={handleClick}
      onContextMenu={/* ...existing handler */}
    >
      {/* ...existing content */}
    </div>
  );
}
```

**Synthetic items** (`ChangesItem`, `UncommittedItem`, `CommitItem`) do NOT get `useSortable()`. They remain non-draggable and only need `data-tree-item-id` for the `elementsFromPoint` lookup (so the validation can reject drops onto them).

### 8. DndContext Nesting Architecture

```
MainWindowLayout
├── ResizablePanel (left)
│   └── TreeMenu
│       └── DndContext            ← NEW (sidebar DnD)
├── SplitLayoutContainer (center)
│   └── DndContext                ← EXISTING (tab DnD)
└── ResizablePanel (right, optional)
```

These `DndContext` instances are siblings in the React tree, not nested. Each manages its own `PointerSensor` and drag state independently. No coordination or conflict prevention needed.

## Acceptance Criteria

- [ ] Items can be dragged and reordered within same parent

- [ ] Items can be dragged into container types (`worktree`, `folder`, `plan`, `thread`) to nest

- [ ] Worktree boundary enforcement works (cannot drag items between worktrees)

- [ ] Cycle detection prevents dropping a node into its descendant

- [ ] Fractional sort keys generated correctly on drop via `fractional-indexing`

- [ ] Visual indicators show valid drop zones (blue line for reorder, accent highlight for nest)

- [ ] Visual indicators show invalid drop zones (red tint + reason)

- [ ] Collapsed containers auto-expand on 500ms hover during drag

- [ ] `visualSettings` (`parentId` + `sortKey`) persisted to disk on drop via `updateVisualSettings()`

- [ ] Folder `worktreeId` updated when folder moves into/out of a worktree

- [ ] Synthetic items (changes, uncommitted, commit) are not draggable

- [ ] Worktrees cannot be nested inside other worktrees

- [ ] No interference with the existing tab DnD in `SplitLayoutContainer`

## Phases

- [x] Install `fractional-indexing` package; create `src/lib/sort-key.ts` wrapper; add `sortKey` field to `TreeItemNode` in `src/stores/tree-menu/types.ts` and populate in `buildUnifiedTree()` in `src/hooks/use-tree-data.ts`

- [x] Create `src/lib/dnd-validation.ts` with `canCrossWorktreeBoundary()`, `validateDrop()`, `isAncestor()`, `findWorktreeAncestor()`, `getDropPosition()`, `buildTreeMaps()`

- [x] Create `src/components/tree-menu/use-tree-dnd.ts` hook with sensors, drag state, auto-expand timer, drop execution via `updateVisualSettings()`

- [x] Create `src/components/tree-menu/tree-dnd-overlay.tsx` drag preview component

- [x] Create `src/components/tree-menu/drop-indicator.tsx` visual indicator component (reorder line, nest highlight, invalid tint)

- [x] Integrate `DndContext` + `DragOverlay` + `DropIndicator` into `src/components/tree-menu/tree-menu.tsx`

- [x] Add `useSortable()` + `data-tree-item-id` to all non-synthetic item components: `worktree-item.tsx`, `folder-item.tsx`, `thread-item.tsx`, `plan-item.tsx`, `terminal-item.tsx`, `pull-request-item.tsx`; add `data-tree-item-id` only (no `useSortable`) to synthetic items: `changes-item.tsx`, `uncommitted-item.tsx`, `commit-item.tsx`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---