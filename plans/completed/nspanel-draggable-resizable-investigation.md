# NSPanel Draggable & Resizable Investigation

## Summary

**Verdict: Fully feasible with NSPanel - infrastructure already exists**

The codebase already uses `tauri-nspanel` and has resizable panels implemented. Making the simple task panel draggable is straightforward with native macOS APIs.

---

## Background: NSPanel vs NSWindow

| Aspect | NSPanel | NSWindow |
|--------|---------|----------|
| Purpose | Floating palettes, utility windows | Main application windows |
| Floating | Floats above all windows (incl. fullscreen) | Standard window stack |
| Focus | Can be non-activating (won't steal focus) | Activates app on click |
| Window Menu | Does NOT appear in Window menu | Appears in Window menu |
| Main Window | Cannot be main window | Can be main window |

**Why NSPanel is ideal**: Built for auxiliary tool windows, floats above fullscreen apps, can be made non-activating.

---

## Current Implementation Status

### Already Working
- **Resizing**: All panels have `resizable(true)` - native corner resize handles work
- **NSPanel Integration**: Using `tauri-nspanel` v2.1 branch
- **Panel Configuration**: Proper StyleMask with `borderless().nonactivating_panel()`

### Panels in Codebase
| Panel | Size | Resizable |
|-------|------|-----------|
| Task Panel | 1200x800 | Yes |
| Simple Task Panel | 650x750 | Yes |
| Tasks List Panel | 600x500 | Yes |

---

## Making Panels Draggable

### Option A: Native `setIsMovableByWindowBackground` (Recommended)

```rust
// In panels.rs, after panel creation
panel.as_panel().setIsMovableByWindowBackground(true);
```

**Pros:**
- Works even when window is unfocused
- No frontend changes required
- Feels fully native macOS

**Cons:**
- Less granular control (entire background is draggable)
- May need to handle button/input areas separately

### Option B: HTML Drag Region

```tsx
<header data-tauri-drag-region className="...">
  {/* Header content */}
</header>
```

**Pros:**
- Selective drag areas (e.g., header only)
- Cross-platform compatible
- Framework-level support

**Cons:**
- Known macOS bug: Can't drag when window is unfocused (requires double-click)
- Double-tap to maximize doesn't work on macOS

### Option C: Hybrid (Best UX)

Combine both approaches:
1. Set `setIsMovableByWindowBackground(true)` for native fallback
2. Add `data-tauri-drag-region` to header for visual feedback
3. Use CSS cursor indicators (`cursor-grab`, `cursor-grabbing`)

---

## Implementation Plan

### Phase 1: Enable Native Dragging (Rust)

**File**: `src-tauri/src/panels.rs`

In `create_simple_task_panel()` (around line ~920-945), add after panel creation:

```rust
let ns_panel = panel.as_panel();
ns_panel.setIsMovableByWindowBackground(true);
```

### Phase 2: Add Visual Affordances (React)

Add drag region and cursor feedback to the panel header:

```tsx
<header
  data-tauri-drag-region
  className="flex items-center justify-between px-4 py-3
             bg-surface-800 border-b border-surface-700/50
             cursor-grab hover:bg-surface-700 active:cursor-grabbing"
>
  <h1 className="text-sm font-semibold">Task</h1>
  {/* Close button, etc */}
</header>
```

### Phase 3: Add Resize Indicator (Optional Polish)

With `decorations: false`, the native resize handle is in the corner but not visually obvious. Add a visual indicator:

```tsx
<div className="absolute bottom-0 right-0 w-5 h-5
               flex items-center justify-center text-surface-500/50
               text-xs cursor-nwse-resize hover:text-surface-500">
  ⟲
</div>
```

### Phase 4: Handle Edge Cases

1. **Remove auto-hide on blur** (if persistent panel desired):
   ```rust
   event_handler.window_did_resign_key(|_notification| {
     // Don't auto-hide - let user close explicitly
   });
   ```

2. **Escape key handler** for closing:
   ```tsx
   useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
       if (e.key === 'Escape') closePanel();
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, []);
   ```

---

## Technical Considerations

### Border Radius Issue
- Panels with `transparent(false)` don't show rounded corners properly
- Solution: Set `transparent(true)` and apply styling to inner container
- Reference: `plans/panel-border-radius-fix.md`

### Focus Management
- NSPanel with `non_activating_panel()` won't steal focus
- For explicit focus: use `show_and_make_key()`

### Drag Region Limitations on macOS
- Can't drag when unfocused (Tauri bug #11605) - workaround: double-click first
- Must apply `data-tauri-drag-region` to direct click target, not parents

---

## Files to Modify

1. **`src-tauri/src/panels.rs`**
   - Add `setIsMovableByWindowBackground(true)` for SimpleTaskPanel

2. **Frontend component** (likely `simple-task.tsx` or similar)
   - Add `data-tauri-drag-region` to header
   - Add visual resize indicator
   - Add cursor feedback styles

---

## Testing Checklist

- [ ] Panel can be dragged by clicking and holding anywhere on header
- [ ] Panel can be resized from corner (native handle)
- [ ] Panel stays visible when clicking outside
- [ ] Panel floats above fullscreen apps
- [ ] Panel doesn't steal focus from other apps
- [ ] Drag works even when app is in background
- [ ] Resize handle is discoverable
- [ ] Rounded corners display correctly (if fixed)
- [ ] Close button still works within drag region

---

## Risk Assessment

**Risk Level: LOW**

- No breaking changes required
- Can implement incrementally
- Fallback behavior (native corner resize) already works
- No new dependencies needed

---

## Resources

- [Apple NSPanel Documentation](https://developer.apple.com/documentation/appkit/nspanel)
- [tauri-nspanel GitHub](https://github.com/ahkohd/tauri-nspanel)
- [Tauri Window Customization](https://v2.tauri.app/learn/window-customization/)
- [NSWindow.StyleMask Reference](https://developer.apple.com/documentation/appkit/nswindow/stylemask)
