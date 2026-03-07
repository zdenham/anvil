# Fix Terminal Resize Visual Artifacts

**Status: RESOLVED** — WebGL addon was the root cause.

## Problem

Terminal content flickered (disappeared for 1 frame, then repainted) during window/pane resize.

## Root cause

The **WebGL renderer** (`@xterm/addon-webgl`) clears its framebuffer whenever canvas dimensions change (WebGL spec requirement). xterm.js then defers the re-render to the next `requestAnimationFrame` via its internal `RenderDebouncer`. This creates a guaranteed 1-frame gap where the cleared canvas is visible on every resize event.

The canvas 2D renderer doesn't have this problem — it repaints synchronously within the same frame.

## Fix

Disabled the WebGL addon and switched to the canvas 2D renderer. The `@xterm/addon-webgl` import is commented out with an explanation of why and when to re-enable (xterm.js 6.1.0 stable, which includes [PR #5529](https://github.com/xtermjs/xterm.js/pull/5529) — a sync render after resize).

### Other changes retained (still beneficial)

- **Synchronous fit()** — `handleResize` calls `fitAddon.fit()` directly instead of deferring to rAF. Less latency regardless of renderer.
- **Resize threshold** — skips sub-pixel oscillations (< 3px) from `devicePixelContentBoxSize` rounding errors ([xterm.js #4922](https://github.com/xtermjs/xterm.js/issues/4922)). Prevents unnecessary resize churn.
- **CSS `contain: strict`** — isolates terminal layout from the deep flex hierarchy, reducing layout thrashing.

### What didn't work

- Removing rAF debounce alone — still flickered (WebGL was the real cause)
- Removing `preserveDrawingBuffer` — still flickered
- Resize threshold alone — still flickered (the real resizes, not oscillations, triggered the WebGL clear)

### Future: Re-enable WebGL

When `@xterm/xterm@6.1.0` stable is published:
1. `pnpm update @xterm/xterm @xterm/addon-webgl` (and other addons)
2. Uncomment the `WebglAddon` import and initialization block in `terminal-content.tsx`
3. Verify no flicker on resize

## Phases

- [x] Remove rAF debounce — call fit() synchronously in ResizeObserver callback
- [x] Remove `preserveDrawingBuffer` from WebglAddon constructor
- [x] Add CSS `contain: strict` to terminal container
- [x] Research — identified known xterm.js bug #4922, fixed in 6.1.0+
- [x] Apply resize threshold workaround (Option B) — did not fix alone
- [x] Diagnostic isolation — Test 1 confirmed WebGL renderer as root cause
- [x] Disable WebGL addon, clean up dead code and imports

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
