# Fix: Prevent folder from being moved into its own subfolder

## Problem

The cycle detection in `validateDrop()` only fires for `dropPosition === "inside"` (line 106 of `src/lib/dnd-validation.ts`). When a folder is dropped "above" or "below" a node inside its own subtree, the effective new parent is a descendant — creating a circular nesting cycle.

**Repro:** Given FolderA → FolderB → Thread1, drag FolderA and drop it "above" Thread1. The computed `newParentId` becomes FolderB (Thread1's parent), which is a descendant of FolderA.

## Fix

Move the cycle detection check **after** `newParentId` is computed (after current line 112) and make it position-agnostic. Instead of checking `isAncestor(targetItem.id, ...)` only for "inside" drops, check whether the resolved `newParentId` is the dragged item itself or a descendant of it.

### Code change (`src/lib/dnd-validation.ts`)

Replace current step 5 (lines 105-108):
```ts
// 5. Cycle detection: cannot drop a node into its own descendant
if (dropPosition === "inside" && isAncestor(targetItem.id, draggedItem.id, parentMap)) {
  return { valid: false, reason: "Cannot drop a node into its own descendant" };
}
```

Move cycle detection to **after** `newParentId` is computed (after line 112), and rewrite as:
```ts
// 5. Cycle detection: cannot drop a node under itself or any of its descendants
if (newParentId) {
  if (
    newParentId === draggedItem.id ||
    isAncestor(newParentId, draggedItem.id, parentMap)
  ) {
    return { valid: false, reason: "Cannot drop a node into its own descendant" };
  }
}
```

This catches:
- **"inside" a descendant** — `newParentId` is the descendant itself (existing case)
- **"above"/"below" a node inside the subtree** — `newParentId` is the target's parent, which may be a descendant
- **"above"/"below" a direct child** — `newParentId` equals `draggedItem.id` (self-parenting)

### Test additions (`src/lib/__tests__/dnd-validation.test.ts`)

Add to the "cycle detection" describe block:

1. **"cannot drop a folder above a node inside its own subtree"** — FolderA → FolderB → Thread1, drop FolderA "above" Thread1 → invalid
2. **"cannot drop a folder below a node inside its own subtree"** — same setup, drop "below" → invalid
3. **"cannot drop a folder above its direct child"** — FolderA → FolderB, drop FolderA "above" FolderB → invalid (would self-parent)

## Phases

- [x] Fix cycle detection in `validateDrop` to be position-agnostic
- [x] Add test cases covering above/below drops into own subtree

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
