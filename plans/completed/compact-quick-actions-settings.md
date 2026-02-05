# Compact Quick Actions Settings Layout

## Goal
Make the quick action items in settings more vertically compact by converting from a multi-line card layout to a single-row table-like layout.

## Current State
Each action item currently displays as a card with multiple lines:
- Line 1: Title + hotkey badge
- Line 2: Description (truncated)
- Line 3: Context tags (thread, plan, etc.)

This results in ~60-80px height per row.

## Proposed Layout
Convert to a compact single-row table layout with columns:
| Drag | Title | Contexts | Hotkey | Toggle | Edit |
|------|-------|----------|--------|--------|------|

- **Drag**: Grip icon for reordering
- **Title**: Action name (description shown on hover via tooltip)
- **Contexts**: Inline badges (thread, plan)
- **Hotkey**: Keyboard shortcut badge (⌘1, etc.) or "—" if none
- **Toggle**: Enable/disable toggle
- **Edit**: Settings icon button

Target height: ~36-40px per row.

## Implementation Steps

### 1. Update `QuickActionListItem` component
File: `src/components/settings/quick-action-list-item.tsx`

Changes:
- Remove vertical stacking in the content area
- Display title inline with truncation
- Move description to a tooltip on the title
- Display contexts as inline compact badges
- Ensure hotkey displays inline
- Keep toggle and edit buttons

### 2. Update `QuickActionsSettings` container
File: `src/components/settings/quick-actions-settings.tsx`

Changes:
- Add a header row with column labels (optional, for table clarity)
- Reduce gap between items from `space-y-2` to `space-y-1` or remove entirely
- Consider adding subtle dividers instead of full card backgrounds

### 3. Style adjustments
- Reduce padding from `p-3` to `py-1.5 px-2`
- Use smaller text for context badges
- Ensure consistent column widths for alignment
