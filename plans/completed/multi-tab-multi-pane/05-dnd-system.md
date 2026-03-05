# 05 — DnD System

**Wave 3 (parallel with 04-navigation-wiring)** — Depends on 01-foundation-store, 02-split-layout-renderer, 03-tab-system.

## Goal

Add drag-and-drop for tab reordering within groups, moving tabs between groups, and drag-to-split (drop on pane edges to create new split).

## Context

**Library**: `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0` — already installed, used for quick-action sorting.

**Architecture**: Single `DndContext` wrapping `SplitLayoutContainer`. dnd-kit handles tab reorder/cross-container. Custom overlay handles edge drop zones for drag-to-split.

## Files to Create/Modify

```
src/components/split-layout/
├── split-layout-container.tsx  — MODIFY: wrap in DndContext with shared sensors + collision detection
├── tab-bar.tsx                 — MODIFY: make sortable container (SortableContext)
├── tab-item.tsx                — MODIFY: make draggable (useSortable)
├── drop-zone-overlay.tsx       — NEW: visual overlay for split drop targets during drag
└── use-tab-dnd.ts              — NEW: hook encapsulating DnD logic + handlers
```

## DnD Architecture

### Single DndContext

The `SplitLayoutContainer` wraps everything in a single `DndContext`:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  <SplitNodeRenderer node={root} path={[]} />
  <DragOverlay>
    {activeDrag ? <TabItemDragPreview tab={activeDrag.tab} /> : null}
  </DragOverlay>
</DndContext>
```

### Sensors

```typescript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5, // 5px drag threshold to distinguish from click
    },
  })
);
```

### Tab Reordering (within group)

Each `TabBar` is a `SortableContext` with the tab IDs as items. Each `TabItem` uses `useSortable`.

**Data format** for drag items:
```typescript
interface TabDragData {
  type: "tab";
  tabId: string;
  groupId: string;
  view: ContentPaneView;
}
```

On `onDragEnd`:
- If source and target are in the same `SortableContext` (same group): call `paneLayoutService.reorderTabs(groupId, newOrder)`
- If moved to a different group's `SortableContext`: call `paneLayoutService.moveTab(fromGroup, tabId, toGroup, index)`

### Cross-Group Tab Move

Each `TabBar` accepts drops from other groups. The `SortableContext` items include both the group's own tabs and a "drop here" indicator.

When a tab is dragged over a different group's tab bar:
- Show insertion indicator between tabs
- On drop: `paneLayoutService.moveTab(fromGroupId, tabId, toGroupId, insertIndex)`

### Drop Zone Overlay for Drag-to-Split (`drop-zone-overlay.tsx`)

When a tab drag is active, each `PaneGroup` shows directional drop zones on its edges.

**NOT** using dnd-kit's collision detection for this — it's a custom mouse-position overlay.

```
┌──────────────────────┐
│        TOP           │  → split vertical, new group above
├──────────────────────┤
│    │         │       │
│LEFT│ CENTER  │ RIGHT │  → LEFT/RIGHT: split horizontal
│    │         │       │  → CENTER: add to this group (handled by SortableContext)
├──────────────────────┤
│       BOTTOM         │  → split vertical, new group below
└──────────────────────┘
```

**Implementation**:
- Each `PaneGroup` renders a transparent overlay div when a drag is active
- Track mouse position relative to the group's bounds
- If within ~30px of an edge, highlight that drop zone
- On drop in an edge zone: call `paneLayoutService.splitGroup(groupId, direction)` and move the tab to the new group
- Center zone: handled by normal dnd-kit drop (add to group)
- Respect split constraints (max 4 wide, 3 high) — if at limit, don't show the zone

**Visual feedback**:
- Highlighted zone: semi-transparent accent color overlay with directional icon
- Only show zones when drag is active (track via DndContext's `active` state)

### Drag Preview

Custom `DragOverlay` showing a minimal tab preview:
- Tab label + status dot
- Semi-transparent background
- Slightly smaller than actual tab

## State Flow

```
User drags tab
  → PointerSensor fires onDragStart
  → Set active drag state (tab + source group)
  → Show DragOverlay + enable drop zone overlays
  →
  → [If dropped on tab bar]: onDragEnd fires
  →   Same group? → reorderTabs
  →   Different group? → moveTab
  →
  → [If dropped on edge zone]: custom handler
  →   Check constraints (canSplitHorizontal/Vertical)
  →   splitGroup(targetGroupId, direction)
  →   moveTab(sourceGroupId, tabId, newGroupId, 0)
  →
  → [If dropped outside]: cancel (no-op)
```

## Phases

- [x] Create `use-tab-dnd.ts` hook with DndContext setup, sensors, and drag state
- [x] Make `TabItem` draggable with `useSortable` and `TabBar` a `SortableContext`
- [x] Implement within-group tab reordering on drag end
- [x] Implement cross-group tab moves (drop on different group's tab bar)
- [x] Create `drop-zone-overlay.tsx` with edge detection (~30px) and visual feedback
- [x] Wire drop zone overlay to `splitGroup` + `moveTab` on drop, respecting constraints
- [x] Add drag preview overlay
- [x] Write tests for DnD handlers (reorder, cross-move, split-on-drop)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
