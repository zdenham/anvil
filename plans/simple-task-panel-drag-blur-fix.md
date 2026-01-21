# Simple Task Panel Drag Blur Fix

## Problem Description

When dragging and moving the simple-task panel, the font becomes slightly blurry. Resizing the panel makes the text crisp again.

## Root Cause Analysis

### The Core Issue: Subpixel Positioning During Native Drag

When `getCurrentWindow().startDragging()` is called in Tauri (line 576 of `simple-task-window.tsx`), the native macOS window manager takes over the drag operation. During this dragging phase:

1. **Fractional coordinates**: macOS continuously updates the window position with floating-point values (e.g., `445.5, 200.3`)
2. **No pixel snapping**: These fractional coordinates are passed directly to the WebKit renderer
3. **Subpixel rendering artifacts**: WebKit attempts to render text at non-integer pixel positions, causing text rasterization issues and disabling certain GPU optimizations

### Why Resize Fixes It

When you resize the window:
1. A `WindowEvent::Resized` event fires in Tauri
2. The WebKit view receives new dimensions and performs a full layout recalculation
3. The window content is re-rendered at **pixel-aligned boundaries**
4. GPU acceleration is re-enabled and proper anti-aliasing is applied
5. Text becomes crisp again

### Contributing Factors

The simple-task panel configuration in `panels.rs:994-1024` combines several features that make the rendering pipeline sensitive to pixel alignment:

```rust
.transparent(true)           // Transparent background - requires off-screen rendering buffer
.corner_radius(12.0)         // Native rounded corners - requires software compositing
.has_shadow(true)            // Adds shadow layer - additional compositing
.setMovableByWindowBackground(true)  // Enables native background dragging
```

The combination of transparency + rounded corners + shadow creates a compositing pipeline that's extremely sensitive to subpixel positioning.

### CSS Analysis

The current CSS in `src/index.css:192-197` is minimal:

```css
.simple-task-container {
  background: var(--spotlight-bg);
  border: 1px solid var(--spotlight-border);
  cursor: default;
  user-select: none;
}
```

There are no GPU acceleration hints (`will-change`, `transform: translateZ(0)`) or font smoothing properties that might help mitigate the issue.

## Proposed Solutions

### Solution 1: Force Pixel-Aligned Positioning After Drag (Recommended)

**Approach**: Listen for the drag end event and snap the window position to integer coordinates.

**Frontend Changes** (`simple-task-window.tsx`):

```typescript
const handleWindowDrag = useCallback(async (e: React.MouseEvent) => {
  if (e.button !== 0) return;

  const target = e.target as HTMLElement;
  const interactiveSelector = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';
  if (target.closest(interactiveSelector)) return;

  try {
    await invoke("pin_simple_task_panel");
  } catch (err) {
    console.error("[SimpleTaskWindow] Failed to pin panel:", err);
  }

  // Start native drag
  getCurrentWindow().startDragging().catch((err) => {
    console.error("[SimpleTaskWindow] startDragging failed:", err);
  });

  // After drag ends, snap position to pixel boundaries
  // We need to wait for the drag to complete, then fix positioning
  const snapPositionAfterDrag = async () => {
    try {
      await invoke("snap_simple_task_panel_position");
    } catch (err) {
      console.error("[SimpleTaskWindow] Failed to snap position:", err);
    }
  };

  // Listen for mouseup to know when drag ended
  const handleMouseUp = () => {
    window.removeEventListener('mouseup', handleMouseUp);
    // Small delay to ensure drag has fully completed
    setTimeout(snapPositionAfterDrag, 50);
  };

  window.addEventListener('mouseup', handleMouseUp);
}, []);
```

**Backend Changes** (`panels.rs`):

