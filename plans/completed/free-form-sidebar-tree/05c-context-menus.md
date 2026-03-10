# 05c — Context Menus

**Layer 4 — depends on 05a and 05b.**

## Summary

Add context menu actions for organizing items in the tree: "New folder", "Move to...", "Move to root". These are the non-DnD ways to reorganize the sidebar.

## Dependencies

- **05a-drag-and-drop** — `validateDrop()` in `src/lib/dnd-validation.ts` used for "Move to..." target filtering
- **05b-folder-crud-ui** — `folderService.create()` in `src/entities/folders/service.ts` used by "New folder"
- **04a-rendering-components** — `worktree-item.tsx` and `folder-item.tsx` exist as standalone components
- **03-unified-tree-model** — `useTreeData()` returns flat `TreeItemNode[]` with `worktreeId` on every node
- **01-visual-settings-foundation** — `updateVisualSettings()` dispatcher in `src/lib/visual-settings.ts`

## Key Files

| File | Change |
| --- | --- |
| `src/components/tree-menu/thread-item.tsx` | Add `useContextMenu` (already present), add "Move to..." and "Move to root" menu items |
| `src/components/tree-menu/plan-item.tsx` | Add "Move to..." and "Move to root" to existing context menu |
| `src/components/tree-menu/terminal-item.tsx` | Add `useContextMenu` + `ContextMenu` (currently has none), add "Move to..." and "Move to root" |
| `src/components/tree-menu/pull-request-item.tsx` | Add `useContextMenu` + `ContextMenu` (currently has none), add "Move to..." and "Move to root" |
| `src/components/tree-menu/folder-item.tsx` | Add "New folder", "Move to...", "Move to root" to context menu (created in 05b) |
| `src/components/tree-menu/worktree-item.tsx` | Add "New folder" to context menu (created in 04a) |
| `src/components/tree-menu/move-to-dialog.tsx` | **New** — portal-based tree picker dialog for "Move to..." |
| `src/components/tree-menu/use-move-to.ts` | **New** — shared hook/state for the "Move to..." dialog |

## Existing Patterns (Reference)

### Context menu system

The codebase uses a **custom context menu** system (not radix). All primitives live in `src/components/ui/context-menu.tsx`:

- `useContextMenu()` — hook returning `{ show, position, open, close }`
- `ContextMenu` — portal wrapper (`createPortal` to `document.body`), positioned at `{ top, left }`, auto-closes on click-outside or Escape
- `ContextMenuItem` — `{ icon: LucideIcon, label: string, onClick: () => void }` — standard item
- `ContextMenuItemDanger` — red-styled destructive variant
- `ContextMenuDivider` — horizontal separator

Usage pattern (from `thread-item.tsx`):
```tsx
const contextMenu = useContextMenu();
// ...
<div onContextMenu={contextMenu.open}>
  {/* row content */}
</div>
{contextMenu.show && (
  <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
    <ContextMenuItem icon={Copy} label="Copy Thread ID" onClick={() => { ... }} />
  </ContextMenu>
)}
```

### Modal pattern

Modals in this codebase use a `fixed inset-0 z-50` overlay with `bg-black/60` backdrop (see `permission-modal.tsx`). The dialog itself is styled with `bg-surface-800 border border-surface-700 rounded-lg shadow-xl`.

### Visual settings update

`updateVisualSettings()` in `src/lib/visual-settings.ts` is the single dispatcher for persisting `{ parentId, sortKey }` on any entity. It switches on entity type and calls the appropriate service.

### Fractional indexing

From 03-unified-tree-model, a fractional-indexing utility is available for generating sort keys. Used to place items at the end of a container's children list.

## Implementation

### 1. Shared "Move to..." State Hook — `src/components/tree-menu/use-move-to.ts`

A lightweight hook that manages the dialog open/close state so any item component can trigger it.

```typescript
// src/components/tree-menu/use-move-to.ts
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
```

This is a tiny Zustand store (not a React hook with context) so that any item component can call `useMoveToStore.getState().openMoveDialog(item)` without prop drilling.

