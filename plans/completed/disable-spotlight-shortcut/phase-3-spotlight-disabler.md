# Phase 3: Spotlight Shortcut Disabler

## Goal

Implement the core logic to navigate System Settings and disable the Spotlight keyboard shortcut.

## Prerequisites

- Phase 1 complete (accessibility.rs)
- Phase 2 complete (system_settings.rs)

## Output

**New File:** `src-tauri/src/spotlight_shortcut.rs`

## Implementation

### File: `src-tauri/src/spotlight_shortcut.rs`

```rust
//! Spotlight keyboard shortcut management
//!
//! Provides functions to check and disable the system Spotlight shortcut (Cmd+Space).

use crate::system_settings::{SystemSettingsNavigator, SystemSettingsError};
use std::thread;
use std::time::Duration;

/// Result type for spotlight shortcut operations
pub type Result<T> = std::result::Result<T, SystemSettingsError>;

/// Disable the system Spotlight keyboard shortcut
///
/// This navigates through System Settings to:
/// 1. Open Keyboard preferences
/// 2. Click "Keyboard Shortcuts..."
/// 3. Select "Spotlight" in the sidebar
/// 4. Uncheck "Show Spotlight search"
/// 5. Click Done and close
pub fn disable_spotlight_shortcut() -> Result<()> {
    tracing::info!("Disabling system Spotlight shortcut...");

    // Step 1: Open Keyboard preferences
    let nav = SystemSettingsNavigator::open_pane(
        "x-apple.systempreferences:com.apple.preference.keyboard",
        3000,
    )?;

    tracing::debug!("Opened Keyboard preferences");

    // Give the pane time to fully load
    thread::sleep(Duration::from_millis(500));

    // Step 2: Click "Keyboard Shortcuts..." button
    // The exact label may vary by macOS version
    let shortcuts_button_names = [
        "Keyboard Shortcuts…",
        "Keyboard Shortcuts...",
        "Keyboard Shortcuts",
    ];

    let mut clicked = false;
    for name in &shortcuts_button_names {
        if nav.find_button(name).is_some() {
            nav.click_button(name)?;
            clicked = true;
            tracing::debug!("Clicked button: {}", name);
            break;
        }
    }

    if !clicked {
        // Debug: print tree to see what's available
        tracing::warn!("Could not find Keyboard Shortcuts button, dumping UI tree...");
        nav.debug_tree();
        return Err(SystemSettingsError::ElementNotFound(
            "Keyboard Shortcuts button".to_string(),
        ));
    }

    // Step 3: Wait for the shortcuts sheet/dialog to appear
    thread::sleep(Duration::from_millis(500));
    let _sheet = nav.wait_for_sheet(3000)?;
    tracing::debug!("Shortcuts sheet appeared");

    // Step 4: Find and click "Spotlight" in the sidebar
    // Try different possible names
    let spotlight_names = [
        "Spotlight",
        "Spotlight shortcuts",
    ];

    clicked = false;
    for name in &spotlight_names {
        if nav.find_row(name).is_some() {
            nav.click_row(name)?;
            clicked = true;
            tracing::debug!("Clicked sidebar row: {}", name);
            break;
        }
    }

    if !clicked {
        tracing::warn!("Could not find Spotlight in sidebar, dumping UI tree...");
        nav.debug_tree();
        return Err(SystemSettingsError::ElementNotFound(
            "Spotlight sidebar item".to_string(),
        ));
    }

    // Give the right pane time to update
    thread::sleep(Duration::from_millis(300));

    // Step 5: Uncheck "Show Spotlight search" checkbox
    let checkbox_names = [
        "Show Spotlight search",
        "Show Spotlight Search",
    ];

    let mut unchecked = false;
    for name in &checkbox_names {
        if nav.find_checkbox(name).is_some() {
            nav.set_checkbox(name, false)?;
            unchecked = true;
            tracing::debug!("Unchecked checkbox: {}", name);
            break;
        }
    }

    if !unchecked {
        tracing::warn!("Could not find Show Spotlight search checkbox, dumping UI tree...");
        nav.debug_tree();
        return Err(SystemSettingsError::ElementNotFound(
            "Show Spotlight search checkbox".to_string(),
        ));
    }

    // Step 6: Click Done to close the sheet
    thread::sleep(Duration::from_millis(200));
    nav.click_button("Done")?;
    tracing::debug!("Clicked Done");

    // Step 7: Close System Settings
    thread::sleep(Duration::from_millis(200));
    nav.close();
    tracing::info!("Successfully disabled Spotlight shortcut");

    Ok(())
}

/// Check if the Spotlight keyboard shortcut is currently enabled
///
/// Returns true if enabled, false if disabled.
pub fn is_spotlight_shortcut_enabled() -> Result<bool> {
    tracing::info!("Checking Spotlight shortcut status...");

    // Open Keyboard preferences
    let nav = SystemSettingsNavigator::open_pane(
        "x-apple.systempreferences:com.apple.preference.keyboard",
        3000,
    )?;

    thread::sleep(Duration::from_millis(500));

    // Click "Keyboard Shortcuts..." button
    let shortcuts_button_names = [
        "Keyboard Shortcuts…",
        "Keyboard Shortcuts...",
        "Keyboard Shortcuts",
    ];

    for name in &shortcuts_button_names {
        if nav.find_button(name).is_some() {
            nav.click_button(name)?;
            break;
        }
    }

    // Wait for sheet
    thread::sleep(Duration::from_millis(500));
    let _sheet = nav.wait_for_sheet(3000)?;

    // Click Spotlight in sidebar
    let spotlight_names = ["Spotlight", "Spotlight shortcuts"];
    for name in &spotlight_names {
        if nav.find_row(name).is_some() {
            nav.click_row(name)?;
            break;
        }
    }

    thread::sleep(Duration::from_millis(300));

    // Check the checkbox state
    let checkbox_names = ["Show Spotlight search", "Show Spotlight Search"];
    let mut enabled = false;

    for name in &checkbox_names {
        if let Some(checkbox) = nav.find_checkbox(name) {
            enabled = checkbox.get_bool_attribute("AXValue").unwrap_or(false);
            break;
        }
    }

    // Close without saving
    nav.click_button("Done")?;
    thread::sleep(Duration::from_millis(200));
    nav.close();

    tracing::info!("Spotlight shortcut enabled: {}", enabled);
    Ok(enabled)
}

/// Alternative: Disable via defaults write (faster but requires logout)
///
/// This modifies the symbolic hotkeys plist directly.
/// Key 64 = Spotlight search shortcut
/// Key 65 = Spotlight window shortcut
#[allow(dead_code)]
pub fn disable_spotlight_shortcut_via_defaults() -> Result<()> {
    use std::process::Command;

    tracing::info!("Disabling Spotlight shortcut via defaults...");

    // Disable key 64 (Show Spotlight search)
    let output = Command::new("defaults")
        .args([
            "write",
            "com.apple.symbolichotkeys",
            "AppleSymbolicHotKeys",
            "-dict-add",
            "64",
            "<dict><key>enabled</key><false/><key>value</key><dict><key>parameters</key><array><integer>32</integer><integer>49</integer><integer>1048576</integer></array><key>type</key><string>standard</string></dict></dict>",
        ])
        .output()
        .map_err(|e| SystemSettingsError::Other(format!("Failed to run defaults: {}", e)))?;

    if !output.status.success() {
        return Err(SystemSettingsError::Other(format!(
            "defaults write failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    // Restart cfprefsd to apply changes
    let _ = Command::new("killall").arg("cfprefsd").output();

    tracing::info!("Spotlight shortcut disabled via defaults (may require logout to take effect)");
    Ok(())
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
```

## Add Module to lib.rs

Add to `src-tauri/src/lib.rs`:

```rust
mod spotlight_shortcut;

// Make public for mort-test CLI access
pub use spotlight_shortcut::{disable_spotlight_shortcut, is_spotlight_shortcut_enabled};
```

## Verification

1. Run `cargo check -p mortician`
2. Manually test with accessibility permission granted:
   ```bash
   # In a test binary or via mort-test (after Phase 5)
   cargo test -p mortician -- --ignored test_check_spotlight_enabled
   ```

## Success Criteria

- [ ] `spotlight_shortcut.rs` compiles
- [ ] `disable_spotlight_shortcut()` navigates UI correctly
- [ ] `is_spotlight_shortcut_enabled()` returns correct status
- [ ] Functions handle different macOS versions gracefully
- [ ] Debug output helps identify UI element naming issues

## Notes

- The exact button/checkbox names may vary between macOS versions
- Use `debug_tree()` liberally during development to discover actual names
- The `defaults write` alternative is available but requires logout
- All operations require accessibility permission
