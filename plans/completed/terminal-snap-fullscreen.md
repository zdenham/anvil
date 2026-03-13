# Snap Terminal Panel to Full View

Allow dragging the terminal bottom panel all the way up to snap the content panels closed and fill the full view.

## Current Behavior

- Terminal panel has a `MAXIMIZE_THRESHOLD` of 85% of window height — dragging past it calls `maximizeTerminalPanel()` which sets `isMaximized: true`
- When `isMaximized`, the content zone is hidden (`!isMaximized && ...`) and the terminal gets `className="flex-1"`, but `ResizablePanelVertical` still uses `window.innerHeight` as `effectiveHeight`
- The `ResizablePanelVertical` component caps height at `maxHeight` (default 70% of window) — this **prevents** dragging past 70%, so the 85% maximize threshold is actually unreachable via normal drag
- The maximize feature exists in the store/service but the drag UX can't trigger it due to the max height cap

## Problem

There are two bugs working together:
1. `ResizablePanelVertical.getMaxHeight()` returns `window.innerHeight * 0.7`, which clamps before the 85% threshold
2. Even if that's fixed, the maximize behavior snaps at 85% but doesn't truly fill the view — it still uses pixel height rather than letting flexbox do the work

## Phases

- [x] Fix max height cap so dragging can reach the maximize threshold
- [x] Make maximized state truly fill the available space (account for titlebar/gutter)
- [ ] Add visual snap indicator when approaching the maximize threshold

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix max height cap

**File:** `src/components/terminal-panel/terminal-panel-layout.tsx`

- Pass an explicit `maxHeight` to `ResizablePanelVertical` that allows dragging up to (or past) the maximize threshold
- Use `window.innerHeight * 0.92` or similar so the drag range covers the 85% threshold
- Alternatively, remove the default 70% cap in `ResizablePanelVertical` and let the caller control it — the terminal layout already handles the maximize logic in `handleHeightChange`

**Recommended approach:** In `TerminalPanelResizable`, pass `maxHeight={Math.floor(window.innerHeight * 0.95)}` so the drag range extends well past the 85% maximize trigger. This is a one-line change.

## Phase 2: True full-space maximize

**File:** `src/components/terminal-panel/terminal-panel-layout.tsx`

When `isMaximized`:
- The content zone is already hidden (line 78: `!isMaximized && ...`) — good
- The `TerminalPanelResizable` wrapper should use `flex-1` to fill remaining space instead of a pixel height
- Currently `effectiveHeight = isMaximized ? window.innerHeight : height` — this is fragile because it doesn't account for titlebar/gutter height
- Change to: when maximized, don't pass a pixel height at all — use `flex-1` on the container and let it fill naturally
- The `ResizablePanelVertical` still needs a height prop for the drag handle to work, so keep `window.innerHeight` as the value but ensure the container's flex styling overrides it

The current code already does `className={isMaximized ? "flex-1" : ""}` which is correct. The main fix is ensuring `maxHeight` doesn't block the drag from triggering maximize.

## Phase 3: Visual snap indicator

When the user drags close to the maximize threshold, show a subtle visual cue (e.g., the resize handle line changes color/thickness, or a brief overlay) to indicate "release to maximize."

**File:** `src/components/ui/resizable-panel-vertical.tsx`

- Add an `onApproachMax` callback or a `nearMax` state
- In `terminal-panel-layout.tsx`, track when height is within ~5% of the threshold
- Show a subtle color change on the drag handle (e.g., accent color glow)

This phase is a nice-to-have polish — the core functionality works with just phases 1-2.
