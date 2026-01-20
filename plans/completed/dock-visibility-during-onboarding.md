# Plan: Show App in Dock During Onboarding

## Problem

When users first launch Mort, the app starts in "Accessory" activation policy mode, which hides it from the macOS dock. The main window appears for onboarding, but without a dock icon, users may find it confusing - the app doesn't feel like a "real" app and there's no visual anchor point to return to if they accidentally click away.

When users later search "mort" in Spotlight (or use the tray icon) to open the main window, the app becomes visible in the dock via `show_main_window()`, which temporarily switches to "Regular" activation policy.

## Investigation Findings

### Current Behavior

**Activation Policy Control (src-tauri/src/lib.rs):**

1. **At startup (line 938-940):** App sets `ActivationPolicy::Accessory`
   ```rust
   let _ = app
       .handle()
       .set_activation_policy(ActivationPolicy::Accessory);
   ```

2. **When showing main window (line 357):** Switches to `ActivationPolicy::Regular`
   ```rust
   let _ = app.set_activation_policy(ActivationPolicy::Regular);
   ```

3. **When hiding main window (line 413):** Reverts to `ActivationPolicy::Accessory`
   ```rust
   let _ = app.set_activation_policy(ActivationPolicy::Accessory);
   ```

**Onboarding Flow (lines 1011-1017):**
```rust
} else {
    // User hasn't onboarded - show the main window for onboarding (unless skipped for dev)
    if !skip_main_window {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.show();
        }
    }
```

**The Bug:** During onboarding, the window is shown via `window.show()` directly, but the activation policy is NOT changed to Regular. This means:
- The window appears, but there's no dock icon
- This is different from when users trigger `show_main_window()` later (which does change the policy)

### macOS Activation Policies

| Policy | Dock Icon | App Switcher | Use Case |
|--------|-----------|--------------|----------|
| `Regular` | Yes | Yes | Normal app with visible presence |
| `Accessory` | No | No | Background utilities, menu bar apps |
| `Prohibited` | No | No | Agent apps that never appear |

Mort uses Accessory mode to behave like a Spotlight-style utility that stays hidden until summoned. However, during onboarding, users expect a more traditional app experience.

## Proposed Solution

Change the activation policy to `Regular` when showing the main window for onboarding, then keep it Regular until onboarding completes and the user hides the window.

### Implementation

**File:** `src-tauri/src/lib.rs`

**Option A: Set Regular policy during onboarding startup (Recommended)**

Change the onboarding branch (around lines 1011-1017) to:

```rust
} else {
    // User hasn't onboarded - show the main window for onboarding (unless skipped for dev)
    if !skip_main_window {
        // During onboarding, show the dock icon so the app feels like a real app
        // This helps new users understand they're interacting with a persistent application
        let _ = app.handle().set_activation_policy(ActivationPolicy::Regular);

        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.show();
        }
    }
    // ... rest of clipboard hotkey registration
}
```

This ensures:
1. The dock icon appears immediately when the app launches for onboarding
2. Users can click away and easily return to the app via the dock
3. Once onboarding completes and the user closes the window, `hide_main_window()` will revert to Accessory mode

**Option B: Also show dock icon for onboarded users on first launch**

If we want the dock icon to always appear on app launch (until the user explicitly hides the window), we could set Regular policy unconditionally when showing the main window at startup:

```rust
if !skip_main_window {
    // Show dock icon when main window is visible at startup
    let _ = app.handle().set_activation_policy(ActivationPolicy::Regular);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
    }
}
```

This would apply to both onboarded and non-onboarded users. The tradeoff is that existing users who expect the app to remain hidden would now see a dock icon on launch.

## Recommendation

**Go with Option A** - only show dock icon during onboarding. This:
- Solves the UX problem for new users
- Doesn't change behavior for existing users
- Maintains the "invisible utility" feel once onboarding is complete

## Testing

1. **Fresh install simulation**: Delete `~/.mort/settings/config.json` to reset onboarding state
2. **Launch app**: Verify dock icon appears
3. **Complete onboarding**: Verify dock icon remains while window is visible
4. **Close window**: Verify dock icon disappears (Accessory mode)
5. **Relaunch app**: Verify dock icon appears initially (onboarded users)
6. **Use spotlight hotkey**: Verify spotlight panel works without dock icon
7. **Search "Mort" in Spotlight**: Verify dock icon appears when main window opens

## Future Considerations

- Could add a user preference: "Keep Mort in Dock" that persists Regular mode
- Could use dock icon badge to show active task count
- Consider whether the app should remain in dock while tasks are running
