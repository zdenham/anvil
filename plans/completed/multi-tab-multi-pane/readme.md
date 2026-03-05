# Multi-Tab & Multi-Pane Support

## Overview

VS Code-style multi-tab and multi-pane support: tabs within pane groups, Cmd+Click to open in new tab, draggable split layouts (up to 4 wide, 3 high), recursively stackable.

See the [original design doc](../multi-tab-multi-pane.md) for full architecture, state shapes, edge cases, and interaction design.

## Sub-Plans (Execution Order)

### Wave 1 — Foundation (sequential, blocks everything)

| Sub-Plan | Description |
|----------|-------------|
| [01-foundation-store](./01-foundation-store.md) | Pane layout store, service, types, Zod schemas, persistence, default state |

### Wave 2 — Layout + Tabs (parallel)

| Sub-Plan | Description |
|----------|-------------|
| [02-split-layout-renderer](./02-split-layout-renderer.md) | SplitLayoutContainer, SplitNodeRenderer, split resize handles |
| [03-tab-system](./03-tab-system.md) | PaneGroup, TabBar, TabItem, labels, status dots, close behavior -- **DONE** |

### Wave 3 — Wiring + Interaction (parallel)

| Sub-Plan | Description |
|----------|-------------|
| [04-navigation-wiring](./04-navigation-wiring.md) | Navigation service refactor, Cmd+Click, find-and-focus dedup, tree selection sync -- **DONE** |
| [05-dnd-system](./05-dnd-system.md) | Tab reordering (dnd-kit), cross-group moves, drop zone overlay, drag-to-split -- **DONE** |

### Wave 4 — Polish (sequential, needs everything)

| Sub-Plan | Description |
|----------|-------------|
| [06-edge-cases-polish](./06-edge-cases-polish.md) | Split depth constraints, archive events, max 5 tabs, visible thread updates, persistence verification |

## Dependency Graph

```
Wave 1:  [01-foundation-store]
              │
         ┌────┴────┐
Wave 2:  [02-split] [03-tabs]      ← parallel
         └────┬────┘
         ┌────┴────┐
Wave 3:  [04-nav]  [05-dnd]        ← parallel
         └────┬────┘
Wave 4:  [06-edge-cases-polish]
```

## Phases

- [x] Wave 1: Foundation store, service, types
- [x] Wave 2: Split layout renderer + Tab system (parallel)
- [x] Wave 3: Navigation wiring + DnD system (parallel)
- [x] Wave 4: Edge cases, constraints, and polish

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
