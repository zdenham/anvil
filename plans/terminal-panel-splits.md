# Terminal Panel Splits (Rearrange & Split Within Panel)

## Problem

The terminal panel currently renders a **single PaneGroup** — one tab bar, one content area. Terminals can't be split side-by-side or top-to-bottom within the panel. Users expect VS Code-like behavior where terminals can be split and rearranged within the bottom panel, but not dragged across the panel boundary into the content zone (or vice versa).

## Current Architecture

- `TerminalPanelLayout` renders a single `PaneGroup` for the terminal panel's `groupId`
- The terminal panel state (`terminalPanel`) tracks one `groupId` pointing to a single group in `groups`
- The `PaneGroup` is wrapped in a **no-op** `DndBridgeProvider` (`NOOP_DND_BRIDGE`), which means:
  - No drag-and-drop works at all — tabs can't be reordered or split
  - The `DropZoneOverlay` never activates (no `activeDrag`)
- The main content zone's `SplitLayoutContainer` has its own `DndContext` + `useTabDnd` that enables tab reordering, cross-group moves, and edge-zone splitting — but only for groups in the content `root` split tree
- `_applySplitGroup` and `_applySplitAndMoveTab` operate on the content `root` split tree — they can't target a separate terminal split tree

## Design

### Core Idea: Give the Terminal Panel Its Own Split Tree

Mirror the content zone's architecture inside the terminal panel:

```
Terminal Panel (before):
┌──────────────────────────────┐
│ [tab1] [tab2] [tab3] [+]    │  ← single PaneGroup
│ $ _                          │
└──────────────────────────────┘

Terminal Panel (after):
┌──────────────────────────────┐
│ [tab1] [+]  │ [tab2] [+]    │  ← two PaneGroups in a horizontal split
│ $ _         │ $ _            │
└──────────────────────────────┘
```

The terminal panel gets its own `SplitNode` tree (stored in `terminalPanel.root`), rendered by the same `SplitNodeRenderer`, wrapped in its own `DndContext`. This reuses all existing split infrastructure while keeping the two zones isolated.

### State Changes

Replace the single `groupId` with a full split tree in `TerminalPanelState`:

```typescript
export const TerminalPanelStateSchema = z.object({
  root: SplitNodeSchema,          // NEW: split tree for terminal groups
  height: z.number(),
  isOpen: z.boolean(),
  isMaximized: z.boolean(),
});
```

Remove `groupId` — the terminal panel's groups are identified by being referenced in `terminalPanel.root` (same pattern as the content zone). All terminal groups still live in the shared `groups` record.

**Migration**: Convert old `{ groupId: "abc" }` → `{ root: { type: "leaf", groupId: "abc" } }` in the hydration migration.

### Store Changes

Add terminal-panel-aware split actions to the store:

- `_applyTerminalSplitGroup(groupId, direction, newGroup, initialSizes?)` — Like `_applySplitGroup` but operates on `terminalPanel.root` instead of `root`
- `_applyTerminalSplitAndMoveTab(targetGroupId, direction, sourceGroupId, tabId)` — Like `_applySplitAndMoveTab` but for terminal tree
- `_applyTerminalCollapseSplit(path)` — Collapse within terminal tree
- `_applyTerminalUpdateSplitSizes(path, sizes)` — Resize within terminal tree

These are thin wrappers that call the same `splitLeafNode`, `collapseSplitAtPath`, etc. helpers but target `state.terminalPanel.root`.

### Service Changes

Add terminal-aware counterparts in `terminal-panel-service.ts`:

- `splitTerminalGroup(groupId, direction)` — Split a terminal pane, creating a new terminal session in the new group
- `splitAndMoveTerminalTab(targetGroupId, direction, sourceGroupId, tabId)` — Move a terminal tab to a new split within the terminal panel
- Update `closeTerminalTab` — When closing the last tab in a terminal group, remove that group from the terminal split tree (collapse parent). If the tree becomes empty, hide the panel.
- Update `_removeEmptyGroup` — Detect terminal-tree groups and collapse from `terminalPanel.root` instead of `root`.

### Component Changes

`terminal-panel-layout.tsx`: Replace the single `PaneGroup` with a mini `SplitLayoutContainer`-like setup:

```tsx
function TerminalPanelContent({ terminalRoot }: { terminalRoot: SplitNode }) {
  const { sensors, activeDrag, activeEdgeZone, ... } = useTerminalTabDnd();

  return (
    <DndContext sensors={sensors} ...handlers>
      <DndBridgeProvider value={bridgeValue}>
        <SplitNodeRenderer node={terminalRoot} path={[]} />
      </DndBridgeProvider>
      <DragOverlay>...</DragOverlay>
    </DndContext>
  );
}
```

