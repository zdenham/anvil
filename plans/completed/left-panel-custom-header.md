# Move Left Panel Header Controls Next to Traffic Lights

Move the logo, refresh button, and three-dots menu to sit inline with (to the right of) the macOS close/minimize/expand traffic light buttons, creating a unified custom header row in the left panel.

## Current State

- **Main window** uses native macOS decorations (`decorations` defaults to `true` in `tauri.conf.json`)
- The macOS traffic lights (close/minimize/fullscreen) sit in the native titlebar area at the top-left
- `TreePanelHeader` renders **below** the native titlebar: logo, "ANVIL" title, spacer, then refresh/terminal/menu buttons
- The header has `pl-3 pr-2 py-2` padding and a bottom border
- In fullscreen mode, `pt-3` is added to the root layout to avoid the system menu bar
- There is no `data-drag-region` on the main window header (only on control panel headers)

## Goal

Place the header controls (logo, title, refresh, dots) on the **same row** as the traffic lights, to the right of them. This removes the wasted vertical space of the native titlebar above the tree panel header.

## Approach: `hiddenTitle` + Inset Traffic Lights

Tauri 2 on macOS supports `titleBarStyle: "overlay"` (or the Rust equivalent), which keeps native traffic lights but overlays them on the webview content. Combined with `title: ""` (already set), this gives us a transparent titlebar where the traffic lights float over our content.

### Why not `decorations: false`?

Removing decorations entirely means we'd need to implement our own traffic light buttons, window dragging, and fullscreen behavior. That's a much larger effort and loses native macOS feel. The overlay approach keeps native traffic lights and just lets us position content around them.

## Phases

- [x] Phase 1: Configure Tauri for overlay titlebar
- [x] Phase 2: Update TreePanelHeader layout to accommodate traffic lights
- [x] Phase 3: Add window drag region to the header
- [x] Phase 4: Handle fullscreen mode offset adjustment

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Configure Tauri for Overlay Titlebar

**File:** `src-tauri/tauri.conf.json`

Add `titleBarStyle` to the main window config:

```json
{
  "label": "main",
  "title": "",
  "titleBarStyle": "overlay",
  "width": 540,
  "height": 500,
  "visible": false,
  "maximizable": true,
  "resizable": true
}
```

This causes macOS to render the traffic lights **inside** the webview area, overlaid on our content. The traffic lights will sit at approximately `(8px, 6px)` from the top-left by default.

**Verify:** The `enable_fullscreen_button()` Rust code in `src-tauri/src/lib.rs` should still work — it modifies `NSWindowCollectionBehavior`, which is independent of titlebar style.

## Phase 2: Update TreePanelHeader Layout

**File:** `src/components/tree-menu/tree-panel-header.tsx`

The traffic lights on macOS with overlay titlebar occupy roughly **70px** from the left edge (3 buttons × ~20px + spacing). We need to:

1. Add left padding (~70-76px) to the header container to clear the traffic lights
2. Keep the header as a single horizontal row
3. Maintain existing right-side controls (refresh, terminal, dots)

Updated layout concept:

```
┌──────────────────────────────────────────────────┐
│ [●][●][●]  [Logo] ANVIL [DEV]  ──────  [↻] [⋯]  │
│  traffic    left-padded content        buttons   │
│  lights     ~70px offset                         │
└──────────────────────────────────────────────────┘
```

Changes to `tree-panel-header.tsx`:
- Change `pl-3` → `pl-[76px]` (or similar — the exact value needs visual tuning, macOS traffic lights are ~68px wide on standard resolution)
- Adjust vertical padding to align vertically with the traffic light center (~`py-1.5` or `h-[38px]` to match the standard macOS titlebar height of ~38px)
- May need to use `items-center` with a fixed height to ensure vertical centering with the traffic lights

**Platform consideration:** On non-macOS (if ever supported), the left padding should not be applied. Could use a CSS class or a platform check, but since Anvil is macOS-only currently, this can be a simple static value. Add a comment noting it's for traffic light clearance.

## Phase 3: Add Window Drag Region

**File:** `src/components/tree-menu/tree-panel-header.tsx`
**File:** `src/index.css` (already has `[data-drag-region="header"]` styles)

With `titleBarStyle: "overlay"`, the native titlebar drag area shrinks. We need to make the header draggable:

1. Add `data-drag-region="header"` to the header `<div>` — this already has CSS for `user-select: none` in `index.css:233`
2. The existing `use-window-drag.ts` hook checks for `[data-drag-region="header"]` and calls `startDragging()` — verify this hook is active in the main window (it may only be in control panel). If not active, either:
   - Add the hook to `MainWindowLayout`, or
   - Use Tauri's built-in `data-tauri-drag-region` attribute instead (simpler, no JS needed)

**Tauri's built-in approach:** Adding `data-tauri-drag-region` to an element makes it a native drag region automatically. This is the simpler option and doesn't require any JS hooks.

Interactive elements (buttons) inside the drag region should still work — Tauri's drag region ignores clicks on interactive elements by default.

## Phase 4: Handle Fullscreen Mode

**File:** `src/components/main-window/main-window-layout.tsx`

Currently, `isFullscreen ? "pt-3" : ""` adds top padding in fullscreen mode (line 703). With the overlay titlebar:

- In **windowed mode**: traffic lights are visible, header needs the ~76px left padding
- In **fullscreen mode**: traffic lights are hidden (macOS hides them behind the menu bar). The left padding is still fine (just empty space), but the header may need to be taller/shifted since the titlebar area collapses

Test both modes and adjust:
- The `pt-3` may need to change or be removed since our header now occupies the titlebar space
- In fullscreen, we may want to reduce the left padding since there are no traffic lights, or just leave it for simplicity

This phase is primarily visual tuning and testing.

## Risk Assessment

- **Low risk:** The overlay titlebar is a well-supported Tauri 2 feature on macOS
- **Medium risk:** Exact pixel values for traffic light clearance may vary between macOS versions and Retina/non-Retina displays — will need manual testing
- **Low risk:** Existing fullscreen button enablement code is independent of titlebar style
- **Consideration:** If the left panel is resized very narrow (<200px, the current minimum), the logo + traffic lights + buttons may not fit — may need to increase `minWidth` slightly or hide the title text at narrow widths
