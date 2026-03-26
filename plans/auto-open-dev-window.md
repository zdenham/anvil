# Auto-open dev window on `pnpm dev`

## Problem

`pnpm dev` doesn't open the app window. The dev preset (`scripts/env-presets/dev.sh`) sets `ANVIL_SKIP_MAIN_WINDOW=1`, which tells `src-tauri/src/lib.rs` to skip showing the main window on startup. Previously developers used spotlight or tray to open it, but spotlight was removed.

## Root Cause

`scripts/env-presets/dev.sh` line 10:
```bash
export ANVIL_SKIP_MAIN_WINDOW=${ANVIL_SKIP_MAIN_WINDOW-1}
```

This defaults to `1` (skip). In `lib.rs:1217-1219`, any non-empty value causes the window to stay hidden.

## Phases

- [x] Change `ANVIL_SKIP_MAIN_WINDOW` default from `1` to empty in `scripts/env-presets/dev.sh`
- [x] Verify no other dev scripts or presets re-set this flag in a conflicting way

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### Change (single line)

**File:** `scripts/env-presets/dev.sh`

```diff
- export ANVIL_SKIP_MAIN_WINDOW=${ANVIL_SKIP_MAIN_WINDOW-1}
+ export ANVIL_SKIP_MAIN_WINDOW=${ANVIL_SKIP_MAIN_WINDOW-}
```

This changes the default from `1` (skip) to empty string (don't skip), while still allowing `ANVIL_SKIP_MAIN_WINDOW=1 pnpm dev` to suppress the window if desired.

### What happens after this change

In `lib.rs`, the startup logic at line ~1231 will execute:
```rust
if !skip_main_window {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        force_app_activation();  // macOS
    }
}
```

The window will auto-show and focus on `pnpm dev`.

### Headless mode preserved

`pnpm dev:headless` explicitly sets `ANVIL_SKIP_MAIN_WINDOW=1`, so that workflow is unaffected.