### 2. "Move to..." Dialog — `src/components/tree-menu/move-to-dialog.tsx`

A portal-based modal showing the tree with valid drop targets selectable.

**Component structure:**

```tsx
// src/components/tree-menu/move-to-dialog.tsx
import { useEffect, useMemo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, ChevronRight, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMoveToStore } from "./use-move-to";
import { useTreeData } from "@/hooks/use-tree-data";
import { validateDrop } from "@/lib/dnd-validation";
import { updateVisualSettings } from "@/lib/visual-settings";
import { generateKeyBetween } from "@/lib/fractional-indexing"; // or the package
import { logger } from "@/lib/logger-client";
import type { TreeItemNode } from "@/stores/tree-menu/types";

export function MoveToDialog() {
  const movingItem = useMoveToStore((s) => s.movingItem);
  const close = useMoveToStore((s) => s.closeMoveDialog);

  if (!movingItem) return null;
  return createPortal(
    <MoveToDialogInner item={movingItem} onClose={close} />,
    document.body,
  );
}
```

**Inner component (`MoveToDialogInner`):**

- Renders a `fixed inset-0 z-50` overlay with `bg-black/60` backdrop
- Dialog card: `bg-surface-800 border border-surface-700 rounded-lg shadow-xl w-full max-w-sm mx-4`
- Header: `Move "{item.title}" to:` with close X button
- Body: scrollable list of valid targets (max-height ~300px, overflow-y auto)
- Each target row shows icon + title, clickable if valid, dimmed if invalid
- Close on Escape key or backdrop click

**Target list logic:**

```typescript
function getValidTargets(
  movingItem: TreeItemNode,
  allItems: TreeItemNode[],
): Array<{ item: TreeItemNode; valid: boolean; reason?: string }> {
  // Build childrenMap from allItems for validateDrop
  const childrenMap = new Map<string, TreeItemNode[]>();
  for (const item of allItems) {
    // parentId is from visualSettings — items with undefined parentId are tree-root-level
    // The unified tree builder already resolves this
  }

  // Filter to container types only (worktree, folder, thread, plan)
  // These are the only types that can receive children
  const containerTypes = new Set(["worktree", "folder", "thread", "plan"]);

  return allItems
    .filter((item) => containerTypes.has(item.type) && item.id !== movingItem.id)
    .map((target) => {
      const result = validateDrop(movingItem, target, "inside", childrenMap);
      return { item: target, valid: result.valid, reason: result.reason };
    });
}
```

**On selection handler:**

```typescript
async function handleMoveToTarget(movingItem: TreeItemNode, targetItem: TreeItemNode) {
  // 1. Determine new parentId
  const newParentId = targetItem.id;

  // 2. Generate sortKey — append to end of target's children
  //    Get the last child's sortKey, generate one after it
  //    If no children, use generateKeyBetween(null, null)
  const lastChildKey = getLastChildSortKey(targetItem.id, allItems);
  const newSortKey = generateKeyBetween(lastChildKey, null);

  // 3. Map TreeItemNode.type to VisualEntityType for updateVisualSettings
  const entityType = mapTreeTypeToEntityType(movingItem.type);

  // 4. Persist
  await updateVisualSettings(entityType, movingItem.id, {
    parentId: newParentId,
    sortKey: newSortKey,
  });

  close();
}
```

**Helper to map types:**

```typescript
function mapTreeTypeToEntityType(
  type: TreeItemNode["type"],
): "thread" | "plan" | "pull-request" | "terminal" | "folder" | "worktree" {
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
```

**Target row rendering:**

```tsx
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
      <TargetIcon type={target.type} icon={target.icon} />
      <span className="truncate">{target.title}</span>
    </button>
  );
}
```

`TargetIcon` renders the appropriate icon for each target type (Folder for folders, worktree name styling for worktrees, etc.).

### 3. "Move to Root" — Inline Handler

"Move to root" sets `visualSettings.parentId` to the item's `worktreeId` (the worktree node it belongs to). Only shown when the item is not already a direct child of its worktree.

