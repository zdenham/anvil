# Menu Dropdown Consolidation Plan

## Overview

Consolidate the Settings and Logs buttons in the tree panel header into a single dropdown menu triggered by a three-dot (ellipsis) icon button.

## Current State

- **Location**: `src/components/tree-menu/tree-panel-header.tsx`
- **Current UI**: Two separate icon buttons (Cog for Settings, ScrollText for Logs) with tooltips
- **Navigation**: Buttons trigger `onSettingsClick` and `onLogsClick` callbacks that navigate to respective views

## Target State

- Single three-dot icon button that opens a dropdown menu
- Dropdown contains two items: "Settings" and "Logs" (each with their respective icons)
- Clicking an item closes the dropdown and navigates to the selected view

## Implementation Steps

### Step 1: Create the MenuDropdown Component

Create a new reusable dropdown component at `src/components/tree-menu/menu-dropdown.tsx`:

- Use the existing `TriggerDropdown` pattern from `src/components/reusable/trigger-dropdown.tsx` as reference
- Trigger button: Three-dot icon (`MoreVertical` or `Ellipsis` from lucide-react)
- Match existing button styling: `w-5 h-5 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200`
- Dropdown items should include icons alongside text labels
- Support keyboard navigation (Arrow keys, Enter, Escape)
- Click outside to close

### Step 2: Update TreePanelHeader

Modify `src/components/tree-menu/tree-panel-header.tsx`:

1. Remove the individual Settings and Logs button elements
2. Import and add the new `MenuDropdown` component
3. Pass `onSettingsClick` and `onLogsClick` as props to the dropdown
4. Keep the Tooltip wrapper for the trigger button with content "Menu" or "More options"

### Step 3: Style the Dropdown Menu

Ensure visual consistency with the codebase:

- Use surface color palette (`surface-800`, `surface-700`, `surface-400`, etc.)
- Menu item hover state: `bg-surface-700`
- Icons at 12px to match existing iconography
- Appropriate spacing and padding for touch/click targets
- Dropdown positioned below and right-aligned to the trigger button

## Menu Items Structure

| Item | Icon | Action |
|------|------|--------|
| Settings | `Cog` | Navigate to settings view |
| Logs | `ScrollText` | Navigate to logs view |

## Files to Modify

1. **Create**: `src/components/tree-menu/menu-dropdown.tsx` - New dropdown component
2. **Modify**: `src/components/tree-menu/tree-panel-header.tsx` - Replace buttons with dropdown

## Accessibility Considerations

- `aria-haspopup="menu"` on trigger button
- `aria-expanded` state on trigger
- `role="menu"` on dropdown container
- `role="menuitem"` on each dropdown item
- Focus management when opening/closing
- Keyboard navigation support (inherited from existing patterns)

## Visual Reference

```
Before:                    After:
[⚙️] [📜]                   [⋮]
                              ├─ ⚙️ Settings
                              └─ 📜 Logs
```
