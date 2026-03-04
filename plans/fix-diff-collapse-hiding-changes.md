# Fix: Diff Collapse Hiding Changed Lines

## Problem

Collapsed "X lines of unchanged" regions in diff cards sometimes contain lines that are actually changed. Users expand these regions expecting to see unchanged code but find additions/deletions hidden inside.

## Root Cause

The bug is in the **collapsed region system**, not the diff parser.

### How collapsing works

The collapse system (`src/components/diff-viewer/use-collapsed-regions.ts`) has three strategies based on file type:

| File type | Strategy | Function |
|-----------|----------|----------|
| Modified | Collapse runs of 8+ consecutive `type: "unchanged"` lines | `findCollapsibleRegions()` |
| Added | Collapse interior if >100 lines (show first/last 10) | `findNewFileCollapsibleRegions()` |
| Deleted | Collapse interior if >50 lines (show first/last 5) | `findDeletedFileCollapsibleRegions()` |

The **modified** strategy is correct — it scans line types and only collapses truly unchanged regions.

The **added/deleted** strategies are broken — they collapse the file interior **regardless of line types**. For a 74-line deleted file, this creates a collapsed region containing 64 **deletion** lines. But the `CollapsedRegionPlaceholder` (`src/components/diff-viewer/collapsed-region-placeholder.tsx:58`) always renders:

```tsx
{region.lineCount} unchanged line{region.lineCount !== 1 ? "s" : ""}
```

This means every collapsed region says "X unchanged lines", even when all lines are deletions or additions.

### Why the previous fix was wrong

The previous investigation blamed `parseHunk()` for truncating hunks at empty lines. While that edge case was real (and the fix is harmless), it was not the cause of the user-visible bug. The affected files are **deleted files** where:

1. The diff parser correctly outputs all lines as `type: "deletion"`
2. `InlineDiffBlock` correctly maps them to `type: "deletion"` annotated lines
3. `useCollapsedRegions(lines, "deleted")` routes to `findDeletedFileCollapsibleRegions()`
4. That function ignores line types and collapses the middle (lines 5 through n-5)
5. The placeholder says "64 unchanged lines" — **wrong**

### Affected files in current diff

All 12 deleted plan files show this bug (e.g., `plans/e2e-test-library/a-foundation.md` shows "64 unchanged lines" containing 64 deletion lines). Added files >100 lines would have the same problem.

## Phases

- [x] Add `regionKind` to `CollapsedRegion` type and propagate through collapse functions
- [x] Update `CollapsedRegionPlaceholder` to display context-aware labels
- [x] Verified fix via Playwright repro test (deleted file now shows "64 deleted lines" not "64 unchanged lines")

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Plan

### Phase 1: Add `regionKind` to `CollapsedRegion` and propagate

**`src/components/diff-viewer/types.ts`** — Add a `kind` field to `CollapsedRegion`:

```typescript
export interface CollapsedRegion {
  startIndex: number;
  endIndex: number;
  lineCount: number;
  /** What type of lines this region contains */
  kind: "unchanged" | "added" | "deleted";
}
```

**`src/components/diff-viewer/use-collapsed-regions.ts`** — Set `kind` in each function:

- `findCollapsibleRegions()` → `kind: "unchanged"` (already correct, only collapses unchanged runs)
- `findNewFileCollapsibleRegions()` → `kind: "added"`
- `findDeletedFileCollapsibleRegions()` → `kind: "deleted"`

### Phase 2: Update `CollapsedRegionPlaceholder`

**`src/components/diff-viewer/collapsed-region-placeholder.tsx`** — Use `region.kind` for display:

```typescript
const label = region.kind === "deleted"
  ? `${region.lineCount} deleted line${region.lineCount !== 1 ? "s" : ""}`
  : region.kind === "added"
  ? `${region.lineCount} added line${region.lineCount !== 1 ? "s" : ""}`
  : `${region.lineCount} unchanged line${region.lineCount !== 1 ? "s" : ""}`;
```

Also update the `aria-label` to match.

### Phase 3: Tests

Add or update tests in the collapsed regions module to verify:

1. Deleted file regions have `kind: "deleted"`
2. Added file regions have `kind: "added"`
3. Modified file regions have `kind: "unchanged"`
4. The placeholder renders the correct label for each kind

## Files to Modify

| File | Change |
|------|--------|
| `src/components/diff-viewer/types.ts` | Add `kind` field to `CollapsedRegion` |
| `src/components/diff-viewer/use-collapsed-regions.ts` | Set `kind` in all three collapse functions |
| `src/components/diff-viewer/collapsed-region-placeholder.tsx` | Display context-aware label based on `kind` |