```typescript
async function handleMoveToRoot(item: TreeItemNode) {
  if (!item.worktreeId) {
    logger.warn("[MoveToRoot] Item has no worktreeId", { id: item.id });
    return;
  }

  const entityType = mapTreeTypeToEntityType(item.type);

  await updateVisualSettings(entityType, item.id, {
    parentId: item.worktreeId,
    sortKey: undefined, // will sort by createdAt (default)
  });
}
```

**Condition for showing "Move to root":**

An item is already at worktree root when its visual parent IS the worktree. After 03-unified-tree-model, every `TreeItemNode` has a `worktreeId` field. The item's current `parentId` (from `visualSettings`) tells us where it lives. If `parentId === worktreeId`, it's already at root. The tree builder resolves this — we can check:

```typescript
// Show "Move to root" when the item is nested (not a direct child of its worktree)
const isNestedInsideFolder = item.parentId !== undefined && item.parentId !== item.worktreeId;
```

### 4. Mount `MoveToDialog` in Tree Menu

Add `<MoveToDialog />` at the bottom of the `TreeMenu` component (`src/components/tree-menu/tree-menu.tsx`) so the portal is always mounted:

```tsx
// At the bottom of TreeMenu's return JSX:
<MoveToDialog />
```

### 5. Context Menu Changes Per Item Type

All changes follow the established pattern: import `ContextMenuItem` from `@/components/ui/context-menu`, add items to the existing `{contextMenu.show && (...)}` block.

#### `src/components/tree-menu/worktree-item.tsx`

Add after existing context menu items (new thread, terminal, PR, rename, archive, etc.):

```tsx
import { FolderPlus } from "lucide-react";
import { folderService } from "@/entities/folders/service";

// In the context menu JSX, after the "New thread" / "New terminal" / etc. section:
<ContextMenuDivider />
<ContextMenuItem
  icon={FolderPlus}
  label="New folder"
  onClick={() => {
    contextMenu.close();
    // Create folder inside this worktree, at worktree root
    folderService.create({
      name: "New Folder",
      worktreeId: item.id, // worktree node's ID is the worktreeId
      parentId: item.id,   // visual parent is the worktree itself
    });
    // 05b handles entering inline rename mode after create
  }}
/>
```

#### `src/components/tree-menu/folder-item.tsx`

Add to the existing context menu (created in 05b for rename/delete/icon). Import the move-to store:

```tsx
import { FolderPlus, ArrowRightLeft, CornerLeftUp } from "lucide-react";
import { folderService } from "@/entities/folders/service";
import { useMoveToStore } from "./use-move-to";
import { updateVisualSettings } from "@/lib/visual-settings";

// Inside the context menu block:
<ContextMenuItem
  icon={FolderPlus}
  label="New folder"
  onClick={() => {
    contextMenu.close();
    folderService.create({
      name: "New Folder",
      worktreeId: item.worktreeId,
      parentId: item.id, // nested inside this folder
    });
  }}
/>
<ContextMenuDivider />
<ContextMenuItem
  icon={ArrowRightLeft}
  label="Move to..."
  onClick={() => {
    contextMenu.close();
    useMoveToStore.getState().openMoveDialog(item);
  }}
/>
{/* Only show "Move to root" when nested inside another folder */}
{item.parentId && item.parentId !== item.worktreeId && (
  <ContextMenuItem
    icon={CornerLeftUp}
    label="Move to root"
    onClick={async () => {
      contextMenu.close();
      await updateVisualSettings("folder", item.id, {
        parentId: item.worktreeId,
        sortKey: undefined,
      });
    }}
  />
)}
```

#### `src/components/tree-menu/thread-item.tsx`

The thread-item already has `useContextMenu` and renders a `ContextMenu` with "Copy Thread ID". Add the new items after the existing one:

