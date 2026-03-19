# Fix: App Not Foregrounded on Startup + Onboarding Title Bar Not Draggable

## Problem

Two related startup UX issues:

1. **App not brought to foreground on launch** — window appears but doesn't get focus, so it can hide behind other windows.
2. **Title bar not draggable during onboarding** — users can't move the window until onboarding completes.

## Root Cause Analysis

### Issue 1: No `set_focus()` on startup

In `src-tauri/src/lib.rs` (~line 1162-1177), the startup code only calls `window.show()`:

```rust
// Onboarded path (line ~1165)
let _ = window.show();  // no set_focus()

// Onboarding path (line ~1176)
let _ = window.show();  // no set_focus()
```

Every *other* code path that shows the window properly calls both `show()` and `set_focus()`:
- `show_main_window()` command (line ~329-376)
- Tray menu "open_main" handler in `tray.rs` (line ~69-73)
- Tray double-click handler in `tray.rs` (line ~116-121)
- `RunEvent::Reopen` handler (line ~1203)

Additionally, for **onboarded users**, the activation policy stays `Accessory` (set at line ~1052), which prevents the app from naturally coming to the foreground. The onboarding path correctly sets `Regular`, but still misses `set_focus()`.

### Issue 2: No drag region in onboarding UI

The window uses `"titleBarStyle": "Overlay"` (in `tauri.conf.json`), which requires explicit `data-tauri-drag-region` attributes on HTML elements to make the title bar area draggable.

The `WindowTitlebar` component (`src/components/window-titlebar/window-titlebar.tsx`) correctly sets `data-tauri-drag-region` but is **only rendered inside `MainWindowLayout`** — never during onboarding.

`OnboardingFlow.tsx` has zero `data-tauri-drag-region` attributes anywhere in its tree.

## Phases

- [x] Add `set_focus()` and activation policy handling to startup paths in `lib.rs`
- [x] Add a draggable title bar region to the onboarding UI

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix startup foreground

**File:** `src-tauri/src/lib.rs`

In the startup `setup()` handler, after each `window.show()` call, add `window.set_focus()`:

**Onboarded path** (~line 1162):
```rust
if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    let _ = app.handle().set_activation_policy(ActivationPolicy::Regular);
    let _ = window.show();
    let _ = window.set_focus();
}
```

Note: we need to temporarily set `Regular` activation policy here too (matching what the onboarding path does), otherwise `set_focus()` won't work on macOS when the app is in `Accessory` mode. After the window is shown and focused, we can switch back to `Accessory` if that's the desired steady-state behavior — but check whether the existing `show_main_window()` command already handles this (it sets `Regular` and never reverts, so leaving it as `Regular` during initial show is fine).

**Onboarding path** (~line 1173):
```rust
// Already sets Regular activation policy above this
if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    let _ = window.show();
    let _ = window.set_focus();
}
```

## Phase 2: Add drag region to onboarding

**File:** `src/components/onboarding/OnboardingFlow.tsx`

Add a draggable region to the top of the onboarding flow. The simplest approach is a thin transparent drag bar at the top that doesn't affect the visual design:

```tsx
return (
  <div data-testid="onboarding-flow" className="min-h-screen w-full bg-surface-900 p-6">
    {/* Draggable title bar region for window movement */}
    <div
      data-tauri-drag-region
      className="fixed top-0 left-0 right-0 h-8 z-20"
    />

    {/* rest of existing content unchanged */}
  </div>
);
```

This adds a fixed 32px-tall invisible drag region across the top of the window — matching the height of the overlay title bar. It uses `z-20` to sit above other content. The macOS traffic light buttons (close/minimize/maximize) will still work since they're native controls above the webview layer.

**Alternative:** If a visible title bar is preferred during onboarding, render `<WindowTitlebar breadcrumb="" />` at the top instead. But the invisible approach is simpler and doesn't change the onboarding visual design.
