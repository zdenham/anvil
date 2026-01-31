# Thread Naming Improvements Plan

## Problem Statement

**Thread names are truncated in the sidebar**: The left panel truncates thread names with CSS, hiding potentially useful information.

## Current Behavior

### Sidebar Display (`src/components/tree-menu/thread-item.tsx`)
- Uses CSS `truncate` class which clips overflow with ellipsis
- No tooltip or expansion mechanism for full name

## Proposed Changes

### Fix Sidebar Truncation

**Goal**: Show the full thread name (or more of it) in the sidebar.

**Option A: Add Tooltip on Hover (Recommended)**

**File**: `src/components/tree-menu/thread-item.tsx`

**Changes**:
- Add a `title` attribute to show full name on hover
- Keep the visual truncation but allow users to see the full name

```tsx
<span className="truncate flex-1" title={item.title}>
  {item.title}
</span>
```

**Option B: Allow Multi-line Names**

**File**: `src/components/tree-menu/thread-item.tsx`

**Changes**:
- Replace `truncate` with `line-clamp-2` to allow 2 lines
- Adjust item height accordingly

**Option C: Increase Sidebar Width**

Less desirable as it takes space from the main content area.

## Implementation Steps

1. [ ] Add tooltip to `thread-item.tsx` for full name on hover

## Files to Modify

1. `src/components/tree-menu/thread-item.tsx` - Sidebar display