```tsx
import { ArrowRightLeft, CornerLeftUp } from "lucide-react";
import { useMoveToStore } from "./use-move-to";
import { updateVisualSettings } from "@/lib/visual-settings";

// Inside the existing <ContextMenu> block, after "Copy Thread ID":
<ContextMenuDivider />
<ContextMenuItem
  icon={ArrowRightLeft}
  label="Move to..."
  onClick={() => {
    contextMenu.close();
    useMoveToStore.getState().openMoveDialog(item);
  }}
/>
{item.parentId && item.parentId !== item.worktreeId && (
  <ContextMenuItem
    icon={CornerLeftUp}
    label="Move to root"
    onClick={async () => {
      contextMenu.close();
      await updateVisualSettings("thread", item.id, {
        parentId: item.worktreeId,
        sortKey: undefined,
      });
    }}
  />
)}
```

#### `src/components/tree-menu/plan-item.tsx`

Plan-item already has a rich context menu with Archive, Delete, Delete+git. Add the move actions in a new section before the destructive actions:

```tsx
import { ArrowRightLeft, CornerLeftUp } from "lucide-react";
import { useMoveToStore } from "./use-move-to";
import { updateVisualSettings } from "@/lib/visual-settings";

// Inside the non-confirming branch of the context menu, before the Archive item:
<ContextMenuItem
  icon={ArrowRightLeft}
  label="Move to..."
  onClick={() => {
    contextMenu.close();
    useMoveToStore.getState().openMoveDialog(item);
  }}
/>
{item.parentId && item.parentId !== item.worktreeId && (
  <ContextMenuItem
    icon={CornerLeftUp}
    label="Move to root"
    onClick={async () => {
      contextMenu.close();
      await updateVisualSettings("plan", item.id, {
        parentId: item.worktreeId,
        sortKey: undefined,
      });
    }}
  />
)}
<ContextMenuDivider />
{/* existing Archive, Delete, Delete+git items follow */}
```

#### `src/components/tree-menu/terminal-item.tsx`

Terminal-item currently has **no context menu**. Add `useContextMenu` and a `ContextMenu`:

```tsx
import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuDivider,
} from "@/components/ui/context-menu";
import { ArrowRightLeft, CornerLeftUp } from "lucide-react";
import { useMoveToStore } from "./use-move-to";
import { updateVisualSettings } from "@/lib/visual-settings";

// Inside the component:
const contextMenu = useContextMenu();

// On the row div, add:
// onContextMenu={contextMenu.open}

// After the row div, render:
{contextMenu.show && (
  <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
    <ContextMenuItem
      icon={ArrowRightLeft}
      label="Move to..."
      onClick={() => {
        contextMenu.close();
        useMoveToStore.getState().openMoveDialog(item);
      }}
    />
    {item.parentId && item.parentId !== item.worktreeId && (
      <ContextMenuItem
        icon={CornerLeftUp}
        label="Move to root"
        onClick={async () => {
          contextMenu.close();
          await updateVisualSettings("terminal", item.id, {
            parentId: item.worktreeId,
            sortKey: undefined,
          });
        }}
      />
    )}
  </ContextMenu>
)}
```

Note: terminal-item currently returns a single `<div>` (no wrapping fragment). Wrap the return in `<>...</>` to accommodate the context menu.

#### `src/components/tree-menu/pull-request-item.tsx`

Same approach as terminal-item. PR-item currently has **no context menu**. Add one:

```tsx
import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuDivider,
} from "@/components/ui/context-menu";
import { ArrowRightLeft, CornerLeftUp } from "lucide-react";
import { useMoveToStore } from "./use-move-to";
import { updateVisualSettings } from "@/lib/visual-settings";

// Inside the component:
const contextMenu = useContextMenu();

// On the row div, add:
// onContextMenu={contextMenu.open}

// After the row div:
{contextMenu.show && (
  <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
    <ContextMenuItem
      icon={ArrowRightLeft}
      label="Move to..."
      onClick={() => {
        contextMenu.close();
        useMoveToStore.getState().openMoveDialog(item);
      }}
    />
    {item.parentId && item.parentId !== item.worktreeId && (
      <ContextMenuItem
        icon={CornerLeftUp}
        label="Move to root"
        onClick={async () => {
          contextMenu.close();
          await updateVisualSettings("pull-request", item.id, {
            parentId: item.worktreeId,
            sortKey: undefined,
          });
        }}
      />
    )}
  </ContextMenu>
)}
```

