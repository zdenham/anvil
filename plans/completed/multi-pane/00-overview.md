# Multi-Pane Layout - Overview

## Summary

Implement a VS Code-like draggable multi-pane system that allows users to split the content area into multiple resizable panes, each displaying different content (threads, plans, settings, logs).

## Current State

- **Single pane**: `ContentPaneContainer` renders only the active pane
- **Future-proofed store**: `content-panes/store.ts` already uses `Record<string, ContentPaneData>` supporting multiple panes
- **Resizable panels**: `ResizablePanel` component exists for drag-based width resizing
- **@dnd-kit installed**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` already in dependencies
- **Per-pane UUID tracking**: Each pane has a unique ID, view state, and independent lifecycle
- **Layout persistence**: `~/.anvil/ui/layout.json` stores panel widths via Zod-validated schema

## Design Goals

1. **Split panes horizontally and vertically** - Like VS Code, users can split the editor area
2. **Drag to resize** - Pane dividers are draggable to adjust relative sizes
3. **Drag tabs to reorder/move** - Drag a pane's tab to another pane group or create a new split
4. **Persist layout** - Remember pane arrangement and sizes across app restarts
5. **Keyboard navigation** - Support Cmd+1/2/3 to switch between panes

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MainWindowLayout                              │
│  ┌──────────────┬──────────────────────────────────────────────────────┤
│  │              │                                                      │
│  │  TreeMenu    │              PaneContainer                           │
│  │  (ResizablePanel)           (Multi-pane area)                       │
│  │              │                                                      │
│  │              │   ┌─────────────────┬─────────────────────────┐      │
│  │              │   │                 │                         │      │
│  │              │   │   PaneGroup     │      PaneGroup          │      │
│  │              │   │   (vertical)    │      (vertical)         │      │
│  │              │   │                 │                         │      │
│  │              │   │  ┌───────────┐  │  ┌───────────────────┐  │      │
│  │              │   │  │ TabBar    │  │  │ TabBar            │  │      │
│  │              │   │  ├───────────┤  │  ├───────────────────┤  │      │
│  │              │   │  │           │  │  │                   │  │      │
│  │              │   │  │ ContentPane│ │  │ ContentPane       │  │      │
│  │              │   │  │ (thread)  │  │  │ (plan)            │  │      │
│  │              │   │  │           │  │  │                   │  │      │
│  │              │   │  └───────────┘  │  └───────────────────┘  │      │
│  │              │   │                 │                         │      │
│  │              │   └─────────────────┴─────────────────────────┘      │
│  │              │                                                      │
│  └──────────────┴──────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### PaneLayout (Tree Structure)

```typescript
// Represents a node in the layout tree
type PaneLayoutNode =
  | { type: "pane"; paneId: string }                    // Leaf: single pane
  | { type: "split"; direction: "horizontal" | "vertical"; children: PaneLayoutNode[]; sizes: number[] };

// Root of the layout
interface PaneLayout {
  root: PaneLayoutNode;
}
```

### Extended ContentPanesState

```typescript
interface ContentPanesState {
  panes: Record<string, ContentPaneData>;      // Existing
  activePaneId: string | null;                   // Existing
  layout: PaneLayout;                            // NEW: Tree describing arrangement
  _hydrated: boolean;
}
```

### PaneGroup State

```typescript
interface PaneGroupData {
  id: string;
  paneIds: string[];           // Tabs in this group (ordered)
  activePaneId: string;        // Which tab is active in this group
}
```

## File Structure

```
src/
├── components/
│   ├── pane-layout/
│   │   ├── index.ts
│   │   ├── pane-container.tsx         # Root container, renders layout tree
│   │   ├── pane-split.tsx             # Renders horizontal/vertical split with resizer
│   │   ├── pane-group.tsx             # Single pane group with tabs
│   │   ├── pane-tab-bar.tsx           # Draggable tabs header
│   │   ├── pane-tab.tsx               # Individual tab (draggable)
│   │   ├── pane-resizer.tsx           # Drag handle between panes
│   │   ├── pane-drop-zone.tsx         # Drop targets for creating splits
│   │   └── types.ts                   # Layout types
│   └── content-pane/                  # Existing - reused for pane content
├── stores/
│   ├── pane-layout/
│   │   ├── store.ts                   # Layout tree state
│   │   ├── service.ts                 # Layout mutations + persistence
│   │   ├── types.ts                   # Zod schemas
│   │   └── index.ts
│   └── content-panes/                 # Existing - extended for multi-pane
└── hooks/
    ├── use-pane-layout.ts             # Layout tree traversal utilities
    └── use-pane-dnd.ts                # DnD context and handlers
