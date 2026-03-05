# Fix: Extra Tab Appended When Splitting Pane via Tab Drag

## Problem

When dragging a tab to a pane edge to create a split, the new pane ends up with **two tabs** — the dragged tab plus a spurious empty tab.

## Root Cause

The edge-drop handler in `use-tab-dnd.ts:206-215` calls two operations sequentially:

1. `splitGroup(targetGroupId, direction)` — creates a new group pre-populated with an empty tab (no `view` arg → `{ type: "empty" }`)
2. `moveTab(sourceGroupId, tabId, newGroupId, 0)` — **inserts** the dragged tab at index 0 via `splice()`

The result: the new group has `[dragged_tab, empty_tab]` instead of just `[dragged_tab]`.

The design mismatch: `splitGroup()` always creates a starter tab (needed for menu-driven splits), but the drag-to-split flow doesn't need one since it's moving an existing tab in.

## Fix

Add a `splitAndMoveTab` method to `pane-layout/service.ts` that atomically:
1. Removes the tab from the source group
2. Creates a new group using **that tab** as its initial tab (no empty placeholder)
3. Splits the target group with the new group
4. Cleans up the source group if it's now empty

Then update the edge-drop handler in `use-tab-dnd.ts` to call this single method instead of `splitGroup` + `moveTab` + manual empty-group cleanup.

### Files to change

| File | Change |
|------|--------|
| `src/stores/pane-layout/service.ts` | Add `splitAndMoveTab(targetGroupId, direction, sourceGroupId, tabId)` |
| `src/stores/pane-layout/store.ts` | Add `_applySplitAndMoveTab` that combines remove + split in one state update |
| `src/components/split-layout/use-tab-dnd.ts` | Replace the 3-step edge-drop sequence (lines 206-221) with single `splitAndMoveTab` call |

### Why atomic

Making this a single store operation (rather than patching the existing two-step flow) avoids an intermediate invalid state where the new group has two tabs and prevents a redundant `persistState()` call.

## Phases

- [x] Add `_applySplitAndMoveTab` to the store and `splitAndMoveTab` to the service
- [x] Update edge-drop handler in `use-tab-dnd.ts` to use the new method
- [x] Verify no other callers of `splitGroup` are affected (they still work as-is for menu-driven splits)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
