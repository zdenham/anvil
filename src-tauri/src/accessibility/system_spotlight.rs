//! System Spotlight keyboard shortcut management
//!
//! Provides functions to check and disable the macOS SYSTEM Spotlight shortcut (Cmd+Space).
//! This is distinct from our app's spotlight feature.
//!

use crate::accessibility::system_settings::{SystemSettingsNavigator, SystemSettingsError};
use std::thread;
use std::time::Duration;

/// Result type for spotlight shortcut operations
pub type Result<T> = std::result::Result<T, SystemSettingsError>;

// UI element identifiers (from reference trees)
const KEYBOARD_SHORTCUTS_BUTTON: &str = "Keyboard Shortcuts…";
// Note: In Tahoe the element type changed from AXButton to AXUnknown, but name is the same
const SPOTLIGHT_SIDEBAR_BUTTON: &str = "Spotlight shortcuts";
const SPOTLIGHT_CHECKBOX_LABEL: &str = "Show Spotlight search";

/// Disable the system Spotlight keyboard shortcut
///
/// Navigates through System Settings:
/// 1. Open Keyboard preferences
/// 2. Click "Keyboard Shortcuts…"
/// 3. Click "Spotlight shortcuts" in sidebar
/// 4. Uncheck "Show Spotlight search"
pub fn disable_spotlight_shortcut() -> Result<()> {
    tracing::info!("Disabling system Spotlight shortcut...");

    // Quit System Settings first to ensure clean state
    let _ = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Settings\" to quit"])
        .output();
    thread::sleep(Duration::from_millis(100));

    // Open Keyboard preferences
    let mut nav = SystemSettingsNavigator::open_pane(
        "x-apple.systempreferences:com.apple.preference.keyboard",
        5000,
    )?;
    tracing::debug!("Opened Keyboard preferences");

    // Click "Keyboard Shortcuts…" button (poll until available)
    nav.poll_and_click_button(KEYBOARD_SHORTCUTS_BUTTON)?;
    tracing::debug!("Clicked Keyboard Shortcuts button");

    // Wait for shortcuts sheet to appear
    nav.wait_for_sheet(5000)?;
    tracing::debug!("Shortcuts sheet appeared");

    // Debug: print UI tree to help diagnose sidebar button names
    tracing::info!("=== UI Tree at Keyboard Shortcuts sheet ===");
    nav.debug_tree();

    // Click "Spotlight shortcuts" in sidebar and verify the content loads
    // The click sometimes doesn't register, so we retry until the checkbox appears
    // Note: In Tahoe the element type changed from AXButton to AXUnknown
    let checkbox = nav.click_row_and_wait_for_checkbox(
        SPOTLIGHT_SIDEBAR_BUTTON,
        SPOTLIGHT_CHECKBOX_LABEL,
    )?;
    tracing::debug!("Clicked Spotlight shortcuts and found checkbox");

    // Check if checkbox is currently enabled (checked)
    let is_enabled = checkbox.get_int_attribute("AXValue").map(|v| v != 0).unwrap_or(false);
    tracing::debug!("Spotlight shortcut checkbox is_enabled: {}", is_enabled);

    if !is_enabled {
        tracing::info!("Spotlight shortcut already disabled");
        nav.close();
        return Ok(());
    }

    // Uncheck to disable
    checkbox.press()?;
    tracing::info!("Successfully disabled Spotlight shortcut");

    // Close the sheet and settings
    let _ = nav.click_button("Done");
    nav.close();

    Ok(())
}

/// Check if the Spotlight keyboard shortcut is currently enabled
pub fn is_spotlight_shortcut_enabled() -> Result<bool> {
    tracing::info!("Checking Spotlight shortcut status...");

    // Open Keyboard preferences
    let mut nav = SystemSettingsNavigator::open_pane(
        "x-apple.systempreferences:com.apple.preference.keyboard",
        5000,
    )?;

    // Click "Keyboard Shortcuts…" button
    nav.poll_and_click_button(KEYBOARD_SHORTCUTS_BUTTON)?;

    // Wait for sheet
    nav.wait_for_sheet(5000)?;

    // Click Spotlight in sidebar
    nav.poll_and_click_row(SPOTLIGHT_SIDEBAR_BUTTON)?;

    // Find checkbox and check state
    let checkbox = nav.poll_for_checkbox(SPOTLIGHT_CHECKBOX_LABEL)?;
    let enabled = checkbox.get_bool_attribute("AXValue").unwrap_or(false);

    // Close
    let _ = nav.click_button("Done");
    nav.close();

    tracing::info!("Spotlight shortcut enabled: {}", enabled);
    Ok(enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Requires accessibility permission and modifies system settings
    fn test_check_spotlight_enabled() {
        let result = is_spotlight_shortcut_enabled();
        eprintln!("Spotlight enabled: {:?}", result);
    }

    #[test]
    #[ignore] // Requires accessibility permission and modifies system settings
    fn test_disable_spotlight() {
        let result = disable_spotlight_shortcut();
        eprintln!("Disable result: {:?}", result);
    }
}
