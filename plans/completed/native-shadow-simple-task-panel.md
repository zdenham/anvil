# Native Box Shadow for Simple Task Panel

## Overview

Improve the simple task panel's shadow to give it a more "native" floating appearance above other content.

## Investigation

### Initial Approach: Native macOS Shadow Only

We first tried enabling macOS native window shadow via `has_shadow(true)` in the NSPanel configuration.

**Result: Failed** - Native shadows on transparent windows follow the rectangular window bounds, not the content alpha. This caused a visible black rectangular border around the window, ignoring the rounded corners of the content.

### Why It Failed Initially

macOS `NSShadow` for windows is rendered by the window server based on window geometry, not content opacity. For transparent borderless windows with only CSS border-radius:
- The shadow renders around the full rectangular window frame
- It does NOT respect CSS border-radius or content transparency
- This creates an ugly rectangular outline around rounded content

## Solution: Native Corner Radius + Native Shadow

The key insight was to use the **native corner radius** via tauri-nspanel's `corner_radius()` API. This sets `wantsLayer = true` on the content view and applies the corner radius at the native layer level, which macOS then uses to calculate the shadow shape.

### Implementation

**File:** `src-tauri/src/panels.rs`

Added to the SimpleTaskPanel builder:
```rust
.has_shadow(true)
.corner_radius(12.0)
```

**File:** `src/index.css`

Removed CSS `border-radius` (now handled natively), kept the border for edge definition:
```css
.simple-task-container {
  background: var(--spotlight-bg);
  border: 1px solid var(--spotlight-border);
  cursor: default;
  user-select: none;
}
```

### Why This Works

1. **Native layer corner radius** - `corner_radius(12.0)` sets the corner radius on the NSView's CALayer
2. **macOS shadow calculation** - The window server uses the layer's shape (including corner radius) for shadow computation
3. **Proper rounded shadow** - Shadow now follows the rounded corners instead of rectangular bounds

## Summary

| Approach | Result |
|----------|--------|
| `has_shadow(true)` alone | ❌ Black rectangular border around window |
| `has_shadow(true)` + `corner_radius(12.0)` | ✅ Native shadow with rounded corners |

**Final changes:**
- `src-tauri/src/panels.rs`: Added `.has_shadow(true)` and `.corner_radius(12.0)` to panel builder
- `src/index.css`: Removed CSS `border-radius` from `.simple-task-container` (handled natively)
