# Fix: Always Show App in Dock

## Problem

The app uses `ActivationPolicy::Accessory` as its default, which hides the dock icon. It only switches to `ActivationPolicy::Regular` (dock visible) temporarily when the main window is shown, then reverts to `Accessory` when the main window is hidden or closed. This makes the app feel like an ephemeral background utility rather than a real application.

## Root Cause

The activation policy toggling was designed for a "spotlight-first" UX where the app lives in the menu bar and only shows a dock icon when the main window is open. Now that the app should feel like a standard macOS application, it should always appear in the dock.

## Phases

- [x] Remove Accessory activation policy and default to Regular
- [x] Clean up redundant activation policy switches
- [x] Verify no regressions in spotlight/panel behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove Accessory activation policy and default to Regular

**File: `src-tauri/src/lib.rs`**

1. **Line ~1103-1106** — Change the startup activation policy from `Accessory` to `Regular`:
   ```rust
   // Before:
   // Set activation policy to Accessory for proper panel behavior
   let _ = app.handle().set_activation_policy(ActivationPolicy::Accessory);

   // After:
   // Show app in dock by default
   let _ = app.handle().set_activation_policy(ActivationPolicy::Regular);
   ```

2. **Line ~609-610** (`hide_main_window`) — Remove the revert to Accessory:
   ```rust
   // Remove this line:
   let _ = app.set_activation_policy(ActivationPolicy::Accessory);
   ```

3. **Line ~962-967** (close handler on main window) — Remove the revert to Accessory:
   ```rust
   // Remove these lines:
   // Revert to Accessory mode when main window is hidden
   let _ = window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
   ```

## Phase 2: Clean up redundant activation policy switches

Since the app now always stays in `Regular` mode, all the places that temporarily switch to `Regular` before showing windows are now redundant and can be removed for clarity:

**File: `src-tauri/src/lib.rs`**
- `show_main_window` (~line 500): Remove `set_activation_policy(Regular)` and the `use tauri::ActivationPolicy` import
- `show_main_window_with_view` (~line 563): Same cleanup
- Startup onboarding path (~line 1278): Remove redundant `set_activation_policy(Regular)`
- Startup onboarded path (~line 1266): Remove redundant `set_activation_policy(Regular)`

**File: `src-tauri/src/tray.rs`**
- `handle_menu_event` "open_main" (~line 70): Remove `set_activation_policy(Regular)`
- `handle_menu_event` "settings" (~line 78): Remove `set_activation_policy(Regular)`
- `handle_tray_event` double-click (~line 121): Remove `set_activation_policy(Regular)`

After this cleanup, only the single `set_activation_policy(Regular)` at startup remains.

## Phase 3: Verify no regressions in spotlight/panel behavior

The spotlight and clipboard panels are separate windows that show/hide independently. They should not be affected by the activation policy change since they use their own show/hide logic. However, verify:

- **Spotlight panel**: Should still appear/disappear correctly on tray click. The panel behavior (floating above other windows, dismissing on blur) is controlled by window properties, not activation policy.
- **Clipboard panel**: Same as spotlight.
- **Main window close**: Should hide (not quit) the app. The close handler at ~line 962 already calls `api.prevent_close()` and `window.hide()` — just remove the Accessory policy switch.
- **Cmd+Q / Quit**: Should still work as normal via tray menu or app menu.

## Risk Assessment

**Low risk.** The `Accessory` policy was the source of the problem. The spotlight/clipboard panels use their own window-level properties (panel type, floating, etc.) for their behavior — they don't depend on the app-level activation policy being `Accessory`. The completed plans in `plans/completed/` confirm the Accessory mode was added specifically for "proper panel behavior" but this was a premature assumption — panels work fine under `Regular` policy.
