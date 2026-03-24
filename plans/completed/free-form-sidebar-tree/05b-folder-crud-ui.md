# 05b — Folder CRUD UI

**Layer 4 — parallel with 05a. Depends on 04a.**

## Summary

Add UI for creating, renaming, deleting folders, and picking Lucide icons. Folders are the primary user-created organizational primitive in the new tree. This plan modifies the `FolderItem` component from 04a to support inline rename and context menus, creates a new icon picker popover, and adds a tree-menu-level store for managing inline rename mode state.

## Dependencies

- **02b-folder-entity** — `useFolderStore` (at `src/entities/folders/store.ts`), folder service (at `src/entities/folders/service.ts`) exist with CRUD + disk persistence at `~/.anvil/folders/{id}/metadata.json`
- **04a-rendering-components** — `FolderItem` component exists at `src/components/tree-menu/folder-item.tsx`, tree renders folders via type dispatch in `TreeMenu`
- **04b-cascade-archive** — cascade archive logic exists (used when deleting non-empty folders)

## Key Files

| File | Change |
|------|--------|
| `src/components/tree-menu/folder-item.tsx` | **Modify** — add inline rename mode, context menu with all folder actions |
| `src/components/tree-menu/icon-picker.tsx` | **New** — Lucide icon picker popover component |
| `src/components/tree-menu/use-inline-rename.ts` | **New** — shared hook for inline rename state management |
| `src/components/tree-menu/folder-actions.ts` | **New** — `createFolderAndRename()` helper |
| `src/entities/folders/service.ts` | **Verify** — already has CRUD from 02b; no changes expected |
| `src/stores/tree-menu/store.ts` | **Modify** — add `renamingNodeId` state for coordinating inline rename |
| `src/stores/tree-menu/service.ts` | **Modify** — add `startRename(nodeId)` and `stopRename()` methods |

## Implementation

### 1. Tree Menu Rename State (`src/stores/tree-menu/store.ts`)

Add rename coordination state to the tree menu store. This tracks which node is currently being renamed so that only one node can be in rename mode at a time, and the `FolderItem` component can check this to render an input instead of a label.

**Add to `TreeMenuState` interface:**

```typescript
/** ID of the node currently in inline rename mode, or null */
renamingNodeId: string | null;
```

**Add to initial state:**

```typescript
renamingNodeId: null,
```

**Add to `TreeMenuActions` interface:**

```typescript
_applySetRenaming: (nodeId: string | null) => Rollback;
```

**Add implementation:**

```typescript
_applySetRenaming: (nodeId: string | null): Rollback => {
  const prev = get().renamingNodeId;
  set({ renamingNodeId: nodeId });
  return () => set({ renamingNodeId: prev });
},
```

Note: `renamingNodeId` is **not persisted** to `~/.anvil/ui/tree-menu.json` — it is ephemeral UI state. Do not add it to `TreeMenuPersistedState` or `TreeMenuPersistedStateSchema`.

### 2. Tree Menu Rename Service Methods (`src/stores/tree-menu/service.ts`)

Add two methods to `treeMenuService`:

```typescript
/**
 * Starts inline rename mode for a node.
 * Only one node can be renaming at a time.
 */
startRename(nodeId: string): void {
  useTreeMenuStore.getState()._applySetRenaming(nodeId);
},

/**
 * Stops inline rename mode.
 */
stopRename(): void {
  useTreeMenuStore.getState()._applySetRenaming(null);
},
```

These are synchronous — no disk write needed since rename state is ephemeral.

### 3. `useInlineRename` Hook (`src/components/tree-menu/use-inline-rename.ts`)

**New file.** A shared React hook that encapsulates inline rename behavior. Follows the same UX pattern as the existing worktree rename in `repo-worktree-section.tsx` (lines 272-321).

```typescript
import { useState, useRef, useEffect, useCallback } from "react";
import { treeMenuService } from "@/stores/tree-menu/service";

interface UseInlineRenameOptions {
  /** Current name of the item */
  currentName: string;
  /** Called with the new name when rename is confirmed */
  onRename: (newName: string) => Promise<void>;
  /** Validation function — return error message or null if valid */
  validate?: (name: string) => string | null;
}

interface UseInlineRenameReturn {
  /** Whether rename mode is active */
  isRenaming: boolean;
  /** Current value in the rename input */
  renameValue: string;
  /** Ref to attach to the input element */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Start rename mode */
  startRename: () => void;
  /** Handle input value changes */
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Handle blur (submit) */
  handleBlur: () => void;
  /** Handle keydown (Enter to submit, Escape to cancel) */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}
```

