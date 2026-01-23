# Inbox List Panel Feedback

## Overview

Feedback received on the new inbox-list-panel (used during Alt+Up/Down navigation mode). Three issues identified:

---

## Issue 1: Panel Dimensions Inconsistent with Control Panel

### Diagnosis

The inbox-list-panel currently uses different dimensions than the control-panel:
- `INBOX_LIST_PANEL_WIDTH: 450.0`
- `INBOX_LIST_PANEL_HEIGHT: 650.0`

While the control-panel (formerly "task-panel") uses:
- `CONTROL_PANEL_WIDTH: 650.0`
- `CONTROL_PANEL_HEIGHT: 750.0`

The "gaetan feedbacks" commit (5627ede from 2 days ago) updated the simple-task-panel to:
- Add native shadow: `.has_shadow(true)`
- Add corner radius: `.corner_radius(12.0)`
- Reset size on show: `panel.set_content_size(SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT)`

The inbox-list-panel was created after this commit but with smaller dimensions. The control-panel already has the correct styling (shadow, corner_radius), but inbox-list-panel should match its dimensions.

### Proposed Fix

In `src-tauri/src/panels.rs`:
```rust
// Change from:
pub const INBOX_LIST_PANEL_WIDTH: f64 = 450.0;
pub const INBOX_LIST_PANEL_HEIGHT: f64 = 650.0;

// To match control-panel:
pub const INBOX_LIST_PANEL_WIDTH: f64 = 650.0;
pub const INBOX_LIST_PANEL_HEIGHT: f64 = 750.0;
```

The inbox-list-panel already has `.has_shadow(true)` and `.corner_radius(12.0)` so those are correct.

---

## Issue 2: Missing Status Legend

### Diagnosis

The mission control (main-window) has a `StatusLegend` component in the footer that explains the meaning of status dot colors:
- Green pulsing: Agent is currently running
- Blue: Has unread thread activity
- Grey: All threads read, no activity

Location: `src/components/main-window/main-window-layout.tsx:134-136`
```tsx
<footer className="px-4 py-2 border-t border-surface-700/50">
  <StatusLegend />
</footer>
```

The inbox-list-panel (`src/components/inbox-list/InboxListWindow.tsx`) is missing this legend. It currently has a footer hint for navigation ("Release Alt to open, Escape to cancel") but no status legend.

### Proposed Fix

The `StatusLegend` component already exists at `src/components/ui/status-legend.tsx` and is exported from `src/components/ui/index.ts`.

Update `src/components/inbox-list/InboxListWindow.tsx` to include the legend in the footer:
```tsx
import { StatusLegend } from "@/components/ui/status-legend";

// In the return JSX, update the footer:
<div className="px-4 py-2 border-t border-surface-700">
  <div className="flex items-center justify-between">
    <StatusLegend />
    <span className="text-xs text-surface-500">
      Release Alt to open, Escape to cancel
    </span>
  </div>
</div>
```

---

## Issue 3: Different List Item Components

### Diagnosis

The inbox-list-panel uses a custom compact component (`InboxListItem`) at `src/components/inbox-list/InboxListItem.tsx`:
- Simple row with: StatusDot, type label ("Thread"/"Plan"), display text
- Minimal padding: `px-4 py-2`
- Selection style: `bg-accent-600/30 border-l-2 border-accent-500`

The mission control uses `InboxItemRow` at `src/components/inbox/inbox-item.tsx`:
- Card-style row with: StatusDot, display text, ArchiveButton
- More padding: `px-3 py-2`
- Card styling: `bg-surface-800 rounded-lg border`
- Selection style: `border-accent-500`
- Includes archive functionality

### Current Differences

| Aspect | InboxListItem (panel) | InboxItemRow (mission control) |
|--------|----------------------|-------------------------------|
| Layout | Flat list row | Card with border/rounded |
| Content | Dot + Type + Text | Dot + Text + Archive |
| Selection | Left border accent | Border color accent |
| Archive | Not available | Two-click confirm |
| Padding | `px-4 py-2` | `px-3 py-2` |

### Proposed Fix

Refactor `InboxListWindow` to use the existing `InboxItemRow` component from `src/components/inbox/inbox-item.tsx`. This requires:

1. **Import the shared component:**
   ```tsx
   import { InboxItemRow } from "@/components/inbox/inbox-item";
   ```

2. **Replace the list rendering:**
   ```tsx
   <ul className="space-y-2 px-3 pt-3">
     {items.map((item, index) => (
       <InboxItemRow
         key={`${item.type}-${item.data.id}`}
         item={item}
         isSelected={selectedIndex === index}
         onSelect={() => handleItemClick(index)}
       />
     ))}
   </ul>
   ```

3. **Delete `InboxListItem.tsx`** since it will no longer be needed.

4. **Consider archive behavior in navigation mode:**
   The `InboxItemRow` includes an `ArchiveButton`. During navigation mode, users may not expect/want to archive items. Options:
   - A) Keep the archive button (consistent with mission control)
   - B) Add an optional `hideArchive` prop to `InboxItemRow`
   - C) Disable archive button clicks during navigation mode

   **Recommendation:** Option A - keep it consistent. Users can click to archive if they want, and the two-click confirmation prevents accidents.

---

## Summary of Changes

### Files to Modify

1. **`src-tauri/src/panels.rs`**
   - Update `INBOX_LIST_PANEL_WIDTH` from 450.0 to 650.0
   - Update `INBOX_LIST_PANEL_HEIGHT` from 650.0 to 750.0

2. **`src/components/inbox-list/InboxListWindow.tsx`**
   - Import `StatusLegend` from `@/components/ui/status-legend`
   - Import `InboxItemRow` from `@/components/inbox/inbox-item`
   - Update footer to include `StatusLegend`
   - Replace custom list rendering with `InboxItemRow` component
   - Update list container styling to match mission control (`space-y-2 px-3 pt-3`)

### Files to Delete

1. **`src/components/inbox-list/InboxListItem.tsx`** - replaced by shared `InboxItemRow`

---

## Testing Checklist

- [ ] Inbox-list-panel opens at 650x750 dimensions (matching control-panel)
- [ ] Status legend appears in footer with correct dot colors
- [ ] Navigation hint still visible in footer
- [ ] List items have card-style appearance (rounded, bordered)
- [ ] Archive button appears on each item
- [ ] Archive two-click confirmation works
- [ ] Keyboard navigation (Alt+Up/Down) still works correctly
- [ ] Selection highlight appears correctly on items
- [ ] Items open correctly when selected (Alt release or click)
