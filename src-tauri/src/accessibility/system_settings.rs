//! System Settings navigation helper
//!
//! Provides utilities for opening System Settings panes and finding UI elements.

use crate::accessibility::{AXUIElement, AccessibilityError, is_accessibility_trusted};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// Strategy for clicking UI elements
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickStrategy {
    /// Use AXPress action (works for AXButton on older macOS like Sonoma)
    AXPress,
    /// Simulate actual mouse click using CGEvent (works for AXUnknown on newer macOS like Tahoe)
    MouseClick,
    /// Automatically choose based on element type: AXPress for AXButton, MouseClick for AXUnknown
    Auto,
}

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
    sheet: Option<AXUIElement>,
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

        // Brief pause for app to start launching (window polling handles the rest)
        thread::sleep(Duration::from_millis(50));

        // Find System Settings PID and create AX element
        let pid = Self::find_system_settings_pid()?;
        let app = AXUIElement::application(pid);
        let navigator = Self { app, sheet: None };

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
    /// Stores the sheet reference for scoped searches.
    pub fn wait_for_sheet(&mut self, timeout_ms: u64) -> Result<(), SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_millis(timeout_ms);

        while start.elapsed() < timeout {
            let sheets = self.app.find_by_role("AXSheet");
            if let Some(sheet) = sheets.into_iter().next() {
                self.sheet = Some(sheet);
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }

        Err(SystemSettingsError::Timeout("Waiting for sheet".to_string()))
    }

    /// Get the search root - use sheet if available, otherwise the app
    fn search_root(&self) -> &AXUIElement {
        self.sheet.as_ref().unwrap_or(&self.app)
    }

    /// Find a button by its title, label, or description
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

        // Search all buttons and check title/label/description
        for btn in self.app.find_by_role("AXButton") {
            if btn.title().as_deref() == Some(name)
                || btn.label().as_deref() == Some(name)
                || btn.description().as_deref() == Some(name) {
                return Some(btn);
            }
        }

        None
    }

    /// Find a checkbox by its title, label, description, or associated text
    pub fn find_checkbox(&self, name: &str) -> Option<AXUIElement> {
        let root = self.search_root();
        tracing::trace!("find_checkbox('{}'), searching in sheet: {}", name, self.sheet.is_some());

        // First try by title
        if let Some(cb) = root.find_by_title(name) {
            if cb.role().as_deref() == Some("AXCheckBox") {
                tracing::trace!("find_checkbox: found by title");
                return Some(cb);
            }
        }

        // Then try by label
        if let Some(cb) = root.find_by_label(name) {
            if cb.role().as_deref() == Some("AXCheckBox") {
                tracing::trace!("find_checkbox: found by label");
                return Some(cb);
            }
        }

        // Search all checkboxes
        for cb in root.find_by_role("AXCheckBox") {
            if cb.title().as_deref() == Some(name)
                || cb.label().as_deref() == Some(name)
                || cb.description().as_deref() == Some(name) {
                tracing::trace!("find_checkbox: found by direct attribute match");
                return Some(cb);
            }
        }

        // In macOS Sonoma, checkboxes often have associated static text siblings
        // Structure: AXCell -> [AXCheckBox, AXStaticText (with value)]
        // Find rows with matching static text and return their checkbox
        for row in self.search_root().find_by_role("AXRow") {
            for child in row.children() {
                if child.role().as_deref() == Some("AXCell") {
                    // First check if this cell has matching text
                    let has_matching_text = child.children().iter().any(|c| {
                        c.role().as_deref() == Some("AXStaticText")
                            && c.value().as_deref() == Some(name)
                    });

                    if has_matching_text {
                        // Find and return the checkbox in this cell
                        for cell_child in child.children() {
                            if cell_child.role().as_deref() == Some("AXCheckBox") {
                                tracing::trace!("find_checkbox: found via row/cell with matching text '{}'", name);
                                return Some(cell_child);
                            }
                        }
                    }
                }
            }
        }

        None
    }

    /// Find a row in a table/outline by its label (for sidebar navigation)
    pub fn find_row(&self, name: &str) -> Option<AXUIElement> {
        let root = self.search_root();

        // Fast path: find a button/unknown with matching description
        // In Sonoma: AXRow -> AXCell -> AXButton[desc=name]
        // In Tahoe:  AXRow -> AXCell -> AXUnknown[desc=name]
        for role in &["AXButton", "AXUnknown"] {
            if let Some(_btn) = root.find_first(role, |btn| {
                btn.description().as_deref() == Some(name)
            }) {
                // Found element, now find its parent row
                // Since find_first doesn't give us parent, search rows for this element
                for row in root.find_by_role("AXRow") {
                    for child in row.children() {
                        if child.role().as_deref() == Some("AXCell") {
                            for cell_child in child.children() {
                                let child_role = cell_child.role();
                                if (child_role.as_deref() == Some("AXButton") || child_role.as_deref() == Some("AXUnknown"))
                                    && cell_child.description().as_deref() == Some(name)
                                {
                                    return Some(row);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fallback: search rows directly (for other macOS versions)
        for row in root.find_by_role("AXRow") {
            if row.label().as_deref() == Some(name) || row.description().as_deref() == Some(name) {
                return Some(row);
            }
            for child in row.children() {
                if child.role().as_deref() == Some("AXStaticText")
                    && child.value().as_deref() == Some(name)
                {
                    return Some(row);
                }
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
        Ok(())
    }

    /// Click a row in the sidebar (by finding and clicking its button)
    /// Uses Auto strategy which picks AXPress for AXButton, MouseClick for AXUnknown
    pub fn click_row(&self, name: &str) -> Result<(), SystemSettingsError> {
        self.click_row_with_strategy(name, ClickStrategy::Auto)
    }

    /// Click a row using a specific strategy
    pub fn click_row_with_strategy(&self, name: &str, strategy: ClickStrategy) -> Result<(), SystemSettingsError> {
        let root = self.search_root();

        // Find the clickable element (AXButton on Sonoma, AXUnknown on Tahoe)
        for role in &["AXButton", "AXUnknown"] {
            if let Some(btn) = root.find_first(role, |btn| {
                btn.description().as_deref() == Some(name)
            }) {
                let found_role = btn.role().unwrap_or_default();
                tracing::trace!("click_row: found {} '{}', root is sheet: {}", found_role, name, self.sheet.is_some());

                // Determine which click method to use
                let effective_strategy = match strategy {
                    ClickStrategy::Auto => {
                        if found_role == "AXUnknown" {
                            // AXUnknown (Tahoe) doesn't respond to AXPress, use mouse click
                            ClickStrategy::MouseClick
                        } else {
                            // AXButton (Sonoma) responds to AXPress
                            ClickStrategy::AXPress
                        }
                    }
                    other => other,
                };

                tracing::trace!("click_row: using {:?} for {} '{}'", effective_strategy, found_role, name);
                return self.perform_click(&btn, effective_strategy);
            }
        }

        // Fallback: find row and try its children
        let row = self
            .find_row(name)
            .ok_or_else(|| SystemSettingsError::ElementNotFound(format!("Row: {}", name)))?;

        for child in row.children() {
            if child.role().as_deref() == Some("AXCell") {
                for cell_child in child.children() {
                    let role = cell_child.role();
                    if role.as_deref() == Some("AXButton") || role.as_deref() == Some("AXUnknown") {
                        let effective_strategy = match strategy {
                            ClickStrategy::Auto => {
                                if role.as_deref() == Some("AXUnknown") {
                                    ClickStrategy::MouseClick
                                } else {
                                    ClickStrategy::AXPress
                                }
                            }
                            other => other,
                        };
                        return self.perform_click(&cell_child, effective_strategy);
                    }
                }
            }
        }

        // Last resort: click the row itself
        self.perform_click(&row, ClickStrategy::AXPress)
    }

    /// Perform a click using the specified strategy
    fn perform_click(&self, element: &AXUIElement, strategy: ClickStrategy) -> Result<(), SystemSettingsError> {
        match strategy {
            ClickStrategy::AXPress => {
                element.press()?;
            }
            ClickStrategy::MouseClick => {
                element.click_with_mouse()?;
            }
            ClickStrategy::Auto => {
                // Auto should be resolved before calling perform_click
                // If we get here, default to AXPress
                tracing::warn!("perform_click: Auto strategy not resolved, defaulting to AXPress");
                element.press()?;
            }
        }
        Ok(())
    }

    /// Close System Settings
    pub fn close(&self) {
        let _ = Command::new("osascript")
            .args(["-e", "tell application \"System Settings\" to quit"])
            .spawn();
    }

    // --- Polling methods ---

    /// Poll for a button and click it when found
    pub fn poll_and_click_button(&self, name: &str) -> Result<(), SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_secs(10);

        while start.elapsed() < timeout {
            if self.click_button(name).is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }

        self.debug_tree();
        Err(SystemSettingsError::ElementNotFound(format!("Button: {}", name)))
    }

    /// Poll for a sidebar row/button and click it when found
    pub fn poll_and_click_row(&self, name: &str) -> Result<(), SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_secs(10);

        while start.elapsed() < timeout {
            if self.click_row(name).is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }

        self.debug_tree();
        Err(SystemSettingsError::ElementNotFound(format!("Row: {}", name)))
    }

    /// Poll for a checkbox and return it when found
    pub fn poll_for_checkbox(&self, name: &str) -> Result<AXUIElement, SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_secs(10);

        while start.elapsed() < timeout {
            if let Some(checkbox) = self.find_checkbox(name) {
                return Ok(checkbox);
            }
            thread::sleep(Duration::from_millis(50));
        }

        self.debug_tree();
        Err(SystemSettingsError::ElementNotFound(format!("Checkbox: {}", name)))
    }

    /// Click a sidebar row and wait for a checkbox to appear in the content panel.
    /// Retries clicking if the checkbox doesn't appear (click sometimes doesn't register).
    pub fn click_row_and_wait_for_checkbox(
        &self,
        row_name: &str,
        checkbox_name: &str,
    ) -> Result<AXUIElement, SystemSettingsError> {
        self.click_row_and_wait_for_checkbox_multi(&[row_name], checkbox_name)
    }

    /// Click a sidebar row and wait for a checkbox to appear in the content panel.
    /// Tries multiple possible row names for cross-version macOS compatibility.
    /// Retries clicking if the checkbox doesn't appear (click sometimes doesn't register).
    pub fn click_row_and_wait_for_checkbox_multi(
        &self,
        row_names: &[&str],
        checkbox_name: &str,
    ) -> Result<AXUIElement, SystemSettingsError> {
        let start = Instant::now();
        let timeout = Duration::from_secs(10);
        let mut click_attempts = 0;
        let mut last_successful_row: Option<&str> = None;

        while start.elapsed() < timeout {
            // Try to click any of the possible row names using Auto strategy
            // Auto will use AXPress for AXButton (Sonoma) or MouseClick for AXUnknown (Tahoe)
            for row_name in row_names {
                if self.click_row(row_name).is_ok() {
                    click_attempts += 1;
                    last_successful_row = Some(row_name);

                    if click_attempts == 1 {
                        tracing::debug!(
                            "click_row_and_wait_for_checkbox_multi: clicked '{}'",
                            row_name
                        );
                    }
                    break;
                }
            }

            // Brief pause then check if the checkbox is now visible
            thread::sleep(Duration::from_millis(50));

            if let Some(checkbox) = self.find_checkbox(checkbox_name) {
                tracing::debug!(
                    "click_row_and_wait_for_checkbox_multi: found checkbox after {} clicks (row: {:?})",
                    click_attempts, last_successful_row
                );
                return Ok(checkbox);
            }
        }

        self.debug_tree();
        Err(SystemSettingsError::ElementNotFound(format!(
            "Checkbox '{}' after clicking any of {:?}",
            checkbox_name, row_names
        )))
    }

    /// Debug: log detailed info about a specific row element
    pub fn debug_row(&self, name: &str) {
        let root = self.search_root();

        for role in &["AXButton", "AXUnknown"] {
            if let Some(btn) = root.find_first(role, |btn| {
                btn.description().as_deref() == Some(name)
            }) {
                tracing::info!("debug_row '{}': {}", name, btn.debug_summary());

                // Also check parent row state
                if let Some(row) = self.find_row(name) {
                    tracing::info!("debug_row '{}' parent row: {}", name, row.debug_summary());
                }
                return;
            }
        }

        tracing::warn!("debug_row '{}': element not found", name);
    }

    /// Focus the sidebar outline (AXOutline with desc="Sidebar")
    /// This may be needed before clicking sidebar items in some macOS versions.
    pub fn focus_sidebar(&self) -> Result<(), SystemSettingsError> {
        let root = self.search_root();

        // Find the sidebar outline
        if let Some(outline) = root.find_first("AXOutline", |o| {
            o.description().as_deref() == Some("Sidebar")
        }) {
            tracing::debug!("focus_sidebar: found sidebar outline: {}", outline.debug_summary());

            // Try to raise/focus it - this might fail but that's ok
            let _ = outline.perform_action("AXRaise");

            tracing::debug!("focus_sidebar: attempted to focus sidebar");
            return Ok(());
        }

        // Try scroll areas as fallback
        for scroll_area in root.find_by_role("AXScrollArea") {
            for child in scroll_area.children() {
                if child.role().as_deref() == Some("AXOutline")
                    && child.description().as_deref() == Some("Sidebar")
                {
                    let _ = scroll_area.perform_action("AXRaise");
                    tracing::debug!("focus_sidebar: focused scroll area containing sidebar");
                    return Ok(());
                }
            }
        }

        tracing::warn!("focus_sidebar: sidebar not found");
        Err(SystemSettingsError::ElementNotFound("Sidebar".to_string()))
    }

    /// Try to navigate sidebar using keyboard arrow keys
    /// This is an alternative to clicking when AXPress doesn't work
    pub fn navigate_sidebar_with_keyboard(&self, target_name: &str) -> Result<(), SystemSettingsError> {
        use std::process::Command;

        let root = self.search_root();

        // First, try to focus the sidebar
        let _ = self.focus_sidebar();
        thread::sleep(Duration::from_millis(50));

        // Find all rows in order
        let outlines = root.find_by_role("AXOutline");
        let sidebar = outlines.into_iter().find(|o| {
            o.description().as_deref() == Some("Sidebar")
        });

        let Some(sidebar) = sidebar else {
            return Err(SystemSettingsError::ElementNotFound("Sidebar outline".to_string()));
        };

        // Get all rows
        let rows = sidebar.find_by_role("AXRow");
        let row_names: Vec<_> = rows.iter().filter_map(|row| {
            for child in row.children() {
                if child.role().as_deref() == Some("AXCell") {
                    for cell_child in child.children() {
                        if let Some(desc) = cell_child.description() {
                            if !desc.is_empty() {
                                return Some(desc);
                            }
                        }
                    }
                }
            }
            None
        }).collect();

        tracing::debug!("navigate_sidebar_with_keyboard: found rows: {:?}", row_names);

        // Find current selection and target position
        let current_idx = rows.iter().position(|row| row.is_selected()).unwrap_or(0);
        let target_idx = row_names.iter().position(|n| n == target_name);

        let Some(target_idx) = target_idx else {
            return Err(SystemSettingsError::ElementNotFound(format!("Row '{}' in sidebar", target_name)));
        };

        let delta = target_idx as i32 - current_idx as i32;
        tracing::debug!(
            "navigate_sidebar_with_keyboard: current={}, target={}, delta={}",
            current_idx, target_idx, delta
        );

        // Send arrow key presses using osascript
        let key_code = if delta > 0 { "125" } else { "126" }; // down: 125, up: 126
        let presses = delta.abs();

        for _ in 0..presses {
            let _ = Command::new("osascript")
                .args(["-e", &format!(
                    "tell application \"System Events\" to key code {}",
                    key_code
                )])
                .output();
            thread::sleep(Duration::from_millis(30));
        }

        Ok(())
    }

    /// Debug: List all sidebar items with their element types and states
    pub fn debug_sidebar_items(&self) {
        let root = self.search_root();

        // Find the sidebar outline
        let outlines = root.find_by_role("AXOutline");
        for outline in outlines {
            if outline.description().as_deref() == Some("Sidebar") {
                tracing::info!("=== Sidebar Items ===");
                for row in outline.find_by_role("AXRow").iter() {
                    let selected = row.is_selected();
                    let focused = row.is_focused();

                    for child in row.children() {
                        if child.role().as_deref() == Some("AXCell") {
                            for cell_child in child.children() {
                                let role = cell_child.role().unwrap_or_default();
                                let desc = cell_child.description().unwrap_or_default();
                                if !desc.is_empty() {
                                    let actions = cell_child.supported_actions();
                                    tracing::info!(
                                        "  [{}] '{}' (row selected={}, focused={}) actions={:?}",
                                        role, desc, selected, focused, actions
                                    );
                                }
                            }
                        }
                    }
                }
                return;
            }
        }
        tracing::warn!("debug_sidebar_items: Sidebar not found");
    }

    // --- Debug methods ---

    /// Debug: print the current UI tree
    pub fn debug_tree(&self) {
        eprintln!("=== System Settings UI Tree ===");
        self.app.debug_tree(0);
    }

    /// Debug: write the current UI tree to a file
    pub fn debug_tree_to_file(&self, path: &str) -> Result<(), SystemSettingsError> {
        use std::fs;
        let tree = self.app.debug_tree_to_string(0);
        let content = format!("=== System Settings UI Tree ===\n{}", tree);
        fs::write(path, content)
            .map_err(|e| SystemSettingsError::Other(format!("Failed to write tree to file: {}", e)))
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