**Behavior:**
- `startRename()` — sets local `isRenaming` to true, calls `treeMenuService.startRename(nodeId)`, initializes `renameValue` to `currentName`
- On mount of the input (via `useEffect` watching `isRenaming`): focus the input and select all text
- **Enter** — trim value, run `validate()`, if valid call `onRename(trimmed)`, then `treeMenuService.stopRename()` and set `isRenaming` to false
- **Escape** — reset `renameValue` to `currentName`, call `treeMenuService.stopRename()`, set `isRenaming` to false
- **Blur** — same as Enter (submit on blur), matching the existing worktree rename behavior at `repo-worktree-section.tsx` line 278
- Default validation: non-empty after trim. No character restrictions (folders are user-facing labels, not filesystem paths)

### 4. Create Folder Helper (`src/components/tree-menu/folder-actions.ts`)

**New file.** Shared helper invoked by context menu actions (wired in 05c) and potentially by keyboard shortcuts.

```typescript
import { folderService } from "@/entities/folders/service";
import { treeMenuService } from "@/stores/tree-menu/service";

/**
 * Creates a new folder as a child of the given parent and enters rename mode.
 * Called from "New folder" context menu action on worktree and folder items.
 *
 * @param parentId - ID of the parent node (worktree ID or folder ID)
 * @param worktreeId - Worktree ID for boundary enforcement (optional for root-level folders)
 */
export async function createFolderAndRename(
  parentId: string,
  worktreeId?: string,
): Promise<void> {
  const folder = await folderService.create({
    name: "New Folder",
    icon: "folder",
    worktreeId,
    parentId,
  });

  // Expand the parent so the new folder is visible
  await treeMenuService.expandSection(parentId);

  // Enter rename mode on the newly created folder
  treeMenuService.startRename(folder.id);
}
```

The `FolderItem` component detects that `renamingNodeId === item.id` from the tree menu store and renders the inline rename input instead of the folder name label.

**Determining `worktreeId`:** The `TreeItemNode` for the parent (worktree or folder) carries `worktreeId`. Pass it through from the context menu handler.

### 5. `FolderItem` Component Modifications (`src/components/tree-menu/folder-item.tsx`)

The base `FolderItem` component is created in 04a. This plan modifies it to add inline rename, context menu, and icon picker.

**Imports to add:**

```typescript
import { useCallback, useState, useEffect } from "react";
import {
  Folder, Pencil, Trash2, Palette, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuItemDanger,
  ContextMenuDivider,
} from "@/components/ui/context-menu";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { folderService } from "@/entities/folders/service";
import { useInlineRename } from "./use-inline-rename";
import { IconPicker, LUCIDE_ICON_MAP } from "./icon-picker";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
```

**Inline rename integration:**

Read `renamingNodeId` from the tree menu store:

```typescript
const renamingNodeId = useTreeMenuStore((s) => s.renamingNodeId);
const isRenamingFromStore = renamingNodeId === item.id;
```

Use the `useInlineRename` hook:

```typescript
const rename = useInlineRename({
  currentName: item.title,
  onRename: async (newName) => {
    await folderService.rename(item.id, newName);
  },
});
```

When `isRenamingFromStore` is true (e.g., after `createFolderAndRename` calls `startRename`), automatically trigger the hook's rename:

```typescript
useEffect(() => {
  if (isRenamingFromStore && !rename.isRenaming) {
    rename.startRename();
  }
}, [isRenamingFromStore]);
```

**Render inline rename input in place of the folder name span:**

```tsx
{rename.isRenaming ? (
  <input
    ref={rename.inputRef}
    type="text"
    value={rename.renameValue}
    onChange={rename.handleChange}
    onBlur={rename.handleBlur}
    onKeyDown={rename.handleKeyDown}
    className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-full min-w-[60px]"
    onClick={(e) => e.stopPropagation()}
  />
) : (
  <span className="truncate flex-1" title={item.title}>
    {item.title}
  </span>
)}
```

This matches the inline rename input styling from `repo-worktree-section.tsx` line 406-413.

**Double-click to rename:**

```typescript
const handleDoubleClick = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  rename.startRename();
}, [rename]);
```

Add `onDoubleClick={handleDoubleClick}` to the row div.

**F2 to rename:** Add to the existing `handleKeyDown` callback:

```typescript
case "F2":
  e.preventDefault();
  rename.startRename();
  break;
```

**Dynamic icon rendering:**

The `FolderItem` must render the icon stored in `item.icon` (a Lucide icon name string from `FolderMetadata`). Use the `LUCIDE_ICON_MAP` from the icon picker module to resolve the string to a component:

```tsx
const IconComponent = LUCIDE_ICON_MAP[item.icon ?? "folder"] ?? Folder;
// Render:
<IconComponent size={12} className="flex-shrink-0 text-surface-400" />
```

