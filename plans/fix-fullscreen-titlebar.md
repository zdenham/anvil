# Fix fullscreen titlebar overlap with panel toggle buttons

## Diagnosis

The main window uses `titleBarStyle: "Overlay"` (`tauri.conf.json:18`) and enables `FullScreenPrimary` collection behavior (`lib.rs:56-77`), but **never attaches an NSToolbar** to the NSWindow.

Without an NSToolbar, macOS shows a minimal grey strip with only the app menu on fullscreen hover. The reveal is fast with a short hover delay, causing it to overlap the panel toggle buttons in `WindowTitlebar` before the user can react.

With an NSToolbar (what Cursor, VS Code, etc. do), macOS shows the full unified title/toolbar area with system status items, using a **delayed, slower reveal animation**. This gives users time to move away from the toolbar zone — no extra frontend padding needed.

The current "no NSToolbar" setup isn't intentional — it's just Tauri's default. The `enable_fullscreen_button` function was added to enable the green button, and an NSToolbar was never added alongside it.

---

## Phases

- [x] Add NSToolbar to the main window (Rust)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add NSToolbar to the main window

**File: `src-tauri/src/lib.rs`**

Create a new function `attach_toolbar(window)` following the same pattern as `enable_fullscreen_button` (lines 54-82):

1. Get the NSWindow from the raw window handle via `HasWindowHandle` → `NSView` → `.window()`
2. Create an empty `NSToolbar` with identifier `"mort-main-toolbar"`
3. Set `toolbarStyle` to `NSWindowToolbarStyle::Unified` (merges with titlebar area)
4. Set `titleVisibility` to `NSWindowTitleVisibility::Hidden` (no title string)
5. Attach via `setToolbar:`

Call `attach_toolbar(&window)` right after `enable_fullscreen_button(&window)` in **both** code paths:
- Initial window setup (`lib.rs:~1152`)
- Window recreation in `show_main_window` (`lib.rs:~365`)

**Cargo.toml**: Add `"NSToolbar"` to the `objc2-app-kit` features list (lines 57-65). `NSToolbarItem` is not needed since we're creating an empty toolbar.

### Why this is safe

- **Windowed mode**: `Overlay` titlebar + empty `Unified` toolbar with hidden title = the toolbar is invisible. No visual change. This is the same combination Cursor uses.
- **Fullscreen mode**: The toolbar gives macOS the signal to use the full unified reveal with system status items (clock, wifi, battery) and the slower animation delay.
- **Traffic lights**: Position unchanged — `Unified` style keeps them in the same spot. The existing `pl-[76px]` padding in `WindowTitlebar` remains correct.
- **No frontend changes needed**: The delayed reveal animation is sufficient to prevent overlap. Other apps (Cursor, VS Code) don't add extra padding either.

### Fallback

If `Unified` adds any unwanted visual space in windowed mode (unlikely with an empty toolbar + hidden title), switch to `UnifiedCompact` for an even thinner presence.

### Verify

- Windowed mode: titlebar looks identical to before (traffic lights, drag region, panel toggles all in same positions)
- Fullscreen mode: hovering at top shows the full system bar (clock, wifi, battery) with delayed reveal instead of the quick grey strip
- Panel toggle buttons remain clickable in fullscreen without being obscured
