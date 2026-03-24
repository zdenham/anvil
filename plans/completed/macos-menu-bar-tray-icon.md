# macOS Menu Bar Tray Icon Implementation Plan

## Overview

Implement a persistent macOS menu bar icon (system tray) that:
1. Displays the Anvil logo in the menu bar
2. Opens the spotlight panel when clicked
3. Provides a right-click menu with quick actions

## Current Architecture

- **Tauri Version**: 2.x with `macos-private-api` feature enabled
- **Existing Panels**: Spotlight, Clipboard, Error, Control Panel, Inbox List (using `tauri-nspanel`)
- **Spotlight Toggle**: Currently triggered via global hotkey (`toggle_spotlight()` in `panels.rs`)
- **Menu System**: Existing app menu in `menu.rs` using Tauri 2.x native menu API

## Implementation Steps

### 1. Enable the `tray-icon` Feature

**File**: `src-tauri/Cargo.toml`

Add `tray-icon` to the Tauri features:

```toml
tauri = { version = "2", features = ["protocol-asset", "macos-private-api", "devtools", "tray-icon"] }
```

### 2. Create Menu Bar Icon Asset

**File**: `src-tauri/icons/tray-icon.png`

Create a dedicated menu bar icon:
- **Size**: 22x22 pixels (44x44 for @2x Retina)
- **Format**: PNG with transparency
- **Style**: Monochrome/template icon for macOS (follows system light/dark mode)

#### Available Source Icons

Pre-extracted icon assets are available in the project root:
- **`icon-black.png`** - Black Anvil face on transparent background (for template icons)
- **`icon-white.png`** - White Anvil face on transparent background

The black version (`icon-black.png`) is already in the correct format for macOS template icons - black shapes on transparent background.

#### Icon Generation Script

**Script**: `scripts/generate-tray-icon.sh`

```bash
#!/bin/bash
# Generate macOS menu bar template icons from icon-black.png
# Requires: ImageMagick (brew install imagemagick)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$PROJECT_ROOT/src-tauri/icons"
SOURCE_ICON="$PROJECT_ROOT/icon-black.png"

echo "Generating tray icons from $SOURCE_ICON..."

# Generate 22x22 (1x) version
magick "$SOURCE_ICON" \
  -trim +repage \
  -resize 22x22 \
  -gravity center -background transparent -extent 22x22 \
  "$ICONS_DIR/tray-icon.png"

echo "Created tray-icon.png (22x22)"

# Generate 44x44 (2x Retina) version
magick "$SOURCE_ICON" \
  -trim +repage \
  -resize 44x44 \
  -gravity center -background transparent -extent 44x44 \
  "$ICONS_DIR/tray-icon@2x.png"

echo "Created tray-icon@2x.png (44x44)"

# Verify the output
echo ""
echo "Generated icons:"
ls -la "$ICONS_DIR"/tray-icon*.png

echo ""
echo "Done! Template icons created for macOS menu bar."
echo "Note: These icons use black shapes on transparent background."
echo "macOS will automatically invert colors for light/dark mode when icon_as_template(true) is set."
```

**Why Template Icons?**

macOS template icons are special:
- Use **black** shapes on **transparent** background
- macOS automatically applies system vibrancy and inverts for dark mode
- Ensures the icon always looks native and consistent with other menu bar icons
- Set via `icon_as_template(true)` in Tauri's TrayIconBuilder

#### Icon Requirements Summary

| File | Size | Content |
|------|------|---------|
| `tray-icon.png` | 22x22 | Black Anvil face silhouette on transparent |
| `tray-icon@2x.png` | 44x44 | Same, for Retina displays |

### 3. Create Tray Module

**File**: `src-tauri/src/tray.rs`

```rust
//! System tray (menu bar) icon and menu implementation.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::panels;

/// Initializes the system tray icon with menu.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    // Build the tray menu
    let menu = build_tray_menu(app)?;

    // Create the tray icon
    // Using the default window icon, but can be customized with a dedicated tray icon
    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true) // macOS: render as template (adapts to light/dark mode)
        .menu(&menu)
        .menu_on_left_click(false) // Left click opens spotlight, not menu
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    tracing::info!("[Tray] System tray icon initialized");
    Ok(())
}

/// Builds the tray icon right-click menu.
fn build_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let open_spotlight = MenuItem::with_id(app, "open_spotlight", "Open Spotlight", true, None::<&str>)?;
    let open_clipboard = MenuItem::with_id(app, "open_clipboard", "Clipboard History", true, None::<&str>)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let open_main = MenuItem::with_id(app, "open_main", "Open Anvil", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Anvil", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_spotlight,
            &open_clipboard,
            &separator1,
            &open_main,
            &settings,
            &separator2,
            &quit,
        ],
    )?;

    Ok(menu)
}

/// Handles tray menu item clicks.
fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();
    tracing::debug!("[Tray] Menu event: {}", id);

    match id {
        "open_spotlight" => {
            let _ = panels::show_spotlight(app.app_handle());
        }
        "open_clipboard" => {
            let _ = panels::show_clipboard(app.app_handle());
        }
        "open_main" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "settings" => {
            // Open main window and navigate to settings
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("navigate", "settings");
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {
            tracing::warn!("[Tray] Unknown menu item: {}", id);
        }
    }
}

/// Handles tray icon click events.
fn handle_tray_event<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => {
            // Left click: toggle spotlight
            tracing::debug!("[Tray] Left click - toggling spotlight");
            panels::toggle_spotlight(tray.app_handle());
        }
        TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            // Double-click: open main window
            tracing::debug!("[Tray] Double-click - opening main window");
            if let Some(window) = tray.app_handle().get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {
            // Right-click shows menu automatically (handled by Tauri)
        }
    }
}
```

