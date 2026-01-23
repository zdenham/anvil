# Diagnosis: "All Caught Up" Panel Behavior

## Problem Statement

When navigating tasks via quick actions (archive, mark unread, next item) and there are no more unread items, the user sees an "All caught up" banner but the **control panel remains visible** instead of being closed while the inbox panel opens.

**Expected behavior**: Control panel should close and inbox panel should open.
**Actual behavior**: Control panel stays visible, inbox panel opens (becomes key window), but both panels are now visible.

## Root Cause Analysis

### Code Flow

1. **User triggers quick action** in `control-panel-window.tsx:395` or `plan-view.tsx:158`
   - Calls `navigateToNextItemOrFallback(currentItem, { actionType })`

2. **Navigation hook executes** in `use-navigate-to-next-item.ts:61-120`
   - Calls `getNextUnreadItem(currentItem)` to find next unread item
   - If no next item found (or same item), falls into the "all caught up" branch (lines 99-117)

3. **The "all caught up" branch**:
   ```typescript
   // Lines 99-117 in use-navigate-to-next-item.ts
   else {
     // Show "all caught up" banner
     showBanner(completionMessage, "All caught up");  // Line 111

     // Show inbox panel
     await invoke("show_inbox_list_panel");  // Line 114

     return false;
   }
   ```

### The Bug

**The control panel is never hidden.** The code only:
1. Shows the banner
2. Opens the inbox panel

It does NOT call `invoke("hide_control_panel")`.

The `show_inbox_list_panel` Rust function (panels.rs:1192-1218) makes the inbox panel the key window via `panel.show_and_make_key()`, but this doesn't hide the control panel - it just steals focus.

### Relevant Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/hooks/use-navigate-to-next-item.ts` | 99-117 | Missing hide_control_panel call |
| `src-tauri/src/panels.rs` | 981-993 | `hide_control_panel` function |
| `src-tauri/src/panels.rs` | 1192-1218 | `show_inbox_list_panel` function |

## Proposed Solution

### Option A: Hide control panel in JavaScript (Recommended)

Add `invoke("hide_control_panel")` before showing the inbox panel in the "all caught up" branch:

```typescript
// In use-navigate-to-next-item.ts, lines 110-117
else {
  // No more unread items - fall back to inbox panel
  const completionMessage = getCompletionMessage(actionType, currentItem.type);

  logger.info(`[useNavigateToNextItem] No more unread items, showing inbox`, {
    currentItem,
    nextItem,
    isSameItem,
    actionType,
  });

  // Show "all caught up" banner
  showBanner(completionMessage, "All caught up");

  // Hide control panel first
  await invoke("hide_control_panel");

  // Then show inbox panel
  await invoke("show_inbox_list_panel");

  return false;
}
```

### Option B: Hide control panel in Rust

Modify `show_inbox_list_panel` in panels.rs to automatically hide the control panel:

```rust
pub fn show_inbox_list_panel(app: &AppHandle) -> Result<(), String> {
    // Hide control panel first
    hide_control_panel(app)?;

    // ... rest of existing code
}
```

### Recommendation

**Option A is preferred** because:
1. It keeps panel management explicit in the JavaScript code where the business logic lives
2. It doesn't create implicit coupling between panel operations
3. It allows flexibility for other use cases where you might want both panels visible
4. The control panel hiding and inbox panel showing are separate concerns that should be handled by the caller

## Implementation Steps

1. Edit `src/hooks/use-navigate-to-next-item.ts`
2. In the "all caught up" branch (around line 111-114), add `await invoke("hide_control_panel");` before `await invoke("show_inbox_list_panel");`
3. Test the flow:
   - Open a thread/plan in control panel
   - Archive it (or mark unread, or press next item)
   - When "all caught up" appears, verify control panel closes and inbox panel opens

## Testing Checklist

- [ ] Archive last unread thread → control panel closes, inbox opens
- [ ] Archive last unread plan → control panel closes, inbox opens
- [ ] Mark unread last item → control panel closes, inbox opens
- [ ] Press "next item" when no more items → control panel closes, inbox opens
- [ ] Verify banner still appears during transition
- [ ] Verify inbox panel has focus after transition