This gives the terminal panel its own `DndContext`, fully isolated from the content zone's `DndContext`. Tabs can be dragged within the terminal panel (reorder, cross-group move, edge-zone split) but cannot escape to the content zone because the two `DndContext` scopes don't overlap.

`useTerminalTabDnd`: A variant of `useTabDnd` that:

- Scopes edge zone detection to terminal panel groups only (groups referenced in `terminalPanel.root`)
- Calls `splitAndMoveTerminalTab` instead of `paneLayoutService.splitAndMoveTab`
- Uses terminal-specific split constraint checks (e.g., max horizontal/vertical children within the terminal tree)

This can either be a new hook or a parameterization of the existing `useTabDnd` (e.g., pass a `scope: "content" | "terminal"` option). Parameterization is preferred to avoid code duplication.

### Cross-Panel Boundary Prevention

The two zones are naturally isolated because they have **separate** `DndContext` **instances**. `@dnd-kit` scopes all drag events to the `DndContext` that owns the drag. A tab dragged from a terminal group will never fire `onDragOver` or `onDragEnd` in the content zone's `DndContext`, and vice versa. No explicit boundary checks needed.

### Constraint Checks

Reuse `canSplitHorizontal` / `canSplitVertical` from `constraints.ts` but pass `terminalPanel.root` as the tree root instead of `root`. The same max-children limits apply.

### Tab Bar "+" Button

Already works correctly — when the active tab is a terminal, it creates another terminal. In a split terminal panel, each sub-group's `+` button creates a terminal in that group. No changes needed.

### Resize Between Terminal Splits

The existing `SplitResizeHandle` component handles this. It calls `paneLayoutService.updateSplitSizes(path, sizes)`. Need a terminal variant: `updateTerminalSplitSizes(path, sizes)` that targets `terminalPanel.root`.

### Edge Cases

- **Single terminal**: Works exactly as before — one leaf in the terminal tree, no splits.
- **All terminals in one split closed**: Group removed, split collapses. If last group, panel hides.
- **Max splits**: Same constraints as content zone (4 horizontal, 3 vertical).
- **Backward compat**: Old state with `groupId` migrated to `{ root: { type: "leaf", groupId } }`.
- **Persisted height**: Unchanged — the panel's overall height applies to the entire terminal zone regardless of internal splits.

## Summary of Changes

| Area | Change |
| --- | --- |
| `stores/pane-layout/types.ts` | Replace `groupId: string` with `root: SplitNodeSchema` in `TerminalPanelStateSchema` |
| `stores/pane-layout/store.ts` | Add `_applyTerminalSplitGroup`, `_applyTerminalSplitAndMoveTab`, `_applyTerminalCollapseSplit`, `_applyTerminalUpdateSplitSizes` |
| `stores/pane-layout/terminal-panel-service.ts` | Add `splitTerminalGroup`, `splitAndMoveTerminalTab`, `updateTerminalSplitSizes`. Update `closeTerminalTab` to collapse terminal tree. |
| `stores/pane-layout/migrations.ts` | Migrate old `{ groupId }` → `{ root: { type: "leaf", groupId } }` |
| `stores/pane-layout/service.ts` | Update `_removeEmptyGroup` to detect terminal-tree groups |
| `components/split-layout/use-tab-dnd.ts` | Parameterize with `scope` option so it can target either `root` or `terminalPanel.root` |
| `components/terminal-panel/terminal-panel-layout.tsx` | Replace single `PaneGroup` with `DndContext` + `SplitNodeRenderer` over `terminalPanel.root` |
| `components/split-layout/split-resize-handle.tsx` | Needs to know which tree to update sizes in (content vs terminal) — add context or prop |

## Phases

- [x] Extend `TerminalPanelState` schema: replace `groupId` with `root: SplitNodeSchema`. Add migration for old format. Update all references (`store.ts`, `terminal-panel-service.ts`, `service.ts`).

- [x] Add terminal split tree actions to store: `_applyTerminalSplitGroup`, `_applyTerminalSplitAndMoveTab`, `_applyTerminalUpdateSplitSizes`.

- [x] Add terminal split service methods: `splitTerminalGroup`, `splitAndMoveTerminalTab`, `updateTerminalSplitSizes`. Update `closeTerminalTab` and `_removeEmptyGroup` to collapse terminal tree when groups empty.

- [x] Parameterize `useTabDnd` with a scope option so edge detection, split constraints, and split actions target the correct tree (`root` vs `terminalPanel.root`).

- [x] Update `SplitResizeHandle` to support targeting terminal panel tree (via `SplitTreeScope` context).

- [x] Replace `TerminalPanelContent` single `PaneGroup` with own `DndContext` + `SplitNodeRenderer` rendering `terminalPanel.root`, using scoped `useTabDnd`.

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---