**Context menu:**

Use the `useContextMenu` hook from `@/components/ui/context-menu` (same pattern as `plan-item.tsx` line 100 and `thread-item.tsx` line 74):

```typescript
const contextMenu = useContextMenu();
```

Context menu structure for folders:

```tsx
{contextMenu.show && (
  <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
    {confirmingDelete ? (
      <>
        <div className="px-2.5 py-1 text-[11px] text-surface-400">
          Delete this folder and all contents?
        </div>
        <ContextMenuItemDanger
          icon={Trash2}
          label="Confirm delete"
          onClick={handleConfirmDelete}
        />
        <ContextMenuItem
          icon={ChevronRight}
          label="Cancel"
          onClick={() => setConfirmingDelete(false)}
        />
      </>
    ) : (
      <>
        <ContextMenuItem
          icon={Pencil}
          label="Rename"
          onClick={() => {
            contextMenu.close();
            rename.startRename();
          }}
        />
        <ContextMenuItem
          icon={Palette}
          label="Change icon"
          onClick={() => {
            contextMenu.close();
            handleOpenIconPicker();
          }}
        />
        <ContextMenuDivider />
        <ContextMenuItemDanger
          icon={Trash2}
          label={item.isFolder ? "Delete folder and contents" : "Delete folder"}
          onClick={handleDeleteClick}
        />
      </>
    )}
  </ContextMenu>
)}
```

Note: "New folder" and "Move to..." context menu items are added in 05c. This plan only adds folder-specific CRUD actions (Rename, Change icon, Delete).

This two-click confirmation pattern matches `plan-item.tsx` lines 341-356.

**Delete handler:**

```typescript
const [confirmingDelete, setConfirmingDelete] = useState(false);

const handleDeleteClick = useCallback(() => {
  if (item.isFolder) {
    // Has children — require confirmation
    setConfirmingDelete(true);
  } else {
    // Empty folder — delete immediately
    folderService.delete(item.id);
    contextMenu.close();
  }
}, [item.id, item.isFolder, contextMenu]);

const handleConfirmDelete = useCallback(async () => {
  await folderService.delete(item.id);
  setConfirmingDelete(false);
  contextMenu.close();
}, [item.id, contextMenu]);
```

### 6. Delete Folder — Cascade Behavior

When deleting a folder that has children:

1. Show confirmation in context menu (two-click pattern)
2. On confirm, call `folderService.delete(id)` which:
   - Cascade-archives all visual descendants first (uses cascade archive from 04b)
   - Then removes the folder metadata from `~/.anvil/folders/{id}/metadata.json`

The `folderService.delete()` method in `src/entities/folders/service.ts` (from 02b) should call the cascade archive function before removing the folder. The exact wiring depends on 04b's API. If 04b exports a `cascadeArchive(nodeId: string)` function, the folder service `delete` calls it. Otherwise, the folder service walks the tree builder's children map to find descendants and archives each through their respective services.

### 7. Icon Picker Popover (`src/components/tree-menu/icon-picker.tsx`)

**New file.** A small floating popover showing a curated 4x4 grid of 16 Lucide icons.

```typescript
import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Folder, FolderOpen, Bug, Zap, Star, Bookmark,
  Flag, Tag, Archive, Box, Layers, LayoutGrid,
  Code, Wrench, Shield, Heart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Map of icon name strings to Lucide components.
 *  Used by FolderItem to resolve icon names from FolderMetadata.icon field. */
export const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  "folder": Folder,
  "folder-open": FolderOpen,
  "bug": Bug,
  "zap": Zap,
  "star": Star,
  "bookmark": Bookmark,
  "flag": Flag,
  "tag": Tag,
  "archive": Archive,
  "box": Box,
  "layers": Layers,
  "layout-grid": LayoutGrid,
  "code": Code,
  "wrench": Wrench,
  "shield": Shield,
  "heart": Heart,
};

/** Ordered list of icon names for display in the picker grid. */
export const ICON_OPTIONS = Object.keys(LUCIDE_ICON_MAP);
```

**Styling:**
- Uses `createPortal` to render to `document.body`, escaping overflow containers (same as `ContextMenu` at `src/components/ui/context-menu.tsx` line 64)
- 4-column grid (`grid grid-cols-4 gap-1`): 16 icons / 4 cols = 4 rows. Compact.
- Selected icon gets `bg-accent-500/20 text-accent-300`; others `text-surface-300`
- Container: `bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-2` (matches context menu styling)
- Close on click outside and Escape key (same pattern as `ContextMenu` component)
- Each icon button: 28x28px (`w-7 h-7`), icon at 14px

**`IconPicker` component props:**

