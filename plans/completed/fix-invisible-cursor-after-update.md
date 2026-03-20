# Fix: Invisible Cursor / Broken Focus State After Update

## Problem

After updating the app via the shell script, the text cursor (caret) is not visible, CSS `:focus` styles don't render, and `:hover` states don't work. Typing still works (keystrokes are received). **Switching to another app and back fixes everything.**

## Root Cause

**The app is not properly activated at the macOS level after launch.**

The WKWebView is in a state where the window is "key" (receives keystrokes) but the app is not "active" from macOS's perspective. This means WKWebView's rendering layer doesn't process focus/hover states, even though events are forwarded for input.

Key evidence:

- Switching to another app and back triggers `NSApplicationDidBecomeActive`, which properly synchronizes the WKWebView — this is why it fixes the issue
- JS `window.blur(); window.focus()` does NOT fix it — JS focus APIs don't trigger native macOS app activation
- Typing works — the window IS the key window, just the app isn't "active"

This is the same class of bug as [tauri#11897](https://github.com/tauri-apps/tauri/issues/11897): *"the window has already gained focus, yet the webview has not."*

### Why it happens after every update

The update script runs:

```bash
killall mort                    # kill app (from backgrounded sh -c "curl|bash &")
open /Applications/Mort.app     # relaunch
```

The `open` command is executed from a **backgrounded shell process** (`sh -c "curl ... | bash &"` spawned by `shell.rs`). When macOS processes this:

1. The shell process (or Terminal) may retain activation status
2. `open` tells `launchd` to launch the app, but doesn't guarantee activation
3. The app starts and runs its setup:
   - `set_activation_policy(Accessory)` → no dock icon, definitely not active
   - Lots of initialization (\~200ms+)
   - `set_activation_policy(Regular)` → dock icon appears
   - `window.show()` + `window.set_focus()` → window appears, becomes key
4. But `NSApp.activate()` **is never called** — the app never becomes the "active" application
5. Result: key window (keystrokes work) but not active app (hover/focus/caret broken)

The startup code at `lib.rs:1244` does:

```rust
let _ = app.handle().set_activation_policy(ActivationPolicy::Regular);
let _ = window.show();
let _ = window.set_focus();
// ← Missing: NSApp.activate(ignoringOtherApps: true)
```

## Phases

- [x] Fix Rust startup: add NSApp.activate after showing main window

- [x] Fix update script: explicit activation after open

- [x] Harden show_main_window() for all launch paths

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add NSApp.activate to Rust Startup

The core fix. After showing and focusing the main window in `setup()`, explicitly activate the application.

In `src-tauri/src/lib.rs`, create a helper function:

```rust
/// Force macOS app activation to synchronize WKWebView focus state.
/// Without this, the window can be "key" (receives keystrokes) but the app
/// not "active" (hover/focus/caret don't render in the webview).
/// This happens when the app is launched via `open` from a background process.
/// See: https://github.com/tauri-apps/tauri/issues/11897
#[cfg(target_os = "macos")]
fn force_app_activation() {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new()
        .expect("force_app_activation must be called from main thread");
    let ns_app = NSApplication::sharedApplication(mtm);

    // activate(ignoringOtherApps:) is deprecated in macOS 14+
    // but NSApplication::activate() (no args) requires macOS 14+
    // Use the deprecated version for broad compatibility
    #[allow(deprecated)]
    unsafe {
        ns_app.activateIgnoringOtherApps(true);
    }
}
```

**Note on API**: `objc2-app-kit` v0.3 exposes `activateIgnoringOtherApps(_:)` on `NSApplication`. This is deprecated in macOS 14 in favor of `activate()`, but still works and is needed for pre-Sonoma compatibility. Check what `objc2-app-kit` 0.3 actually provides — it may be named `activateIgnoringOtherApps` or `activate_ignoring_other_apps` depending on the Rust naming convention. If the method isn't directly available, use raw `objc2::msg_send!`:

```rust
use objc2::msg_send;
unsafe { msg_send![&ns_app, activateIgnoringOtherApps: true] };
```

Add the `NSRunningApplication` feature to `Cargo.toml` if needed:

```toml
objc2-app-kit = { version = "0.3", features = [
  "NSWindow",
  "NSApplication",
  "NSRunningApplication",  # for activate APIs
  # ... existing features
] }
```

Then call it after showing the main window in both places:

```rust
// lib.rs setup(), after window.set_focus() (~line 1246 and ~1258):
let _ = window.show();
let _ = window.set_focus();
#[cfg(target_os = "macos")]
force_app_activation();
```

## Phase 2: Fix Update Script

In `scripts/installation/distribute_internally.sh`, replace the bare `open` with an activation sequence:

```bash
echo "Opening Mort..."
open /Applications/Mort.app

# Force activation - `open` from a backgrounded shell process doesn't
# reliably activate the app, leaving WKWebView in a broken focus state
sleep 2
osascript -e 'tell application "Mort" to activate' 2>/dev/null || true

echo "Done!"
```

Also add quarantine removal before launch to avoid Gatekeeper delays:

```bash
xattr -rd com.apple.quarantine /Applications/Mort.app 2>/dev/null || true
open /Applications/Mort.app
```

**Note**: Phase 1 should make Phase 2 unnecessary since the Rust code will self-activate on startup. But the script fix is good defense-in-depth, and also helps if there's a race where the activation fires before the webview is loaded.

## Phase 3: Harden show_main_window() for All Launch Paths

The `show_main_window()` function (`lib.rs:329`) is also called from:

- `RunEvent::Reopen` (clicking dock icon)
- Tray menu "Open Mort"
- Menu bar items

Add `force_app_activation()` there too:

```rust
fn show_main_window(app: AppHandle) -> Result<(), String> {
    use tauri::ActivationPolicy;
    let _ = app.set_activation_policy(ActivationPolicy::Regular);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        force_app_activation();
    }
    // ... rest of function
}
```

This ensures proper activation regardless of how the window is shown.

## Quick Verification

Before implementing, you can verify the diagnosis with this terminal command while the broken app is open:

```bash
osascript -e 'tell application "Mort" to activate'
```

If this immediately fixes the hover/focus/caret, the diagnosis is confirmed and the fix will work.

## Sources

- [tauri#11897 — "window has focus, webview has not"](https://github.com/tauri-apps/tauri/issues/11897) — exact symptoms
- [tao#208 — WebView doesn't respond until clicked](https://github.com/tauri-apps/tao/issues/208)
- [wry#184 — macOS Event Loop / Focus meta-bug](https://github.com/tauri-apps/wry/issues/184)
- [tauri#11340 — activate() crash on pre-macOS 14](https://github.com/tauri-apps/tauri/issues/11340) — API compatibility note
- [Apple docs — activate(ignoringOtherApps:)](https://developer.apple.com/documentation/appkit/nsapplication/1428468-activate)
- [Electron#14474 — Input cursor invisible after navigation](https://github.com/electron/electron/issues/14474)