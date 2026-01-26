# Fix Standalone Control Panel Window Draggability

## Problem

Standalone control panel windows (created via pop-out) are not draggable, while the main NSPanel works correctly.

## Diagnosis

### Root Cause: `data-tauri-drag-region` Not Working with TitleBarStyle::Overlay

The standalone windows use `TitleBarStyle::Overlay` which hides the native title bar but keeps the macOS traffic lights. The code correctly adds a `data-tauri-drag-region` div in the title bar area:

```tsx
// control-panel-window.tsx:562-567
{isStandaloneWindow && (
  <div
    data-tauri-drag-region
    className="absolute top-0 left-0 right-0 h-7 z-10"
  />
)}
```

However, **`data-tauri-drag-region` does not work with overlay title bars on macOS**. This is a known limitation in Tauri - the attribute is designed for completely custom title bars (decorations: false), not overlay title bars.

### How NSPanel Dragging Works (for comparison)

The NSPanel (main control panel) uses a completely different mechanism:
1. Custom JavaScript event handlers via `useWindowDrag` hook
2. Calls `getCurrentWindow().startDragging()` on mousedown
3. Works because NSPanel has no native title bar at all

### Why Standalone Windows Don't Work

The standalone windows are configured with:
```rust
// panels.rs:1224-1228
.decorations(true)  // Native window decorations
.title_bar_style(tauri::TitleBarStyle::Overlay) // Hide title but keep traffic lights
```

With this configuration:
1. macOS provides the traffic lights but removes the standard title bar drag area
2. `data-tauri-drag-region` is ignored because there ARE decorations (just with overlay style)
3. The `setMovableByWindowBackground` was intentionally NOT set to avoid resize jitter (see comment at panels.rs:1254-1257)

## Proposed Solutions

### Option A: Use JavaScript startDragging() - Recommended

Apply the same drag mechanism used by NSPanel to standalone windows. The `useWindowDrag` hook already supports this, but currently standalone windows explicitly disable it:

```tsx
// Current code - explicitly disables JS drag for standalone windows:
onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
```

**Fix**: Enable the JS-based dragging for standalone windows by:
1. Removing the conditional that disables `dragProps` for standalone windows
2. Ensuring the header has `data-drag-region="header"` attribute for focused-state drag (already present)
3. Remove or adjust the `data-tauri-drag-region` div since it doesn't work

**Changes required**:

1. **control-panel-window.tsx** (line 554-559):
```tsx
// Before:
!isStandaloneWindow && dragProps.className,
onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
onDoubleClick={!isStandaloneWindow ? dragProps.onDoubleClick : undefined}

// After: Apply dragProps to both NSPanel AND standalone windows
dragProps.className,
onMouseDown={dragProps.onMouseDown}
onDoubleClick={isStandaloneWindow ? undefined : dragProps.onDoubleClick}  // Keep double-click-to-close only for NSPanel
```

2. **plan-view.tsx** - Same changes at lines 299-303 and 333-337

3. **useWindowDrag options** - The hook is already configured correctly with `undefined` for pinCommand/hideCommand when standalone. No changes needed.

4. **Remove the non-functional data-tauri-drag-region div** - It does nothing and may cause confusion

### Option B: Enable setMovableByWindowBackground

Re-enable `setMovableByWindowBackground(true)` in panels.rs. This was disabled due to resize jitter, but might be acceptable if:
- The resize jitter is considered a minor issue
- Or we find a way to only enable it for non-edge areas

**Not recommended** because the jitter issue was specifically documented as problematic.

### Option C: Use decorations(false) with custom title bar

Convert standalone windows to use `decorations(false)` and render completely custom traffic lights. This is complex and not recommended.

## Recommended Fix: Option A

The safest fix is Option A - extend the existing JS-based drag mechanism to standalone windows. This:
1. Uses proven code that already works for NSPanel
2. Doesn't require Rust changes
3. Maintains consistent drag behavior between NSPanel and standalone windows
4. Avoids the resize jitter issue

### Implementation Steps

1. **Edit control-panel-window.tsx**:
   - Remove conditional around `dragProps.className` (line 554)
   - Remove conditional around `dragProps.onMouseDown` (line 558)
   - Keep conditional for `onDoubleClick` - standalone windows shouldn't close on double-click
   - Remove the `data-tauri-drag-region` div (lines 562-567) since it's non-functional

2. **Edit plan-view.tsx**:
   - Same changes in both render paths (not-found path and main path)
   - Lines ~299-311 and ~331-345

3. **Test**:
   - Pop out a thread to standalone window
   - Verify dragging works from header area when window is focused
   - Verify dragging works from anywhere when window is unfocused
   - Verify resizing still works without jitter
   - Verify double-click doesn't close the standalone window

## Additional Considerations

### Focus Behavior
The `useWindowDrag` hook has special behavior:
- When unfocused: drag from anywhere (quick repositioning)
- When focused: drag only from header (enables text selection)

This will work correctly for standalone windows since they track focus state.

### pinCommand is undefined for standalone
The hook correctly receives `pinCommand: undefined` for standalone windows, so it won't try to invoke the NSPanel-specific `pin_control_panel` command.

### Double-click behavior
The hook will call `hideCommand` on double-click, which is `undefined` for standalone windows, so double-click will do nothing (correct behavior - use traffic lights to close).
