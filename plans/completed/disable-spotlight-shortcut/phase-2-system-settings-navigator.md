# Phase 2: System Settings Navigator

## Goal

Create a helper module for programmatically navigating macOS System Settings UI using the accessibility bindings from Phase 1.

## Prerequisites

- Phase 1 complete (accessibility.rs exists and compiles)

## Output

**New File:** `src-tauri/src/system_settings.rs`

## Implementation

### File: `src-tauri/src/system_settings.rs`

```rust
//! System Settings navigation helper
//!
//! Provides utilities for opening System Settings panes and finding UI elements.

use crate::accessibility::{AXUIElement, AccessibilityError, is_accessibility_trusted};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// Error type for System Settings operations
#[derive(Debug)]
pub enum SystemSettingsError {
    Accessibility(AccessibilityError),
    ProcessNotFound,
    WindowNotFound,
    ElementNotFound(String),
    Timeout(String),
    PermissionDenied,
    Other(String),
}

impl std::fmt::Display for SystemSettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Accessibility(e) => write!(f, "Accessibility error: {}", e),
            Self::ProcessNotFound => write!(f, "System Settings process not found"),
            Self::WindowNotFound => write!(f, "System Settings window not found"),
            Self::ElementNotFound(name) => write!(f, "Element not found: {}", name),
            Self::Timeout(msg) => write!(f, "Timeout: {}", msg),
            Self::PermissionDenied => write!(f, "Accessibility permission denied"),
            Self::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for SystemSettingsError {}

impl From<AccessibilityError> for SystemSettingsError {
    fn from(e: AccessibilityError) -> Self {
        Self::Accessibility(e)
    }
}

/// Navigator for System Settings app
pub struct SystemSettingsNavigator {
    app: AXUIElement,
    pid: i32,
}

impl SystemSettingsNavigator {
    /// Open System Settings to a specific pane and return a navigator
    ///
    /// # Arguments
    /// * `pane_url` - URL scheme like "x-apple.systempreferences:com.apple.preference.keyboard"
    /// * `timeout_ms` - How long to wait for the window to appear
    pub fn open_pane(pane_url: &str, timeout_ms: u64) -> Result<Self, SystemSettingsError> {
        // Check accessibility permission first
        if !is_accessibility_trusted() {
            return Err(SystemSettingsError::PermissionDenied);
        }

        // Open the pane using the URL scheme
        Command::new("open")
            .arg(pane_url)
            .spawn()
            .map_err(|e| SystemSettingsError::Other(format!("Failed to open URL: {}", e)))?;

        // Wait a moment for the app to launch/focus
        thread::sleep(Duration::from_millis(300));

        // Find System Settings PID
        let pid = Self::find_system_settings_pid()?;

        // Create AX element for the app
        let app = AXUIElement::application(pid);

        let navigator = Self { app, pid };

        // Wait for window to be ready
        navigator.wait_for_window(timeout_ms)?;

        Ok(navigator)
    }

    /// Find the PID of System Settings (or System Preferences on older macOS)
    fn find_system_settings_pid() -> Result<i32, SystemSettingsError> {
        // Try "System Settings" first (macOS 13+)
        if let Ok(output) = Command::new("pgrep")
            .args(["-x", "System Settings"])
            .output()
        {
            if output.status.success() {
                let pid_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(pid) = pid_str.trim().parse::<i32>() {
                    return Ok(pid);
                }
            }
        }

        // Fall back to "System Preferences" (macOS 12 and earlier)
        if let Ok(output) = Command::new("pgrep")
            .args(["-x", "System Preferences"])
            .output()
        {
            if output.status.success() {
                let pid_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(pid) = pid_str.trim().parse::<i32>() {
                    return Ok(pid);
                }
            }
        }

        Err(SystemSettingsError::ProcessNotFound)
    }

    /// Wait for the main window to be accessible
    pub fn wait_for_window(&self, timeout_ms: u64) -> Result<AXUIElement, SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_millis(timeout_ms);

        while start.elapsed() < timeout {
            let windows = self.app.find_by_role("AXWindow");
            if let Some(window) = windows.into_iter().next() {
                return Ok(window);
            }
            thread::sleep(Duration::from_millis(50));
        }

        Err(SystemSettingsError::Timeout("Waiting for window".to_string()))
    }

    /// Wait for a sheet/dialog to appear (e.g., after clicking "Keyboard Shortcuts...")
    pub fn wait_for_sheet(&self, timeout_ms: u64) -> Result<AXUIElement, SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_millis(timeout_ms);

        while start.elapsed() < timeout {
            let sheets = self.app.find_by_role("AXSheet");
            if let Some(sheet) = sheets.into_iter().next() {
                return Ok(sheet);
            }
            thread::sleep(Duration::from_millis(50));
        }

        Err(SystemSettingsError::Timeout("Waiting for sheet".to_string()))
    }

    /// Find a button by its title or label
    pub fn find_button(&self, name: &str) -> Option<AXUIElement> {
        // First try by title
        if let Some(btn) = self.app.find_by_title(name) {
            if btn.role().as_deref() == Some("AXButton") {
                return Some(btn);
            }
        }

        // Then try by label (for SwiftUI buttons)
        if let Some(btn) = self.app.find_by_label(name) {
            if btn.role().as_deref() == Some("AXButton") {
                return Some(btn);
            }
        }

        // Search all buttons and check title/label
        for btn in self.app.find_by_role("AXButton") {
            if btn.title().as_deref() == Some(name) || btn.label().as_deref() == Some(name) {
                return Some(btn);
            }
        }

        None
    }

    /// Find a checkbox by its title or label
    pub fn find_checkbox(&self, name: &str) -> Option<AXUIElement> {
        // First try by title
        if let Some(cb) = self.app.find_by_title(name) {
            if cb.role().as_deref() == Some("AXCheckBox") {
                return Some(cb);
            }
        }

        // Then try by label
        if let Some(cb) = self.app.find_by_label(name) {
            if cb.role().as_deref() == Some("AXCheckBox") {
                return Some(cb);
            }
        }

        // Search all checkboxes
        for cb in self.app.find_by_role("AXCheckBox") {
            if cb.title().as_deref() == Some(name) || cb.label().as_deref() == Some(name) {
                return Some(cb);
            }
        }

        None
    }

    /// Find a row in a table/outline by its label (for sidebar navigation)
    pub fn find_row(&self, name: &str) -> Option<AXUIElement> {
        // Look for AXRow or AXOutlineRow elements
        for row in self.app.find_by_role("AXRow") {
            // Check the row's children for matching text
            if row.label().as_deref() == Some(name) {
                return Some(row);
            }
            // Check child static text elements
            for child in row.children() {
                if child.role().as_deref() == Some("AXStaticText") {
                    if child.value().as_deref() == Some(name) {
                        return Some(row);
                    }
                }
            }
        }

        // Also check outline rows (used in some versions)
        for row in self.app.find_by_role("AXOutlineRow") {
            if row.label().as_deref() == Some(name) {
                return Some(row);
            }
        }

        None
    }

    /// Click a button by name
    pub fn click_button(&self, name: &str) -> Result<(), SystemSettingsError> {
        let button = self
            .find_button(name)
            .ok_or_else(|| SystemSettingsError::ElementNotFound(format!("Button: {}", name)))?;
        button.press()?;
        // Small delay after clicking to allow UI to update
        thread::sleep(Duration::from_millis(100));
        Ok(())
    }

    /// Click a row in the sidebar
    pub fn click_row(&self, name: &str) -> Result<(), SystemSettingsError> {
        let row = self
            .find_row(name)
            .ok_or_else(|| SystemSettingsError::ElementNotFound(format!("Row: {}", name)))?;
        row.press()?;
        thread::sleep(Duration::from_millis(100));
        Ok(())
    }

    /// Set a checkbox to a specific state
    pub fn set_checkbox(&self, name: &str, checked: bool) -> Result<(), SystemSettingsError> {
        let checkbox = self
            .find_checkbox(name)
            .ok_or_else(|| SystemSettingsError::ElementNotFound(format!("Checkbox: {}", name)))?;

        // Get current state
        let current = checkbox.get_bool_attribute("AXValue").unwrap_or(false);

        if current != checked {
            // Toggle by pressing
            checkbox.press()?;
            thread::sleep(Duration::from_millis(100));
        }

        Ok(())
    }

    /// Close System Settings
    pub fn close(&self) {
        // Send Cmd+W to close window, or Cmd+Q to quit
        let _ = Command::new("osascript")
            .args(["-e", "tell application \"System Settings\" to quit"])
            .spawn();
    }

    /// Debug: print the current UI tree
    pub fn debug_tree(&self) {
        eprintln!("=== System Settings UI Tree ===");
        self.app.debug_tree(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Requires System Settings to be running
    fn test_find_system_settings() {
        let pid = SystemSettingsNavigator::find_system_settings_pid();
        // Just check it doesn't panic
        eprintln!("System Settings PID: {:?}", pid);
    }
}
```

## Verification

1. Add `mod system_settings;` to `src-tauri/src/lib.rs`
2. Run `cargo check -p anvil` to verify compilation
3. Optionally test with `cargo test -p anvil -- --ignored test_find_system_settings`

## Success Criteria

- [ ] `system_settings.rs` compiles without errors
- [ ] `SystemSettingsNavigator::open_pane()` can open keyboard settings
- [ ] Button/checkbox/row finding functions work
- [ ] `debug_tree()` outputs useful UI structure

## Notes

- The `debug_tree()` function is essential for development - use it to discover actual element names
- macOS 13+ uses "System Settings", older versions use "System Preferences"
- SwiftUI elements often use AXLabel instead of AXTitle
- Sheet detection is important for the keyboard shortcuts dialog