Note: PR-item also returns a single `<div>`. Wrap in `<>...</>`.

### 6. `childrenMap` Construction for `validateDrop` in the Dialog

The `MoveToDialog` needs a `childrenMap` to pass to `validateDrop()`. Build it from the full tree data:

```typescript
function buildChildrenMap(allItems: TreeItemNode[]): Map<string, TreeItemNode[]> {
  const map = new Map<string, TreeItemNode[]>();
  for (const item of allItems) {
    // parentId comes from the tree builder (mirrors visualSettings.parentId)
    const parentKey = item.parentId ?? "root";
    const siblings = map.get(parentKey) ?? [];
    siblings.push(item);
    map.set(parentKey, siblings);
  }
  return map;
}
```

### 7. `getLastChildSortKey` Helper

Used when appending an item to the end of a target's children:

```typescript
function getLastChildSortKey(
  parentId: string,
  allItems: TreeItemNode[],
): string | null {
  // Find all items whose parentId matches, get the max sortKey
  const children = allItems.filter((i) => i.parentId === parentId);
  if (children.length === 0) return null;

  // Items with sortKeys are sorted lexicographically; items without are sorted by createdAt
  // We want to place after ALL existing children, so find the max sortKey if any exist
  const keyed = children
    .map((c) => c.sortKey)
    .filter((k): k is string => k !== undefined)
    .sort();

  return keyed.length > 0 ? keyed[keyed.length - 1] : null;
}
```

Note: `TreeItemNode` does not currently have a `sortKey` field in the type. The tree builder (03-unified-tree-model) sorts by `sortKey` internally but may not expose it on the rendered node. If not exposed, the dialog should read sortKeys from the entity stores directly, or the tree builder should pass `sortKey` through to `TreeItemNode`. If `sortKey` is not available on `TreeItemNode`, use `generateKeyBetween(null, null)` as a fallback (places at position "a0" which is fine for appending).

## Acceptance Criteria

- [x] "New folder" appears in worktree and folder context menus, creates folder via `folderService.create()`
- [x] "Move to..." opens a portal-based tree picker dialog showing the tree structure
- [x] Valid targets in the dialog are determined by `validateDrop()` from `src/lib/dnd-validation.ts`
- [x] Invalid targets are visually dimmed and not clickable, with tooltip showing the reason
- [x] "Move to..." calls `updateVisualSettings()` with new `parentId` and generated `sortKey`
- [x] "Move to..." respects worktree boundary constraints (items cannot move across worktrees)
- [x] "Move to root" sets `parentId` to `worktreeId` and clears `sortKey`, via `updateVisualSettings()`
- [x] "Move to root" only appears when `item.parentId !== item.worktreeId`
- [x] Context menus on terminal-item and pull-request-item are added (they currently have none)
- [x] All moves persist `visualSettings` to disk via the `updateVisualSettings()` dispatcher
- [x] Dialog closes on Escape, backdrop click, or successful move
- [x] `MoveToDialog` is mounted once in `tree-menu.tsx` (not per-item)

## Phases

- [x] Create `src/components/tree-menu/use-move-to.ts` (Zustand store for dialog state)
- [x] Create `src/components/tree-menu/move-to-dialog.tsx` (portal dialog with tree picker, validates via `validateDrop`, moves via `updateVisualSettings`)
- [x] Mount `<MoveToDialog />` in `src/components/tree-menu/tree-menu.tsx`
- [x] Add "New folder" to `worktree-item.tsx` and `folder-item.tsx` context menus
- [x] Add "Move to..." and "Move to root" to `thread-item.tsx` and `plan-item.tsx` context menus
- [x] Add context menu with "Move to..." and "Move to root" to `terminal-item.tsx` (currently has no context menu)
- [x] Add context menu with "Move to..." and "Move to root" to `pull-request-item.tsx` (currently has no context menu)
- [x] Verify all moves persist to disk and tree re-renders correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