```typescript
interface IconPickerProps {
  currentIcon: string;
  anchorPosition: { top: number; left: number };
  onSelect: (iconName: string) => void;
  onClose: () => void;
}
```

**Integration in `FolderItem`:**

```typescript
const [showIconPicker, setShowIconPicker] = useState(false);
const [iconPickerPosition, setIconPickerPosition] = useState({ top: 0, left: 0 });

// Open from context menu — position relative to the folder row
const handleOpenIconPicker = useCallback(() => {
  // Use the folder item row's bounding rect for positioning
  const row = document.querySelector(`[data-testid="folder-item-${item.id}"]`);
  if (row) {
    const rect = row.getBoundingClientRect();
    setIconPickerPosition({ top: rect.bottom + 4, left: rect.left + 16 });
  }
  setShowIconPicker(true);
}, [item.id]);

const handleIconSelect = useCallback(async (iconName: string) => {
  await folderService.updateIcon(item.id, iconName);
  setShowIconPicker(false);
}, [item.id]);
```

Render:

```tsx
{showIconPicker && (
  <IconPicker
    currentIcon={item.icon ?? "folder"}
    anchorPosition={iconPickerPosition}
    onSelect={handleIconSelect}
    onClose={() => setShowIconPicker(false)}
  />
)}
```

### 8. File Size Budget

The `FolderItem` component must stay under 250 lines (per coding conventions). Expected breakdown:
- Imports: ~20 lines
- Helper functions: ~10 lines
- Component body (hooks, handlers): ~80 lines
- JSX return: ~70 lines
- Context menu + icon picker rendering: ~50 lines
- **Total: ~230 lines** — within budget

If it exceeds 250 lines, extract the context menu JSX into a `FolderContextMenu` sub-component in a separate file `src/components/tree-menu/folder-context-menu.tsx`.

### 9. Folder Service Methods Referenced

These methods are defined in 02b (`src/entities/folders/service.ts`). This plan does **not** modify them but lists them for reference:

- `folderService.create(input: CreateFolderInput): Promise<FolderMetadata>` — generates `crypto.randomUUID()`, writes `~/.anvil/folders/{id}/metadata.json`, upserts into `useFolderStore`
- `folderService.rename(id: string, name: string): Promise<void>` — read-patch-write on metadata.json, updates store
- `folderService.updateIcon(id: string, icon: string): Promise<void>` — read-patch-write on metadata.json, updates store
- `folderService.delete(id: string): Promise<void>` — removes from store and disk, cascade-archives children via 04b
- `folderService.updateVisualSettings(id: string, patch: Partial<VisualSettings>): Promise<void>` — called by DnD (05a)

All follow the optimistic update pattern using `Rollback` from `@/lib/optimistic`, matching `planService` (`src/entities/plans/service.ts`) and `threadService` (`src/entities/threads/service.ts`).

## Acceptance Criteria

- [x] Tree menu store has `renamingNodeId` ephemeral state (not persisted to disk)
- [x] `treeMenuService.startRename(nodeId)` and `treeMenuService.stopRename()` exist
- [x] `useInlineRename` hook exists at `src/components/tree-menu/use-inline-rename.ts`
- [x] `createFolderAndRename()` helper exists at `src/components/tree-menu/folder-actions.ts`
- [x] `FolderItem` renders inline rename input when `renamingNodeId` matches item ID
- [x] Double-click on folder name enters rename mode
- [x] F2 key enters rename mode when folder is focused
- [x] Enter submits rename, Escape cancels, blur submits
- [x] Delete empty folder works immediately (single click)
- [x] Delete non-empty folder shows two-click confirmation
- [x] `IconPicker` component renders a 4x4 grid of 16 Lucide icons in a portal popover
- [x] Selecting an icon calls `folderService.updateIcon()` and persists to disk
- [x] `LUCIDE_ICON_MAP` is exported from `icon-picker.tsx` and used by `FolderItem` for dynamic icon rendering
- [x] All new files and modified files stay under 250 lines

## Phases

- [x] Add `renamingNodeId` state to `src/stores/tree-menu/store.ts` and `startRename`/`stopRename` methods to `src/stores/tree-menu/service.ts`
- [x] Create `useInlineRename` hook at `src/components/tree-menu/use-inline-rename.ts`
- [x] Create `IconPicker` component with `LUCIDE_ICON_MAP` at `src/components/tree-menu/icon-picker.tsx`
- [x] Create `createFolderAndRename()` helper at `src/components/tree-menu/folder-actions.ts`
- [x] Modify `FolderItem` at `src/components/tree-menu/folder-item.tsx` — add inline rename, context menu (Rename, Change icon, Delete), icon picker integration, double-click and F2 handlers

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
