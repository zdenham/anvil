# Sub-Plan 03: Integration & Verification

## Overview

Verify that the Rust backend (01) and frontend (02) work together correctly. Ensure existing hooks and event bridges are properly wired. Perform manual testing.

## Dependencies

- **Requires**: `01-rust-navigation.md` completed
- **Requires**: `02-frontend-inbox-view.md` completed

## Verification Checklist

### Step 1: Verify Event Bridge Configuration

**File: `src/lib/event-bridge.ts`**

Confirm `"navigation-mode"` is in `RUST_PANEL_EVENTS`:
```typescript
export const RUST_PANEL_EVENTS = [
  // ... other events
  "navigation-mode",
  // ...
];
```

If missing, add it.

### Step 2: Verify useNavigationMode Hook

**File: `src/hooks/use-navigation-mode.ts`**

Confirm the hook:
1. Listens to `"navigation-mode"` events
2. Handles event types: `nav-start`, `nav-down`, `nav-up`, `nav-open`, `nav-cancel`
3. Tracks `isNavigating` and `selectedIndex` state
4. Calls `onItemSelect` callback on `nav-open`

### Step 3: Verify UnifiedInbox Integration

**File: `src/components/inbox/unified-inbox.tsx`**

Confirm the component:
1. Uses `useNavigationMode` hook
2. Passes correct `itemCount` and `onItemSelect` callback
3. Applies highlight styling when `isNavigating && selectedIndex === index`
4. Calls `switchToThread` or `switchToPlan` in `onItemSelect`

Example expected code:
```typescript
const { isNavigating, selectedIndex } = useNavigationMode({
  itemCount: items.length,
  onItemSelect: (index) => {
    const item = items[index];
    if (item.type === "thread") {
      switchToThread(item.data.id);
    } else if (item.type === "plan") {
      switchToPlan(item.data.id);
    }
  },
});
```

### Step 4: Verify Rust panels.rs

**File: `src-tauri/src/panels.rs`**

Confirm `show_control_panel_simple` exists and can accept a view parameter, or verify there's a way to show the control panel with inbox view.

If needed, add a function:
```rust
pub fn show_control_panel_inbox(app: &AppHandle) -> Result<(), String> {
    show_control_panel_with_view(app, "inbox")
}
```

And update navigation_mode.rs to call it.

### Step 5: Build and Run

1. Build the Rust backend:
   ```bash
   cd src-tauri && cargo build
   ```

2. Build the frontend:
   ```bash
   pnpm build
   ```

3. Run the app:
   ```bash
   pnpm tauri dev
   ```

### Step 6: Manual Testing

#### Basic Navigation
- [ ] Press Alt+Down → Panel appears with inbox view, first item highlighted
- [ ] Press Alt+Down again → Selection moves to second item
- [ ] Press Alt+Up → Selection moves back to first item
- [ ] Release Alt → Selected item opens in control panel

#### Cancellation
- [ ] Press Escape during navigation → Panel hides, navigation cancels
- [ ] Click outside panel during navigation → Cancels navigation

#### Edge Cases
- [ ] Navigate with 0 items (empty inbox) - should handle gracefully
- [ ] Navigate with 1 item - should work, selection stays on item
- [ ] Navigate with many items (10+) - should scroll to keep selection visible
- [ ] Quick repeated Alt+Down presses - should not skip items or glitch
- [ ] Alt+Down then Alt+Up in quick succession - should work correctly

#### Mixed Content
- [ ] Navigation works when inbox has only threads
- [ ] Navigation works when inbox has only plans
- [ ] Navigation works when inbox has mixed threads and plans

#### Boundary Behavior
- [ ] At first item, Alt+Up wraps to last item (or stops, verify expected behavior)
- [ ] At last item, Alt+Down wraps to first item (or stops, verify expected behavior)

## Troubleshooting

### Events not arriving at frontend
1. Check browser devtools console for errors
2. Verify `event-bridge.ts` is listening for `"navigation-mode"`
3. Check Rust logs for `NavigationMode:` messages
4. Verify `app.emit("navigation-mode", ...)` is being called

### Panel not showing
1. Check `panels::show_control_panel_simple` is being called
2. Verify the URL includes `?view=inbox`
3. Check Rust logs for panel-related errors

### Selection not highlighting
1. Verify `isNavigating` is true in component state
2. Check that highlight CSS classes are being applied
3. Verify `selectedIndex` is updating on nav-down/nav-up events

### Alt release not detected
1. Check Rust logs for CGEventTap messages
2. Verify `OPTION_MASK` constant is correct: `0x00080000`
3. Ensure CGEventTap thread started successfully

## Success Criteria

All items from the parent plan:
- [ ] Alt+Down shows control panel with inbox view
- [ ] Alt+Up shows control panel with inbox view
- [ ] Repeated Alt+Down/Up navigates through items
- [ ] Selection highlights correctly during navigation
- [ ] Releasing Alt opens the selected thread/plan
- [ ] Escape cancels navigation
- [ ] Panel blur cancels navigation
- [ ] Navigation works with mixed threads and plans
- [ ] Navigation wraps at list boundaries
