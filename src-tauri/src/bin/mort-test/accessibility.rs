use serde::Serialize;
use std::time::{Duration, Instant};

/// Information about a window
#[derive(Debug, Clone, Serialize)]
pub struct WindowInfo {
    pub title: String,
    pub owner_name: String,
    pub layer: i32,
    pub visible: bool,
}

/// Get windows for Mortician app using CoreGraphics window list API
pub fn get_mortician_windows() -> Vec<WindowInfo> {
    unsafe { get_windows_impl() }
}

unsafe fn get_windows_impl() -> Vec<WindowInfo> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;

    // Constants for CGWindowListOption
    const K_CG_WINDOW_LIST_OPTION_ALL: u32 = 0;
    const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;

    // Constants for window dictionary keys
    let k_cg_window_owner_name = CFString::new("kCGWindowOwnerName");
    let k_cg_window_name = CFString::new("kCGWindowName");
    let k_cg_window_layer = CFString::new("kCGWindowLayer");
    let k_cg_window_is_on_screen = CFString::new("kCGWindowIsOnscreen");

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(
            option: u32,
            relative_to_window: u32,
        ) -> core_foundation::array::CFArrayRef;
    }

    let window_list = CGWindowListCopyWindowInfo(
        K_CG_WINDOW_LIST_OPTION_ALL | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
        0,
    );

    if window_list.is_null() {
        return vec![];
    }

    let array =
        core_foundation::array::CFArray::<CFDictionary<CFString, CFType>>::wrap_under_create_rule(
            window_list,
        );

    let mut windows = Vec::new();

    for i in 0..array.len() {
        let Some(dict) = array.get(i) else {
            continue;
        };

        // Get owner name
        let owner_name = dict
            .find(&k_cg_window_owner_name)
            .and_then(|v| v.downcast::<CFString>())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Only include mort/Mort/Mortician windows (app is named "mort" or "Mort Dev")
        let owner_lower = owner_name.to_lowercase();
        if !owner_lower.contains("mort") && !owner_lower.contains("desktop") {
            continue;
        }

        // Get window title
        let title = dict
            .find(&k_cg_window_name)
            .and_then(|v| v.downcast::<CFString>())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Get layer
        let layer = dict
            .find(&k_cg_window_layer)
            .and_then(|v| v.downcast::<CFNumber>())
            .and_then(|n| n.to_i32())
            .unwrap_or(0);

        // Get visibility
        let visible = dict
            .find(&k_cg_window_is_on_screen)
            .and_then(|v| v.downcast::<CFBoolean>())
            .map(|b| b == CFBoolean::true_value())
            .unwrap_or(false);

        windows.push(WindowInfo {
            title,
            owner_name,
            layer,
            visible,
        });
    }

    windows
}

/// Check if a specific panel is visible by checking window titles
/// For panels without titles (e.g., before app rebuild), falls back to checking
/// for any visible high-layer window which indicates an NSPanel is showing.
pub fn is_panel_visible(panel_name: &str) -> bool {
    let panel_lower = panel_name.to_lowercase();
    let windows = get_mortician_windows();

    // First try matching by title
    let found_by_title = windows
        .iter()
        .any(|w| w.title.to_lowercase().contains(&panel_lower) && w.visible);

    if found_by_title {
        return true;
    }

    // Fallback: for "spotlight" panel, check if any NSPanel-level window is visible
    // NSPanels at ScreenSaver level have layer 1000
    // This is a heuristic for when titles aren't set
    if panel_lower == "spotlight" {
        return windows
            .iter()
            .any(|w| w.layer == 1000 && w.visible && w.owner_name.to_lowercase().contains("desktop"));
    }

    false
}

/// Wait for panel to become visible (with timeout)
pub fn wait_for_panel(panel_name: &str, timeout_ms: u64) -> Result<(), String> {
    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if is_panel_visible(panel_name) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Err(format!("Timeout waiting for panel: {}", panel_name))
}

/// Wait for panel to be hidden
pub fn wait_for_panel_hidden(panel_name: &str, timeout_ms: u64) -> Result<(), String> {
    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if !is_panel_visible(panel_name) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Err(format!("Timeout waiting for panel to hide: {}", panel_name))
}
