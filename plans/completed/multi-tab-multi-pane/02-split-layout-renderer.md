# 02 — Split Layout Renderer

**Wave 2 (parallel with 03-tab-system)** — Depends on 01-foundation-store.

## Goal

Build the recursive split layout rendering system that replaces `ContentPaneContainer`. Renders the `SplitNode` tree as nested flex containers with resize handles between split children.

## Context

**Replaces**: `src/components/content-pane/content-pane-container.tsx`

**Existing patterns**:
- `ResizablePanel` (`src/components/ui/resizable-panel.tsx`) — Used for left/right sidebar panels. The split resize handles follow a similar drag pattern but are internal to the center content area.
- `ContentPaneContainer` — Currently renders a single active pane. We replace it with `SplitLayoutContainer` that renders the full recursive tree.

**Important**: This sub-plan focuses on rendering the split tree and resize handles. It does NOT build the tab bar or individual tab components (that's 03-tab-system). The leaf renderer should render a placeholder or delegate to `PaneGroup` from 03-tab-system once both are merged.

## Files to Create

```
src/components/split-layout/
├── split-layout-container.tsx  — Root component, reads pane-layout store, wraps in DndContext
├── split-node-renderer.tsx     — Recursive renderer: leaf → PaneGroup, split → nested flex
├── split-resize-handle.tsx     — Drag handle between split children (vertical or horizontal)
└── types.ts                    — Component-level types (props interfaces)
```

## Component Design

### SplitLayoutContainer (`split-layout-container.tsx`)

Root component that replaces `ContentPaneContainer` in `MainWindowLayout`.

```tsx
export function SplitLayoutContainer() {
  const root = usePaneLayoutStore(s => s.root);
  const hydrated = usePaneLayoutStore(s => s._hydrated);

  if (!hydrated) return null; // or skeleton

  return (
    <div className="flex-1 min-w-0 bg-surface-900">
      <SplitNodeRenderer node={root} path={[]} />
    </div>
  );
}
```

- Reads the root `SplitNode` from the pane-layout store
- Wraps everything in the DnD context (for future tab DnD in 05-dnd-system)
- Handles the "not hydrated" state gracefully

### SplitNodeRenderer (`split-node-renderer.tsx`)

Recursive component that renders a `SplitNode`:

**Leaf node** (`type: "leaf"`):
- Look up the `PaneGroup` by `groupId` from the store
- Render the `PaneGroup` component (from 03-tab-system)
- Initially can render a simple placeholder div that shows the group ID

**Split node** (`type: "split"`):
- Render a flex container with `flex-direction` based on `direction`:
  - `horizontal` → `flex-row` (children side by side)
  - `vertical` → `flex-col` (children stacked)
- Each child gets a flex basis from `sizes[i]%`
- Between each pair of children, render a `SplitResizeHandle`
- Recurse into each child

```tsx
function SplitNodeRenderer({ node, path }: { node: SplitNode; path: number[] }) {
  if (node.type === "leaf") {
    return <PaneGroupContainer groupId={node.groupId} />;
  }

  const isHorizontal = node.direction === "horizontal";

  return (
    <div className={cn("flex", isHorizontal ? "flex-row" : "flex-col", "w-full h-full")}>
      {node.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <SplitResizeHandle
              direction={node.direction}
              path={path}
              index={i}
              sizes={node.sizes}
            />
          )}
          <div style={{ flexBasis: `${node.sizes[i]}%` }} className="min-w-0 min-h-0 overflow-hidden">
            <SplitNodeRenderer node={child} path={[...path, i]} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
```

### SplitResizeHandle (`split-resize-handle.tsx`)

A draggable divider between split children.

**Props**: `direction`, `path`, `index`, `sizes` (current sizes array)

**Behavior**:
- For horizontal splits: renders as a thin vertical bar (4px wide, full height), cursor `col-resize`
- For vertical splits: renders as a thin horizontal bar (full width, 4px tall), cursor `row-resize`
- On drag start: capture initial mouse position and initial sizes
- On mouse move: calculate delta as percentage of parent container, adjust `sizes[index-1]` and `sizes[index]` accordingly
- On mouse up: call `paneLayoutService.updateSplitSizes(path, newSizes)`
- Enforce minimum size per child (~15%)
- Double-click: reset all children to equal sizes

**Styling**:
- Default: `bg-surface-700` (subtle divider)
- Hover: `bg-accent-500` (highlight)
- Dragging: `bg-accent-400` (active)

## Integration Point

In `main-window-layout.tsx`, replace:
```tsx
<ContentPaneContainer />
```
with:
```tsx
<SplitLayoutContainer />
```

The store initialization in `MainWindowLayout` should call `paneLayoutService.hydrate()` instead of `contentPanesService.hydrate()`.

## Phases

- [x] Create `SplitLayoutContainer` as root component reading from pane-layout store
- [x] Create `SplitNodeRenderer` with recursive leaf/split rendering
- [x] Create `SplitResizeHandle` with drag-to-resize and min-size constraints
- [x] Wire `SplitLayoutContainer` into `MainWindowLayout` replacing `ContentPaneContainer`
- [x] Write tests for split node rendering (leaf, horizontal split, vertical split, nested)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
