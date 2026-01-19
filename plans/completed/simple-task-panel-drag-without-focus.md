# Simple Task Panel: Drag Without Focus Fix

## Problem Statement

The simple task panel requires two clicks to drag: one to focus the panel, and another to initiate the drag. Other apps like ChatGPT's spotlight panel allow dragging immediately without needing to focus the window first.

**Historical Note:** Native dragging via `setMovableByWindowBackground(true)` was previously attempted but did not work for the Simple Task Panel, even though it works correctly for the Task Panel and Tasks List Panel.

## Deep Investigation: Why Native Dragging Fails

### Understanding `setMovableByWindowBackground(true)`

This macOS API allows windows to be dragged by clicking on their "background". However, **the "background" is not what you might expect with WebViews**:

1. **WKWebView fills the entire window** - In a Tauri app, the WebView content (HTML/CSS) occupies the full window. There is no native "window background" exposed.

2. **Mouse events flow to the WebView first** - WKWebView intercepts all mouse events before the window can process them for drag detection.

3. **The "background" is the WebView itself** - For `setMovableByWindowBackground` to work, the WebView must NOT consume the mouseDown event, allowing it to bubble up to the window level.

### Root Cause: First Click Activation Problem

On macOS, when a window is not the "key window" (focused), the first click on it typically just activates the window without propagating the click event to content. This is standard macOS behavior documented in [wry issue #637](https://github.com/tauri-apps/wry/issues/637).

The solution is `acceptsFirstMouse` - an NSView property that allows views to receive clicks in inactive windows while simultaneously activating the window.

### Why `startDragging()` Fails on Unfocused Panels

The React `onMouseDown` handler calling `startDragging()` fails because:

1. `startDragging()` is a Tauri API that requires the window to be the **key window** (focused)
2. With `no_activate: true`, the panel doesn't become key window on click
3. First click activates but doesn't propagate → `startDragging()` never executes properly

## Recommended Solution: `accept_first_mouse(true)` + Keep `startDragging()`

### Why This Combination Should Work

| Component | Purpose |
|-----------|---------|
| `accept_first_mouse(true)` | Makes the WebView receive mouse events even when window is unfocused |
| `startDragging()` in React | Initiates the drag operation when mouseDown fires |
| `setMovableByWindowBackground(true)` | Backup native dragging (may or may not help with WebViews) |

### Technical Analysis

**tauri-nspanel compatibility:** The `PanelBuilder` exposes `.with_window()` which provides full access to Tauri's `WebviewWindowBuilder`. The `accept_first_mouse()` method is available on `WebviewWindowBuilder` ([docs](https://docs.rs/tauri/2.2.0/tauri/webview/struct.WebviewWindowBuilder.html)).

**Known limitations:** According to [Tauri issue #6781](https://github.com/tauri-apps/tauri/issues/6781), `acceptFirstMouse` doesn't always work consistently depending on how the window is toggled (left-click vs right-click context menu). However, for our use case (clicking directly on the panel), it should work.

**Why keep `startDragging()`:** The `setMovableByWindowBackground` mechanism may not work reliably with WebViews because the WebView consumes mouse events. Having `startDragging()` in React gives us explicit control over when dragging initiates.

### Implementation

**File:** `src-tauri/src/panels.rs`

```rust
// In create_simple_task_panel function
let panel = PanelBuilder::<_, SimpleTaskPanel>::new(app, SIMPLE_TASK_LABEL)
    .url(WebviewUrl::App("simple-task.html".into()))
    .size(Size::Logical(LogicalSize::new(
        SIMPLE_TASK_WIDTH,
        SIMPLE_TASK_HEIGHT,
    )))
    .position(Position::Logical(LogicalPosition::new(x, y)))
    .level(PanelLevel::ScreenSaver)
    .collection_behavior(
        CollectionBehavior::new()
            .move_to_active_space()
            .full_screen_auxiliary(),
    )
    .style_mask(StyleMask::empty().borderless().resizable().nonactivating_panel())
    .has_shadow(false)
    .hides_on_deactivate(false)
    .transparent(true)
    .no_activate(true)
    .with_window(|w| {
        w.decorations(false)
            .resizable(true)
            .visible(false)
            .transparent(true)
            .title("simple-task")
            .accept_first_mouse(true)  // <-- ADD THIS LINE
    })
    .build()?;
```

**File:** `src/components/simple-task/simple-task-window.tsx`

Keep the existing `handleWindowDrag` and `onMouseDown` handler as-is. With `accept_first_mouse(true)`, the mouseDown event should now fire on the first click even when the panel is unfocused.

### Expected Behavior After Fix

1. User clicks outside the panel (panel loses focus)
2. User clicks on panel background to drag
3. `accept_first_mouse(true)` allows the click to pass through to WebView
4. React `onMouseDown` fires → `startDragging()` executes
5. Panel starts dragging immediately

## Fallback: If `accept_first_mouse` Doesn't Work

If the Tauri config doesn't work with NSPanels, we can use objc2 to set `acceptsFirstMouse` directly on the NSView:

```rust
// After panel creation
unsafe {
    use objc2::msg_send;
    use objc2_app_kit::NSView;

    let ns_panel = panel.as_panel();
    let content_view: &NSView = msg_send![ns_panel, contentView];

    // Note: acceptsFirstMouse is a method that returns BOOL, not a property we can set.
    // We may need to subclass or use method swizzling.
    // Alternative: Call setAcceptsMouseMovedEvents:YES on the window
    let _: () = msg_send![ns_panel, setAcceptsMouseMovedEvents: true];
}
```

However, `acceptsFirstMouse:` is an instance method that needs to be overridden (returns `YES`/`NO` for a given event), not a property. This makes native implementation more complex.

## Alternative: Focus-Then-Drag Pattern

If native solutions fail, modify the React handler to explicitly focus before dragging:

```typescript
const handleWindowDrag = useCallback(async (e: React.MouseEvent) => {
  if (e.button !== 0) return;

  const target = e.target as HTMLElement;
  if (target.closest('button, input, textarea, a, [role="button"], [contenteditable="true"]')) {
    return;
  }

  e.preventDefault();
  const window = getCurrentWindow();

  // Always focus first, then drag
  await invoke("focus_simple_task_panel");
  await window.startDragging();
}, []);
```

This defeats the purpose of `no_activate: true` but guarantees dragging works.

## Test Procedure

1. Build and run the app with the `accept_first_mouse(true)` change
2. Open the simple task panel
3. Click on another application or the desktop to unfocus the panel
4. Click and hold on the panel's background (not on buttons/inputs)
5. **Expected:** Panel should start dragging on the first click
6. **Current behavior:** Panel gains focus on first click, requires second click to drag

## References

- [Tauri Issue #11605: Can't drag data-tauri-drag-region when window not focused](https://github.com/tauri-apps/tauri/issues/11605) - Confirmed `acceptFirstMouse` as solution
- [Tauri Issue #6781: acceptFirstMouse config doesn't always work](https://github.com/tauri-apps/tauri/issues/6781) - Known edge cases
- [Wry Issue #637: First click not propagated](https://github.com/tauri-apps/wry/issues/637) - Root cause explanation
- [Tauri WebviewWindowBuilder.accept_first_mouse](https://docs.rs/tauri/2.2.0/tauri/webview/struct.WebviewWindowBuilder.html) - API documentation
- [tauri-nspanel repository](https://github.com/ahkohd/tauri-nspanel) - Panel builder with `.with_window()` passthrough
- [Apple: acceptsFirstMouse](https://developer.apple.com/documentation/appkit/nsview/1483410-acceptsfirstmouse) - Native macOS documentation
