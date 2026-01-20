# Plan: macOS Native Menu Navigation & Cmd+, Settings Shortcut

## Problem

1. **No native macOS menu**: The Mort app currently has no custom native macOS menu bar. When the app is focused, users only see the default minimal menu without navigation options.

2. **Missing Cmd+, shortcut**: macOS convention dictates that Cmd+, should open the application's settings/preferences. Mort doesn't implement this standard shortcut.

## Goals

1. Add a native macOS menu bar with navigation items matching the sidebar tabs (Tasks, Worktrees, Settings, Logs)
2. Implement Cmd+, keyboard shortcut to navigate directly to the Settings page
3. Menu items should navigate the main window to the corresponding page when clicked

## Investigation Findings

### Current Architecture

**Main Window Navigation (`src/components/main-window/main-window-layout.tsx`):**
```typescript
export type TabId = "tasks" | "worktrees" | "logs" | "settings";

const [activeTab, setActiveTab] = useState<TabId>("tasks");
```

The main window uses simple React state to track the active tab. Pages are rendered conditionally based on `activeTab`.

**Sidebar Navigation (`src/components/main-window/sidebar.tsx`):**
```typescript
const navItems: NavItem[] = [
  { id: "tasks", label: "Tasks" },
  { id: "worktrees", label: "Worktrees" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" },
];
```

**Tauri Builder (`src-tauri/src/lib.rs`):**
- App is built using `tauri::Builder::default()` at line 712
- No menu configuration currently exists
- Setup function runs at lines 922-1034
- App uses `ActivationPolicy::Accessory` by default (no dock icon)

**Configuration (`src-tauri/tauri.conf.json`):**
- No `menu` configuration section exists
- Main window label is "main"

### Tauri 2.x Menu API

Tauri 2.x provides a menu module for creating native menus:
- `tauri::menu::Menu` - Main menu container
- `tauri::menu::Submenu` - Dropdown menus
- `tauri::menu::MenuItem` - Clickable items with optional accelerators
- `tauri::menu::PredefinedMenuItem` - Standard items (About, Quit, etc.)

Menu events are handled via `.on_menu_event()` on the builder.

## Implementation Plan

### Step 1: Create Menu Builder Module

**File:** `src-tauri/src/menu.rs` (new file)

Create a dedicated module for menu construction:

```rust
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "Mort")
        .item(&PredefinedMenuItem::about(app, Some("About Mort"), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("Services"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Mort"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Mort"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("nav_tasks", "Tasks")
                .build(app)?
        )
        .item(
            &MenuItemBuilder::with_id("nav_worktrees", "Worktrees")
                .build(app)?
        )
        .item(
            &MenuItemBuilder::with_id("nav_settings", "Settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?
        )
        .item(
            &MenuItemBuilder::with_id("nav_logs", "Logs")
                .build(app)?
        )
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimize"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    Ok(menu)
}
```

### Step 2: Register Menu in App Builder

**File:** `src-tauri/src/lib.rs`

1. Add module declaration:
```rust
mod menu;
```

2. Modify the builder setup to include menu:

In the `.setup()` closure, after panels are created:
```rust
// Build and set the application menu
let menu = menu::build_menu(app.handle())?;
app.set_menu(menu)?;
```

3. Add menu event handler:
```rust
.on_menu_event(|app, event| {
    let window = app.get_webview_window("main");
    match event.id().as_ref() {
        "nav_tasks" => {
            if let Some(w) = window {
                let _ = w.emit("navigate", "tasks");
            }
        }
        "nav_worktrees" => {
            if let Some(w) = window {
                let _ = w.emit("navigate", "worktrees");
            }
        }
        "nav_settings" => {
            if let Some(w) = window {
                let _ = w.emit("navigate", "settings");
            }
        }
        "nav_logs" => {
            if let Some(w) = window {
                let _ = w.emit("navigate", "logs");
            }
        }
        _ => {}
    }
})
```

### Step 3: Handle Navigation Events in Frontend

**File:** `src/components/main-window/main-window-layout.tsx`

Add Tauri event listener to respond to menu navigation:

```typescript
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

// Inside MainWindowLayout component:
useEffect(() => {
  const unlisten = listen<string>("navigate", (event) => {
    const tab = event.payload as TabId;
    if (["tasks", "worktrees", "logs", "settings"].includes(tab)) {
      setActiveTab(tab);
    }
  });

  return () => {
    unlisten.then((fn) => fn());
  };
}, []);
```

### Step 4: Ensure Main Window is Visible

When a navigation menu item is clicked, the main window should become visible if it's hidden.

**File:** `src-tauri/src/lib.rs`

Enhance the menu event handler:
```rust
"nav_tasks" | "nav_worktrees" | "nav_settings" | "nav_logs" => {
    // Show main window if hidden
    let _ = show_main_window(app.clone());

    // Emit navigation event
    if let Some(w) = app.get_webview_window("main") {
        let tab = event.id().as_ref().strip_prefix("nav_").unwrap_or("");
        let _ = w.emit("navigate", tab);
    }
}
```

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src-tauri/src/menu.rs` | New | Menu builder module |
| `src-tauri/src/lib.rs` | Modify | Add menu module, setup, and event handler |
| `src/components/main-window/main-window-layout.tsx` | Modify | Add navigation event listener |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+, | Navigate to Settings |
| Cmd+M | Minimize window |
| Cmd+W | Close/hide window |
| Cmd+Q | Quit application |
| Cmd+H | Hide Mort |

## Testing

1. **Menu appearance**: Launch app, verify "Mort", "View", and "Window" menus appear in menu bar
2. **Navigation items**: Click each View menu item, verify main window navigates to correct page
3. **Cmd+, shortcut**: Press Cmd+, while app is focused, verify Settings page opens
4. **Hidden window**: Hide main window, use menu item, verify window shows and navigates
5. **Standard items**: Test Cmd+Q quits, Cmd+H hides, Cmd+M minimizes
6. **Accessory mode**: Verify menu items still work when app is in Accessory mode (no dock icon)

## Edge Cases

1. **Menu visible in Accessory mode**: When the main window is hidden and app is in Accessory mode, the menu bar won't show Mort's menu (since another app has focus). Menu navigation only works when Mort is the active app.

2. **Panel focus**: When spotlight or other panels have focus, menu bar should still show Mort menus. Navigation should affect the main window, not panels.

3. **Onboarding state**: Menu items should work during onboarding. Navigating away from onboarding could be confusing - consider disabling navigation during onboarding or warning users.

## Future Considerations

- Add an "Edit" menu with standard Cut/Copy/Paste items
- Add a "Help" menu with documentation links
- Consider adding "File" menu with "New Task" item
- Add checkmarks to indicate current active tab in View menu
- Add "Open Spotlight" menu item with its global hotkey displayed
