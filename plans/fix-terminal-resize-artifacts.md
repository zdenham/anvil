# Fix Terminal Resize Visual Artifacts

Stretch/compression and flicker during terminal resize.

## Symptoms

1. **Font stretch/compression** — terminal text visually distorts during resize
2. **Flicker** — terminal content disappears momentarily, showing the background color (not black)
3. **Re-render** — correct rendering after a beat

## Status: All attempted fixes have NOT resolved the issue

All of the following were tried and the flicker persists:
- Removed rAF debounce from `handleResize` — fit() now called synchronously
- Removed `preserveDrawingBuffer` from WebglAddon constructor
- Added `contain: strict` to terminal container
- Added resize threshold workaround (skip < 3px oscillations)

The xterm.js #4922 theory (sub-pixel `devicePixelContentBoxSize` oscillation) was plausible but our threshold workaround didn't fix it, suggesting the root cause is different or deeper.

## Next step: Diagnostic isolation (Option C)

We need to systematically comment out sections to find the actual cause. Each test should be done independently.

### Test 1: Comment out WebGL addon (most likely culprit)

Comment out lines 164-171 in `terminal-content.tsx` (the entire WebGL addon try/catch block). xterm.js falls back to its canvas renderer automatically.

```tsx
// --- DIAGNOSTIC: Comment out to test canvas renderer ---
// try {
//   const webglAddon = new WebglAddon();
//   webglAddon.onContextLoss(() => {
//     webglAddon.dispose();
//   });
//   terminal.loadAddon(webglAddon);
// } catch (err) {
//   logger.warn("[TerminalContent] WebGL addon failed to load, using canvas", {
//     error: err,
//   });
// }
```

**If flicker disappears** → WebGL renderer is the cause. Options:
- Stay on canvas renderer (simpler, still fast for terminal text)
- Wait for xterm.js 6.1.0 stable with the sync render fix
- Attempt to monkey-patch the WebGL renderer's resize path

**If flicker remains** → Not renderer-specific, proceed to Test 2.

### Test 2: Comment out ResizeObserver

Comment out the ResizeObserver creation + `.observe()` call (~line 245). Terminal won't resize but we'll know if the resize path itself causes the flicker.

**If flicker disappears** → The resize pipeline (fitAddon.fit → terminal.resize) is the source.
**If flicker remains** → Something in the initial render or output writing path.

### Test 3: Comment out PTY resize notification

Keep `fitAddon.fit()` but comment out the `terminalSessionService.resize()` call (~line 114). The terminal will visually resize but the PTY won't know, so no SIGWINCH will fire.

**If flicker disappears** → The PTY process redraws (triggered by SIGWINCH) are racing with xterm's own resize rendering, creating a double-render flicker.
**If flicker remains** → Not a PTY race condition.

### Test 4: Remove outer padding

Change `p-3` to `p-0` on the outer container div (~line 300). The padding creates a layout gap that might cause the inner div to resize in a separate layout pass.

**If flicker disappears** → CSS layout cascade from padding recalculation.

## Phases

- [x] Remove rAF debounce — call fit() synchronously in ResizeObserver callback
- [x] Remove `preserveDrawingBuffer` from WebglAddon constructor
- [x] Add CSS `contain: strict` to terminal container
- [x] Research — identified known xterm.js bug #4922, fixed in 6.1.0+
- [x] Apply resize threshold workaround (Option B) — did not fix
- [ ] Diagnostic isolation: run Tests 1-4 to identify root cause
- [ ] Implement targeted fix based on findings

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