### 4. Register the Tray Module

**File**: `src-tauri/src/lib.rs`

Add module declaration and initialization:

```rust
// Add to module declarations at the top
#[cfg(target_os = "macos")]
mod tray;

// In the Builder::default().setup() closure, add after panel creation:
#[cfg(target_os = "macos")]
{
    if let Err(e) = tray::init(&app.handle()) {
        tracing::error!("[Tray] Failed to initialize system tray: {:?}", e);
    }
}
```

### 5. Generate and Use Template Icon

After generating the template icons (see Step 2), update `tray.rs` to use them:

```rust
use tauri::image::Image;

/// Initializes the system tray icon with menu.
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Build the tray menu
    let menu = build_tray_menu(app)?;

    // Load custom tray icon (embedded at compile time)
    // Using include_bytes! ensures the icon is bundled with the binary
    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    // Create the tray icon
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true) // IMPORTANT: Enables macOS template behavior
        .tooltip("Anvil") // Shows on hover
        .menu(&menu)
        .menu_on_left_click(false) // Left click opens spotlight, not menu
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    tracing::info!("[Tray] System tray icon initialized");
    Ok(())
}
```

**Key Points:**
- `include_bytes!` embeds the icon in the binary at compile time
- `icon_as_template(true)` tells macOS to treat it as a template icon
- macOS will automatically handle light/dark mode color adaptation
- The @2x version is automatically used on Retina displays if named correctly

### 6. Handle Activation Policy (Important)

The existing codebase already manages `ActivationPolicy` for showing/hiding the dock icon. The tray icon should work independently:

- When tray icon is clicked, the spotlight appears (no dock icon needed)
- When main window is opened, dock icon appears
- This behavior is already implemented in the existing code

No additional changes needed - the current `ActivationPolicy` management in `lib.rs` handles this.

## File Changes Summary

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tray-icon` feature |
| `src-tauri/src/tray.rs` | New file - tray implementation |
| `src-tauri/src/lib.rs` | Add `mod tray` and init call |
| `src-tauri/icons/tray-icon.png` | New file - 22x22 menu bar icon |
| `src-tauri/icons/tray-icon@2x.png` | New file - 44x44 Retina menu bar icon |
| `scripts/generate-tray-icon.sh` | New file - icon generation script (ImageMagick) |

### Generation Steps

1. Install ImageMagick if not present: `brew install imagemagick`
2. Run the generation script: `./scripts/generate-tray-icon.sh`
3. Verify icons look correct in `src-tauri/icons/`

**Source files**: The script uses `icon-black.png` (black Anvil face on transparent background) from the project root. This file is already in the correct format for macOS template icons.

## Behavior Summary

| Action | Result |
|--------|--------|
| Left-click tray icon | Toggle spotlight panel |
| Double-click tray icon | Open main window |
| Right-click tray icon | Show context menu |
| Menu: "Open Spotlight" | Show spotlight panel |
| Menu: "Clipboard History" | Show clipboard panel |
| Menu: "Open Anvil" | Show main window |
| Menu: "Settings..." | Show main window, navigate to settings |
| Menu: "Quit Anvil" | Exit application |

## Testing Checklist

- [ ] Tray icon appears in menu bar after app launch
- [ ] Icon adapts to light/dark mode (if using template icon)
- [ ] Left-click toggles spotlight
- [ ] Right-click shows menu
- [ ] All menu items work correctly
- [ ] Double-click opens main window
- [ ] Tray persists when main window is closed
- [ ] Tray persists when all panels are hidden
- [ ] App quits properly from tray menu

## Future Enhancements

1. **Dynamic Icon**: Show different icons based on app state (e.g., notification badge)
2. **Tooltip**: Show app status on hover
3. **Keyboard Navigation**: Support keyboard shortcuts in tray menu
4. **Windows/Linux Support**: The current implementation is macOS-focused; can be extended for cross-platform support

## References

- [Tauri 2.x System Tray Documentation](https://v2.tauri.app/learn/system-tray/)
- [Tauri macOS Menubar App Example](https://github.com/ahkohd/tauri-macos-menubar-app-example)
- [Apple Human Interface Guidelines - Menu Bar Icons](https://developer.apple.com/design/human-interface-guidelines/macos/menus/menu-bar-extras/)
