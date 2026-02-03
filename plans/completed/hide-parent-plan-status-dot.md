# Hide Status Dot on Plan Parent Directories

## Goal
Remove the status dot from plan parent directories (folders) to reduce visual clutter and allow for reduced indentation on sub-plans.

## Current Behavior
- All plan items (both folders and leaf plans) show a status dot
- Status dot takes up horizontal space (`StatusDot` component + `gap-1.5`)
- Sub-plans are indented with `INDENT_STEP = 16px` per depth level
- Parent directories show an aggregate or placeholder status that may not be meaningful

## Proposed Changes

### 1. Conditionally Hide Status Dot for Folder Plans
**File:** `src/components/tree-menu/plan-item.tsx` (Line ~207)

Currently:
```tsx
<StatusDot variant={item.status} className="flex-shrink-0" />
```

Change to only render status dot for non-folder items:
```tsx
{!item.isFolder && <StatusDot variant={item.status} className="flex-shrink-0" />}
```

### 2. Reduce Indentation for Sub-Plans
**File:** `src/components/tree-menu/use-tree-keyboard-nav.ts` (Lines 8-9)

Option A - Reduce indent step:
```tsx
export const INDENT_STEP = 12; // Currently 16px
```

Option B - No additional indentation beyond chevron:
Since parent folders have a chevron (16px) but no status dot, and children have a status dot but no chevron, the visual hierarchy is already established. Consider:
```tsx
export const INDENT_STEP = 8; // Minimal additional indent
```

### 3. Adjust Spacer for Non-Folder Items (Optional)
**File:** `src/components/tree-menu/plan-item.tsx` (Lines 188-206)

Currently non-folder items get a 16px spacer where the chevron would be. Since we're removing the status dot from folders, we may want to adjust alignment:

- Folder items: chevron (16px) + no status dot
- Non-folder items: spacer (16px) + status dot

This keeps alignment consistent. No change needed here unless we want tighter spacing.

## Implementation Steps

1. [ ] Modify `plan-item.tsx` to conditionally render StatusDot only for non-folder plans
2. [ ] Test that folder plans display correctly without the status dot
3. [ ] Evaluate current indentation visually
4. [ ] Optionally reduce `INDENT_STEP` if desired
5. [ ] Verify keyboard navigation still works correctly
6. [ ] Test with various nesting depths (1, 2, 3+ levels)

## Visual Before/After

**Before:**
```
▸ ● parent-plan/
    ● child-plan-1.md
    ● child-plan-2.md
```

**After:**
```
▸ parent-plan/
  ● child-plan-1.md
  ● child-plan-2.md
```

## Files to Modify
- `src/components/tree-menu/plan-item.tsx` - Hide status dot for folders
- `src/components/tree-menu/use-tree-keyboard-nav.ts` - Optionally reduce INDENT_STEP
