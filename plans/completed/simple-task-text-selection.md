# Simple Task Panel: Text Selection vs Window Dragging

## Problem

Currently, it's impossible to select any text in the simple task panel because:

1. **CSS blocks selection**: `.simple-task-container` has `user-select: none` in `src/index.css`
2. **Drag captures all clicks**: The `onMouseDown` handler on the container initiates window dragging for any click on non-interactive elements
3. **Native drag behavior**: `setMovableByWindowBackground(true)` in Rust further enables dragging from anywhere

This creates a conflict - the same gesture (click + drag) is used for both text selection and window dragging.

## Current Implementation

```
User clicks anywhere on panel
  → handleWindowDrag() → startDragging() → window moves
```

Interactive elements (buttons, inputs, links) are excluded, but text content is not.

## Proposed Solution: Focus-Aware Drag Behavior

**Recommendation**: Use different drag behavior based on whether the panel is focused:

- **When unfocused**: Click anywhere to drag (current behavior) - enables quick repositioning
- **When focused**: Drag only from header, text selection enabled everywhere else

### Why This Approach?

1. **Best of both worlds**: Quick repositioning when unfocused, full text interaction when focused
2. **Intuitive UX**: First click to grab/move, subsequent interactions for content
3. **Familiar pattern**: Similar to how many utility panels and floating windows behave
4. **No lost functionality**: Dragging from anywhere still works, just requires the panel to be unfocused

### Behavior Matrix

| Panel State | Click on Header | Click on Content |
|-------------|-----------------|------------------|
| **Unfocused** | Drag window | Drag window |
| **Focused** | Drag window | Select text |

## Implementation Changes

### 1. Track focus state in React

**File**: `src/components/simple-task/simple-task-window.tsx`

```tsx
const [isFocused, setIsFocused] = useState(false);

// Listen for focus/blur events
useEffect(() => {
  const handleFocus = () => setIsFocused(true);
  const handleBlur = () => setIsFocused(false);

  window.addEventListener('focus', handleFocus);
  window.addEventListener('blur', handleBlur);

  // Check initial state
  setIsFocused(document.hasFocus());

  return () => {
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('blur', handleBlur);
  };
}, []);
```

### 2. Conditionally apply drag handler

**File**: `src/components/simple-task/simple-task-window.tsx`

```tsx
const handleWindowDrag = useCallback(async (e: React.MouseEvent) => {
  if (e.button !== 0) return;

  const target = e.target as HTMLElement;
  const interactiveSelector = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';
  if (target.closest(interactiveSelector)) return;

  // When focused, only drag from header area
  if (isFocused) {
    const isInHeader = target.closest('.simple-task-header');
    if (!isInHeader) return; // Allow text selection in content
  }

  // ... rest of drag logic (pin, startDragging, snap)
}, [isFocused]);
```

### 3. Conditionally apply CSS for text selection

**File**: `src/index.css`

```css
.simple-task-container {
  /* Remove user-select: none entirely */
}

/* Header is always a drag zone, never selectable */
.simple-task-header {
  user-select: none;
  cursor: grab;
}

/* Content allows selection - JS controls when dragging is allowed */
.simple-task-content {
  user-select: text;
  cursor: text;
}
```

Alternatively, use a CSS class toggled by focus state:

```css
/* When unfocused, disable selection everywhere */
.simple-task-container.unfocused {
  user-select: none;
  cursor: grab;
}

/* When focused, enable selection in content */
.simple-task-container.focused .simple-task-content {
  user-select: text;
  cursor: text;
}
```

### 4. Handle the native `setMovableByWindowBackground`

**File**: `src-tauri/src/panels.rs`

The native `setMovableByWindowBackground(true)` setting may need to be disabled since we're handling drag logic in JS. Test both approaches:

**Option A**: Remove it entirely, rely on JS `startDragging()`
```rust
// Remove this line
// panel.as_panel().setMovableByWindowBackground(true);
```

**Option B**: Keep it but ensure JS can prevent default behavior when focused

Testing will determine which approach works better with Tauri's event handling.

## Alternative Approaches Considered

### A. Header-only dragging (always)
- **Rejected**: Loses the convenience of quick repositioning from anywhere

### B. Modifier key for dragging
- Hold `Cmd/Ctrl` + click to drag
- **Rejected**: Not discoverable, non-standard UX

### C. Long-press to drag
- **Rejected**: Adds latency, feels sluggish

### D. Edge/border dragging only
- **Rejected**: Hard to target, poor UX

## Files to Modify

| File | Change |
|------|--------|
| `src/components/simple-task/simple-task-window.tsx` | Add focus state tracking, conditionally restrict drag to header |
| `src/index.css` | Remove global `user-select: none`, add focus-aware styles |
| `src-tauri/src/panels.rs` | Potentially remove `setMovableByWindowBackground(true)` |

## Testing Checklist

- [ ] **Unfocused panel**: Click anywhere starts drag
- [ ] **Unfocused panel**: First click focuses AND drags (or just drags?)
- [ ] **Focused panel**: Click on header starts drag
- [ ] **Focused panel**: Click on content starts text selection
- [ ] **Focused panel**: Can select text in assistant messages
- [ ] **Focused panel**: Can select text in code blocks
- [ ] **Focused panel**: Can copy selected text (Cmd+C)
- [ ] Buttons/inputs always work (not captured by drag)
- [ ] Panel pins correctly during drag
- [ ] Position snapping works after drag
- [ ] Focus state updates correctly on window focus/blur events

## Open Questions

1. **First click behavior**: When unfocused, should the first click:
   - Focus the panel AND start dragging? (current behavior with `accept_first_mouse`)
   - Just focus, requiring a second click to interact?

   Current recommendation: Keep `accept_first_mouse(true)` so first click drags immediately.

2. **Visual feedback**: Should there be a visual indicator of the current drag mode?
   - Cursor change (grab vs text cursor)
   - Subtle header highlight when it's the only drag zone?

## Ready to Implement

This approach preserves the quick "grab and reposition" workflow while enabling text selection during active use. The key insight is that focus state is a natural delimiter between "I want to move this" and "I want to interact with this."