```rust
/// Snaps the simple task panel position to integer pixel coordinates
/// This fixes text blurriness caused by subpixel positioning during drag
pub fn snap_simple_task_panel_position(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SIMPLE_TASK_LABEL) {
        let frame = panel.as_panel().frame();

        // Round position to nearest integer
        let snapped_x = frame.origin.x.round();
        let snapped_y = frame.origin.y.round();

        // Only update if position changed
        if (frame.origin.x - snapped_x).abs() > 0.001
            || (frame.origin.y - snapped_y).abs() > 0.001
        {
            panel.as_panel().setFrameTopLeftPoint(
                tauri_nspanel::NSPoint::new(snapped_x, snapped_y)
            );
            tracing::debug!(
                "[SimpleTaskPanel] Snapped position from ({}, {}) to ({}, {})",
                frame.origin.x, frame.origin.y, snapped_x, snapped_y
            );
        }

        Ok(())
    } else {
        Err("Simple task panel not found".to_string())
    }
}
```

**Add Tauri command** (`lib.rs`):

```rust
#[tauri::command]
fn snap_simple_task_panel_position(app: AppHandle) -> Result<(), String> {
    panels::snap_simple_task_panel_position(&app)
}
```

### Solution 2: CSS-Based Mitigation (Supplementary)

Add GPU acceleration hints and font smoothing to help maintain text quality during transitions:

**CSS Changes** (`src/index.css`):

```css
.simple-task-container {
  background: var(--spotlight-bg);
  border: 1px solid var(--spotlight-border);
  cursor: default;
  user-select: none;

  /* GPU acceleration hints to maintain text quality */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  /* Force GPU layer to maintain consistent rendering */
  transform: translateZ(0);
  backface-visibility: hidden;
}
```

**Pros**: Simple, no code changes beyond CSS
**Cons**: May not fully solve the issue; `transform: translateZ(0)` might have side effects on click positioning

### Solution 3: Custom Drag Implementation (Alternative)

Instead of using native `startDragging()`, implement a custom JavaScript-based drag handler that enforces pixel-aligned positioning during the drag itself.

**Approach**:
1. Track mouse position manually
2. Calculate delta from drag start
3. Round position to integers before applying
4. Use Tauri command to set panel position

```typescript
const handleWindowDrag = useCallback(async (e: React.MouseEvent) => {
  if (e.button !== 0) return;

  const target = e.target as HTMLElement;
  if (target.closest('button, input, textarea, a')) return;

  await invoke("pin_simple_task_panel");

  // Get initial window position
  const window = getCurrentWindow();
  const startPos = await window.outerPosition();
  const startMouseX = e.screenX;
  const startMouseY = e.screenY;

  const handleMouseMove = async (moveEvent: MouseEvent) => {
    const deltaX = Math.round(moveEvent.screenX - startMouseX);
    const deltaY = Math.round(moveEvent.screenY - startMouseY);

    // Apply rounded position
    await invoke("set_simple_task_panel_position", {
      x: Math.round(startPos.x + deltaX),
      y: Math.round(startPos.y + deltaY),
    });
  };

  const handleMouseUp = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}, []);
```

**Pros**: Full control over positioning, always pixel-aligned
**Cons**: More complex, may feel less smooth than native drag, higher latency

## Recommended Implementation

**Phase 1 - Quick Fix (Solution 2)**:
Apply CSS changes immediately as they're low-risk and may partially mitigate the issue.

**Phase 2 - Proper Fix (Solution 1)**:
Implement the position snapping after drag completion. This addresses the root cause while maintaining native drag performance.

## Files to Modify

1. `src/index.css` - Add GPU acceleration hints (Solution 2)
2. `src/components/simple-task/simple-task-window.tsx` - Add position snap after drag
3. `src-tauri/src/panels.rs` - Add `snap_simple_task_panel_position` function
4. `src-tauri/src/lib.rs` - Register new Tauri command

## Testing Plan

1. Open simple-task panel
2. Drag the panel around - observe text clarity during and after drag
3. Verify text is crisp after drag completes
4. Test on both standard and Retina displays (different scale factors)
5. Ensure resize still works correctly
6. Verify no performance degradation during drag

## References

- Tauri NSPanel: https://github.com/nicholaslee119/tauri-nspanel
- WebKit subpixel rendering: https://webkit.org/blog/
- macOS window coordinate system: Uses Cocoa coordinates (origin at bottom-left)
