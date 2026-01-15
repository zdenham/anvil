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
    AXUIElementRef,
    AccessibilityError,
    AXError,
    is_accessibility_trusted,
    check_accessibility_with_prompt,
    // Constants
    K_AX_ERROR_SUCCESS,
    K_AX_ERROR_FAILURE,
    K_AX_ERROR_ILLEGAL_ARGUMENT,
    K_AX_ERROR_INVALID_UI_ELEMENT,
    K_AX_ERROR_INVALID_UI_ELEMENT_OBSERVER,
    K_AX_ERROR_CANNOT_COMPLETE,
    K_AX_ERROR_ATTRIBUTE_UNSUPPORTED,
    K_AX_ERROR_ACTION_UNSUPPORTED,
    K_AX_ERROR_NOTIFICATION_UNSUPPORTED,
    K_AX_ERROR_NOT_IMPLEMENTED,
    K_AX_ERROR_NOTIFICATION_ALREADY_REGISTERED,
    K_AX_ERROR_NOTIFICATION_NOT_REGISTERED,
    K_AX_ERROR_API_DISABLED,
    K_AX_ERROR_NO_VALUE,
    K_AX_ERROR_PARAMETERIZED_ATTRIBUTE_UNSUPPORTED,
    K_AX_ERROR_NOT_ENOUGH_PRECISION,
};

// Re-export system_settings types
pub use system_settings::{SystemSettingsNavigator, SystemSettingsError};

// Re-export system_spotlight functions
pub use system_spotlight::{disable_spotlight_shortcut, is_spotlight_shortcut_enabled};
