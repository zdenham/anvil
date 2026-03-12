# Fix Bottom Pane Split Visual Jolt

## Problem

When opening a tab in the bottom pane via `openInBottomPane()`, there's a visible jolt where the split first renders at \~50/50 then snaps to 65/35.

## Root Cause

`paneLayoutService.openInBottomPane()` (`src/stores/pane-layout/service.ts:206-243`) performs two sequential state updates:

1. `splitGroup()` (line 232) → calls `_applySplitGroup()` → calls `splitLeafNode()` which hardcodes `sizes: [50, 50]` (`src/stores/pane-layout/split-tree.ts:78`). React renders the 50/50 split.
2. `updateSplitSizes(parentPath, [65, 35])` (line 239) — a separate state update that adjusts the sizes. React re-renders at 65/35.

The gap between these two renders produces the visual jolt.

## Fix

Add an optional `initialSizes` parameter to `splitLeafNode()` and thread it through `_applySplitGroup()` → `splitGroup()` so that `openInBottomPane()` can create the split at 65/35 in a single state update.

## Phases

- [x] Add `initialSizes` parameter to `splitLeafNode` in `split-tree.ts` (default `[50, 50]`)

- [x] Thread `initialSizes` through `_applySplitGroup` in `store.ts` and `splitGroup` in `service.ts`

- [x] Update `openInBottomPane` to pass `[65, 35]` to `splitGroup` and remove the separate `updateSplitSizes` call

- [x] Update existing tests for the new parameter

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Change

| File | Change |
| --- | --- |
| `src/stores/pane-layout/split-tree.ts` | `splitLeafNode()`: add optional `initialSizes?: [number, number]` param, default `[50, 50]` |
| `src/stores/pane-layout/store.ts` | `_applySplitGroup`: add `initialSizes` param, pass through to `splitLeafNode` |
| `src/stores/pane-layout/service.ts` | `splitGroup()`: add `initialSizes` param, pass through. `openInBottomPane()`: pass `[65, 35]` to `splitGroup`, remove lines 235-239 (`updateSplitSizes` call) |
| `src/stores/pane-layout/__tests__/split-tree.test.ts` | Add test that `splitLeafNode` respects custom sizes |
| `src/stores/pane-layout/__tests__/store.test.ts` | Update `_applySplitGroup` tests if needed |
| `src/stores/pane-layout/__tests__/service.test.ts` | Update `splitGroup` tests if needed |