```

## Sub-Plans

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [01-data-model.md](./01-data-model.md) | Layout tree types, Zod schemas, store extension | None |
| [02-pane-layout-store.md](./02-pane-layout-store.md) | New store for layout tree + persistence | 01 |
| [03-pane-container.md](./03-pane-container.md) | Root container rendering layout tree | 01, 02 |
| [04-pane-split.md](./04-pane-split.md) | Split component with resizable children | 03 |
| [05-pane-group.md](./05-pane-group.md) | Tab group with draggable tabs | 03, 04 |
| [06-drag-and-drop.md](./06-drag-and-drop.md) | @dnd-kit integration for tab/pane dragging | 05 |
| [07-keyboard-shortcuts.md](./07-keyboard-shortcuts.md) | Cmd+1/2/3, split commands | 06 |
| [08-integration.md](./08-integration.md) | Replace ContentPaneContainer, update nav service | 07 |

## Implementation Order

1. **01-data-model.md** - Define types and schemas
2. **02-pane-layout-store.md** - Create store with basic operations
3. **03-pane-container.md** - Render single pane (backwards compatible)
4. **04-pane-split.md** - Add split rendering with resizers
5. **05-pane-group.md** - Add tab groups
6. **06-drag-and-drop.md** - Enable drag reordering and splitting
7. **07-keyboard-shortcuts.md** - Add keyboard commands
8. **08-integration.md** - Wire into main layout, update navigation

## Key Design Decisions

### 1. Layout Tree vs Flat List

**Decision**: Use a tree structure (`PaneLayoutNode`) rather than a flat list with grid coordinates.

**Rationale**:
- Matches VS Code's mental model (split a pane → create a branch)
- Natural representation for recursive rendering
- Easier to serialize/persist
- Simpler resize logic (siblings only affect each other)

### 2. Separate Layout Store vs Extend content-panes

**Decision**: Create a new `pane-layout` store for the tree, keep `content-panes` for pane content.

**Rationale**:
- Separation of concerns: layout (how panes are arranged) vs content (what each pane shows)
- Allows independent hydration and persistence
- `content-panes` can remain stable while layout changes

### 3. DnD Library

**Decision**: Use `@dnd-kit` (already installed).

**Rationale**:
- Already in dependencies
- Excellent React integration
- Supports complex drag scenarios (tab reordering, cross-group moves, edge drops)
- Accessible by default

### 4. Resize Strategy

**Decision**: Flex-based with percentage sizes stored in layout tree.

**Rationale**:
- `sizes: number[]` array in split nodes (percentages summing to 100)
- CSS flexbox with `flex-basis` for rendering
- Same pattern as VS Code
- Responsive to window resize

### 5. Persistence

**Decision**: Persist to `~/.anvil/ui/pane-layout.json` (separate from existing files).

**Rationale**:
- Clear separation from `layout.json` (tree panel width) and `content-panes.json`
- Zod validation at boundary
- Can be reset independently

## Migration Strategy

### Phase 1: Backwards Compatible

- `PaneContainer` renders existing single-pane layout
- No UI changes visible to user
- Layout tree defaults to single pane

### Phase 2: Enable Splitting

- Add "Split Right" / "Split Down" buttons to pane header
- Add keyboard shortcuts (Cmd+\)
- Tree opens in split view by default when clicking while holding Alt

### Phase 3: Full DnD

- Draggable tabs
- Drop zones for creating new splits
- Tab reordering within groups

## Dependencies

- `@dnd-kit/core` - Already installed
- `@dnd-kit/sortable` - Already installed
- `@dnd-kit/utilities` - Already installed
- No new dependencies required

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Complex layout state | Extensive unit tests for tree operations |
| DnD edge cases | Start with tab reordering only, add splitting later |
| Performance with many panes | Virtualize if needed; most users have <5 panes |
| Layout corruption | Zod validation + recovery to single-pane default |

## Success Criteria

1. Users can split panes horizontally and vertically
2. Pane dividers are draggable with smooth resize
3. Tabs can be dragged between pane groups
4. Layout persists across app restarts
5. Keyboard shortcuts work (Cmd+1/2/3, Cmd+\)
6. No regression in single-pane usage
