# Fix NSToolbar regression — traffic lights shifted down + grey bar in fullscreen

## Problem

After adding the NSToolbar (per `fix-fullscreen-titlebar.md`), two regressions appeared:

1. **Traffic lights are too far down** — `NSWindowToolbarStyle::Unified` allocates a combined title+toolbar area that is taller than the plain overlay titlebar. The traffic lights get vertically centered in this taller region, shifting them down from their original position.
2. **Persistent grey bar in fullscreen** — the toolbar's baseline separator and background are visible as a grey strip, and the toolbar area persists instead of auto-hiding cleanly.

## Root cause

`NSWindowToolbarStyle::Unified` is designed for apps that put items *in* the toolbar (like Finder, Safari). For apps with an empty toolbar that just need the fullscreen reveal behavior, `Unified` adds unwanted height and visual artifacts.

---

## Phases

- [x] Fix attach_toolbar to eliminate visual artifacts (Rust + frontend)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix attach_toolbar

### Rust changes — `src-tauri/src/lib.rs`

In the `attach_toolbar` function, make these changes:

1. **Hide the baseline separator** — call `toolbar.setShowsBaselineSeparator(false)` before attaching. This removes the grey line at the bottom of the toolbar area.

2. **Switch from** `Unified` **to** `UnifiedCompact` — this uses the thinnest possible toolbar area, minimizing the height increase:

   ```rust
   ns_window.setToolbarStyle(NSWindowToolbarStyle::UnifiedCompact);
   ```

3. **Keep** `titleVisibility: Hidden` — already set, still needed.

The updated function should look like:

```rust
fn attach_toolbar(window: &tauri::WebviewWindow) {
    // ... existing handle/view/window boilerplate ...
    if let Some(ns_window) = ns_view.window() {
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let identifier = NSString::from_str("anvil-main-toolbar");
        let toolbar = NSToolbar::initWithIdentifier(NSToolbar::alloc(mtm), &identifier);
        toolbar.setShowsBaselineSeparator(false);  // ← NEW: hide grey separator
        ns_window.setToolbar(Some(&toolbar));
        ns_window.setToolbarStyle(NSWindowToolbarStyle::UnifiedCompact);  // ← CHANGED from Unified
        ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
    }
}
```

### Frontend changes — `src/components/window-titlebar/window-titlebar.tsx`

After the Rust change, verify the traffic light positions. `UnifiedCompact` with hidden title should place traffic lights very close to where they were with no toolbar at all. If they're still offset:

- Adjust `pl-[76px]` — decrease or increase the left padding to align with the new traffic light position. The exact value needs visual verification; `UnifiedCompact` typically shifts traffic lights down by \~2-4px compared to bare overlay, so the horizontal padding may stay the same but the `h-[32px]` titlebar height might need a small bump to `h-[36px]` to keep buttons vertically centered relative to the traffic lights.

### If `UnifiedCompact` still adds unwanted height

Nuclear option: remove `setToolbarStyle` entirely. The default toolbar style (`Automatic`) lets macOS pick the thinnest representation for a window with overlay titlebar and no toolbar items. This may resolve both issues with zero frontend changes needed.

### Verify

- Windowed mode: traffic lights are in the same position as before the NSToolbar was added
- Windowed mode: no visible grey line or extra spacing at the top
- Fullscreen mode: hovering at top triggers delayed reveal with system status items (clock, wifi, battery) — no persistent grey bar
- Panel toggle buttons remain clickable and unobscured in both modes