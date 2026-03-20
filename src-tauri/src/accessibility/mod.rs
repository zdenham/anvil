//! macOS Accessibility module
//!
//! This module provides accessibility-related functionality for macOS:
//! - `ax_element`: Low-level AXUIElement bindings for UI automation
//! - `system_settings`: Navigation helper for System Settings app
//! - `system_spotlight`: Management of the macOS system Spotlight shortcut

mod ax_element;
pub mod system_settings;
pub mod system_spotlight;

// Re-export the public API from ax_element
pub use ax_element::{
    AXUIElement,
    AccessibilityError,
    is_accessibility_trusted,
    check_accessibility_with_prompt,
};

// Re-export system_settings types
pub use system_settings::{SystemSettingsNavigator, SystemSettingsError};

// Re-export system_spotlight functions
pub use system_spotlight::{disable_spotlight_shortcut, is_spotlight_shortcut_enabled};
