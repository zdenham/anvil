# Click-to-Select-then-Expand for Folder Items

## Problem

Currently, folder-based plans and threads auto-expand when they are created or first loaded (default `isExpanded: true`). Additionally, clicking anywhere on a folder row immediately expands it. This auto-expansion behavior is annoying for users who want to browse the tree without everything opening up.

## Desired Behavior

1. **First click**: Selects the folder item (shows it as selected with highlight). The indicator remains a **dot** (like non-folder items).
2. **Once selected**: The dot transforms into a **chevron**, indicating the item can now be expanded.
3. **Second click (or chevron click)**: Expands the folder to show children.
4. **Default state**: Folders should **not** auto-expand - they start collapsed by default.

This creates a two-step interaction: select first, then expand.

## Current Implementation

### Files Involved
- `src/components/tree-menu/plan-item.tsx` - Plan row rendering
- `src/components/tree-menu/thread-item.tsx` - Thread row rendering
- `src/hooks/use-tree-data.ts` - Tree data building with expansion state

### Current Behavior
1. **Folders always show chevron**: Lines 237-251 (plan-item.tsx), 212-226 (thread-item.tsx)
2. **Default expansion is `true`**: Lines 74, 108 in use-tree-data.ts (`?? true`)
3. **Click auto-expands**: handleClick in plan-item.tsx:129-136 and thread-item.tsx:103-110

## Implementation Plan

### Phase 1: Change default expansion to collapsed

**File**: `src/hooks/use-tree-data.ts`

Change the default expansion state from `true` to `false`:
- Line 74: `expandedSections[`thread:${thread.id}`] ?? true` → `?? false`
- Line 108: `expandedSections[`plan:${plan.id}`] ?? true` → `?? false`

### Phase 2: Update folder indicator logic

**Files**: `src/components/tree-menu/plan-item.tsx`, `src/components/tree-menu/thread-item.tsx`

Change the indicator rendering logic:
- When folder is **not selected**: Show **StatusDot** (same as non-folder items)
- When folder is **selected**: Show **ChevronRight** (expandable indicator)

Current logic (plan-item.tsx lines 237-256):
```tsx
{item.isFolder ? (
  <button>...chevron...</button>
) : (
  <span>...dot...</span>
)}
```

New logic:
```tsx
{item.isFolder && isSelected ? (
  <button>...chevron...</button>
) : (
  <span>...dot...</span>
)}
```

### Phase 3: Update click behavior

**Files**: `src/components/tree-menu/plan-item.tsx`, `src/components/tree-menu/thread-item.tsx`

Currently, `handleClick` selects AND expands collapsed folders. Change to:
- **First click on unselected folder**: Only select (don't expand)
- **Click when already selected**: Expand/collapse

Current (plan-item.tsx lines 129-136):
```tsx
const handleClick = async () => {
  onSelect(item.id, "plan");
  if (item.isFolder && !item.isExpanded) {
    await treeMenuService.expandSection(`plan:${item.id}`);
  }
};
```

New:
```tsx
const handleClick = async () => {
  if (isSelected && item.isFolder) {
    // Already selected - toggle expansion
    await treeMenuService.toggleSection(`plan:${item.id}`);
  } else {
    // Not selected - just select
    onSelect(item.id, "plan");
  }
};
```

### Phase 4: Update keyboard navigation

**Files**: `src/components/tree-menu/plan-item.tsx`, `src/components/tree-menu/thread-item.tsx`

The ArrowRight key currently expands folders directly. Keep this behavior since keyboard users expect arrow keys to navigate/expand. No changes needed for keyboard nav.

## Phases

- [x] Change default expansion state to collapsed
- [x] Update indicator to show dot when unselected, chevron when selected
- [x] Update click handler for two-step expand
- [x] Test the implementation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Visual Summary

| State | Indicator | Click Action |
|-------|-----------|--------------|
| Folder, unselected | Dot | Select only |
| Folder, selected | Chevron | Toggle expand |
| Non-folder | Dot | Select |

## Edge Cases to Consider

1. **Keyboard navigation**: ArrowRight should still expand folders (even if unselected) for keyboard accessibility
2. **Already expanded folders**: When clicking an expanded folder that loses selection and regains it, the chevron should still show and allow collapse
3. **Status dot variant**: Folders should use the same status dot as their current state (running/unread/read/stale)
