# Zoom Shortcuts (Cmd+Plus / Cmd+Minus)

Add standard macOS zoom shortcuts so users can scale the UI with Cmd+=, Cmd+-, and Cmd+0.

## Approach

Use **Tauri's native** `Webview::set_zoom()` via menu accelerators. This scales the entire webview (including xterm.js terminals) without needing per-component font-size adjustments. Persist the zoom level in `AppConfig` so it survives restarts.

**Zoom steps:** 0.5 → 0.67 → 0.75 → 0.8 → 0.9 → 1.0 → 1.1 → 1.25 → 1.5 → 1.75 → 2.0 (matches Chrome/Electron conventions). Default: 1.0.

**Cmd+0 conflict:** Currently Cmd+0 fires quick-action slot 0. The native menu accelerator takes priority, so Cmd+0 will become "Reset Zoom" and quick-action slot 0 will no longer fire. This is acceptable — zoom reset is a stronger expectation for Cmd+0, and quick actions 1-9 still work.

## Phases

- [x] Add zoom state to config and Rust commands

- [x] Add zoom menu items with accelerators

- [x] Apply saved zoom on window creation

- [x] Apply zoom to panel windows

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add zoom state to config and Rust commands

`src-tauri/src/config.rs`

- Add `zoom_level: f64` field to `AppConfig` (default `1.0`, `#[serde(default = "default_zoom_level")]`)
- Add `get_zoom_level()` and `set_zoom_level()` helpers

`src-tauri/src/lib.rs`

- Add Tauri commands:
  - `zoom_in` — step zoom up, save to config, apply to all webview windows
  - `zoom_out` — step zoom down, save to config, apply to all webview windows
  - `zoom_reset` — set zoom to 1.0, save, apply
  - `get_zoom_level` — return current zoom level from config
- Helper: `apply_zoom_to_all_windows(app, level)` — iterates all open webview windows and calls `window.set_zoom(level)`
- Zoom step logic: define `ZOOM_LEVELS` array, find current index, step up/down

Register all three commands in `invoke_handler`.

## Phase 2: Add zoom menu items with accelerators

`src-tauri/src/menu.rs`

- Add to the View submenu (after Logs, before build):

  ```
  separator
  Zoom In    — accelerator "CmdOrCtrl+="  (id: "zoom_in")
  Zoom Out   — accelerator "CmdOrCtrl+-"  (id: "zoom_out")
  Reset Zoom — accelerator "CmdOrCtrl+0"  (id: "zoom_reset")
  ```

`src-tauri/src/lib.rs` (menu event handler, \~line 837)

- Add match arms for `"zoom_in"`, `"zoom_out"`, `"zoom_reset"` that call the zoom logic directly (same code as the Tauri commands, or factor into a shared function)

## Phase 3: Apply saved zoom on window creation

`src-tauri/src/lib.rs`

- In the startup/setup block where the main window is shown (\~line 1152), after getting the window:

  ```rust
  let zoom = config::load_config().zoom_level;
  if (zoom - 1.0).abs() > f64::EPSILON {
      let _ = window.set_zoom(zoom);
  }
  ```
- In `create_standalone_panel_window` (\~line 349): apply saved zoom after creating the webview window

## Phase 4: Apply zoom to panel windows

- The `apply_zoom_to_all_windows` helper from Phase 1 should iterate both the main window and any open panel windows
- Use `app.webview_windows()` to get all windows and apply zoom to each
- When a new panel window is created, apply the current zoom level from config

## Notes

- No frontend changes needed — webview zoom is transparent to the React app
- `set_zoom` takes a `f64` factor (1.0 = 100%, 1.5 = 150%, etc.)
- The quick-action hook at `src/hooks/use-quick-action-hotkeys.ts` won't need changes — native menu accelerators intercept before the JS keydown handler fires