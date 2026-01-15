# Phase 1: Accessibility Framework Bindings

## Goal

Create Rust bindings for the macOS Accessibility API (AXUIElement) to enable programmatic UI automation.

## Prerequisites

- None (this is the foundation phase)

## Output

**New File:** `src-tauri/src/accessibility.rs`

## Dependencies to Add

**File:** `src-tauri/Cargo.toml`

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.9"
```

## Implementation

### File: `src-tauri/src/accessibility.rs`

```rust
//! macOS Accessibility API bindings for UI automation
//!
//! Provides safe Rust wrappers around AXUIElement functions.

use core_foundation::base::{CFType, TCFType, CFTypeRef};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::array::{CFArray, CFArrayRef};
use std::ptr;

/// AXUIElement reference type
#[repr(C)]
pub struct __AXUIElement(std::ffi::c_void);
pub type AXUIElementRef = *mut __AXUIElement;

/// AX error codes
pub type AXError = i32;
pub const K_AX_ERROR_SUCCESS: AXError = 0;
pub const K_AX_ERROR_FAILURE: AXError = -25200;
pub const K_AX_ERROR_ILLEGAL_ARGUMENT: AXError = -25201;
pub const K_AX_ERROR_INVALID_UI_ELEMENT: AXError = -25202;
pub const K_AX_ERROR_INVALID_UI_ELEMENT_OBSERVER: AXError = -25203;
pub const K_AX_ERROR_CANNOT_COMPLETE: AXError = -25204;
pub const K_AX_ERROR_ATTRIBUTE_UNSUPPORTED: AXError = -25205;
pub const K_AX_ERROR_ACTION_UNSUPPORTED: AXError = -25206;
pub const K_AX_ERROR_NOTIFICATION_UNSUPPORTED: AXError = -25207;
pub const K_AX_ERROR_NOT_IMPLEMENTED: AXError = -25208;
pub const K_AX_ERROR_NOTIFICATION_ALREADY_REGISTERED: AXError = -25209;
pub const K_AX_ERROR_NOTIFICATION_NOT_REGISTERED: AXError = -25210;
pub const K_AX_ERROR_API_DISABLED: AXError = -25211;
pub const K_AX_ERROR_NO_VALUE: AXError = -25212;
pub const K_AX_ERROR_PARAMETERIZED_ATTRIBUTE_UNSUPPORTED: AXError = -25213;
pub const K_AX_ERROR_NOT_ENOUGH_PRECISION: AXError = -25214;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementCopyAttributeNames(
        element: AXUIElementRef,
        names: *mut CFArrayRef,
    ) -> AXError;
    fn AXUIElementPerformAction(
        element: AXUIElementRef,
        action: CFStringRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXIsProcessTrusted() -> bool;
    fn CFRelease(cf: CFTypeRef);
}

/// Error type for accessibility operations
#[derive(Debug, Clone)]
pub struct AccessibilityError {
    pub code: AXError,
    pub message: String,
}

impl std::fmt::Display for AccessibilityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "AXError {}: {}", self.code, self.message)
    }
}

impl std::error::Error for AccessibilityError {}

impl AccessibilityError {
    pub fn new(code: AXError, message: &str) -> Self {
        Self {
            code,
            message: message.to_string(),
        }
    }

    pub fn from_code(code: AXError) -> Self {
        let message = match code {
            K_AX_ERROR_SUCCESS => "Success",
            K_AX_ERROR_FAILURE => "General failure",
            K_AX_ERROR_ILLEGAL_ARGUMENT => "Illegal argument",
            K_AX_ERROR_INVALID_UI_ELEMENT => "Invalid UI element",
            K_AX_ERROR_CANNOT_COMPLETE => "Cannot complete",
            K_AX_ERROR_ATTRIBUTE_UNSUPPORTED => "Attribute unsupported",
            K_AX_ERROR_ACTION_UNSUPPORTED => "Action unsupported",
            K_AX_ERROR_API_DISABLED => "Accessibility API disabled",
            K_AX_ERROR_NO_VALUE => "No value",
            _ => "Unknown error",
        };
        Self::new(code, message)
    }
}

/// Safe wrapper around AXUIElementRef
pub struct AXUIElement {
    inner: AXUIElementRef,
}

impl Drop for AXUIElement {
    fn drop(&mut self) {
        if !self.inner.is_null() {
            unsafe { CFRelease(self.inner as CFTypeRef) };
        }
    }
}

impl AXUIElement {
    /// Create an AXUIElement for an application by PID
    pub fn application(pid: i32) -> Self {
        let inner = unsafe { AXUIElementCreateApplication(pid) };
        Self { inner }
    }

    /// Create a system-wide AXUIElement
    pub fn system_wide() -> Self {
        let inner = unsafe { AXUIElementCreateSystemWide() };
        Self { inner }
    }

    /// Get the raw reference (for child elements)
    fn from_raw(raw: AXUIElementRef) -> Self {
        Self { inner: raw }
    }

    /// Get an attribute value as a string
    pub fn get_string_attribute(&self, name: &str) -> Option<String> {
        let attr_name = CFString::new(name);
        let mut value: CFTypeRef = ptr::null_mut();

        let result = unsafe {
            AXUIElementCopyAttributeValue(self.inner, attr_name.as_concrete_TypeRef(), &mut value)
        };

        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }

        // Try to convert to CFString
        let cf_type = unsafe { CFType::wrap_under_create_rule(value) };
        cf_type.downcast::<CFString>().map(|s| s.to_string())
    }

    /// Get an attribute value as a boolean
    pub fn get_bool_attribute(&self, name: &str) -> Option<bool> {
        let attr_name = CFString::new(name);
        let mut value: CFTypeRef = ptr::null_mut();

        let result = unsafe {
            AXUIElementCopyAttributeValue(self.inner, attr_name.as_concrete_TypeRef(), &mut value)
        };

        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }

        let cf_type = unsafe { CFType::wrap_under_create_rule(value) };
        cf_type
            .downcast::<core_foundation::boolean::CFBoolean>()
            .map(|b| b == core_foundation::boolean::CFBoolean::true_value())
    }

    /// Get child elements (AXChildren attribute)
    pub fn children(&self) -> Vec<AXUIElement> {
        let attr_name = CFString::new("AXChildren");
        let mut value: CFTypeRef = ptr::null_mut();

        let result = unsafe {
            AXUIElementCopyAttributeValue(self.inner, attr_name.as_concrete_TypeRef(), &mut value)
        };

        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return vec![];
        }

        let cf_type = unsafe { CFType::wrap_under_create_rule(value) };
        let Some(array) = cf_type.downcast::<CFArray<CFType>>() else {
            return vec![];
        };

        let mut children = Vec::new();
        for i in 0..array.len() {
            if let Some(item) = array.get(i) {
                // Retain the element since we're creating a new owner
                let raw = item.as_CFTypeRef() as AXUIElementRef;
                unsafe { core_foundation::base::CFRetain(raw as CFTypeRef) };
                children.push(AXUIElement::from_raw(raw));
            }
        }
        children
    }

    /// Get the role of this element (AXRole)
    pub fn role(&self) -> Option<String> {
        self.get_string_attribute("AXRole")
    }

    /// Get the title of this element (AXTitle)
    pub fn title(&self) -> Option<String> {
        self.get_string_attribute("AXTitle")
    }

    /// Get the description of this element (AXDescription)
    pub fn description(&self) -> Option<String> {
        self.get_string_attribute("AXDescription")
    }

    /// Get the label of this element (AXLabel) - used by SwiftUI
    pub fn label(&self) -> Option<String> {
        self.get_string_attribute("AXLabel")
    }

    /// Get the identifier of this element (AXIdentifier)
    pub fn identifier(&self) -> Option<String> {
        self.get_string_attribute("AXIdentifier")
    }

    /// Get the value of this element (AXValue) - for checkboxes, text fields, etc.
    pub fn value(&self) -> Option<String> {
        self.get_string_attribute("AXValue")
    }

    /// Check if element is enabled
    pub fn is_enabled(&self) -> bool {
        self.get_bool_attribute("AXEnabled").unwrap_or(false)
    }

    /// Perform an action on this element
    pub fn perform_action(&self, action: &str) -> Result<(), AccessibilityError> {
        let action_name = CFString::new(action);
        let result = unsafe { AXUIElementPerformAction(self.inner, action_name.as_concrete_TypeRef()) };

        if result == K_AX_ERROR_SUCCESS {
            Ok(())
        } else {
            Err(AccessibilityError::from_code(result))
        }
    }

    /// Press/click this element (AXPress action)
    pub fn press(&self) -> Result<(), AccessibilityError> {
        self.perform_action("AXPress")
    }

    /// Set the value of a checkbox (AXValue attribute)
    pub fn set_value(&self, value: bool) -> Result<(), AccessibilityError> {
        let attr_name = CFString::new("AXValue");
        let cf_value = if value {
            core_foundation::boolean::CFBoolean::true_value()
        } else {
            core_foundation::boolean::CFBoolean::false_value()
        };

        let result = unsafe {
            AXUIElementSetAttributeValue(
                self.inner,
                attr_name.as_concrete_TypeRef(),
                cf_value.as_CFTypeRef(),
            )
        };

        if result == K_AX_ERROR_SUCCESS {
            Ok(())
        } else {
            Err(AccessibilityError::from_code(result))
        }
    }

    /// Find a descendant element by role
    pub fn find_by_role(&self, role: &str) -> Vec<AXUIElement> {
        let mut results = Vec::new();
        self.find_by_role_recursive(role, &mut results);
        results
    }

    fn find_by_role_recursive(&self, role: &str, results: &mut Vec<AXUIElement>) {
        if self.role().as_deref() == Some(role) {
            // Clone by retaining
            unsafe { core_foundation::base::CFRetain(self.inner as CFTypeRef) };
            results.push(AXUIElement::from_raw(self.inner));
        }
        for child in self.children() {
            child.find_by_role_recursive(role, results);
        }
    }

    /// Find a descendant element by label (SwiftUI accessibility label)
    pub fn find_by_label(&self, label: &str) -> Option<AXUIElement> {
        self.find_by_label_recursive(label)
    }

    fn find_by_label_recursive(&self, label: &str) -> Option<AXUIElement> {
        if self.label().as_deref() == Some(label) {
            unsafe { core_foundation::base::CFRetain(self.inner as CFTypeRef) };
            return Some(AXUIElement::from_raw(self.inner));
        }
        for child in self.children() {
            if let Some(found) = child.find_by_label_recursive(label) {
                return Some(found);
            }
        }
        None
    }

    /// Find a descendant element by title
    pub fn find_by_title(&self, title: &str) -> Option<AXUIElement> {
        self.find_by_title_recursive(title)
    }

    fn find_by_title_recursive(&self, title: &str) -> Option<AXUIElement> {
        if self.title().as_deref() == Some(title) {
            unsafe { core_foundation::base::CFRetain(self.inner as CFTypeRef) };
            return Some(AXUIElement::from_raw(self.inner));
        }
        for child in self.children() {
            if let Some(found) = child.find_by_title_recursive(title) {
                return Some(found);
            }
        }
        None
    }

    /// Debug: print the accessibility tree
    pub fn debug_tree(&self, indent: usize) {
        let prefix = "  ".repeat(indent);
        let role = self.role().unwrap_or_default();
        let title = self.title().unwrap_or_default();
        let label = self.label().unwrap_or_default();
        let desc = self.description().unwrap_or_default();

        eprintln!(
            "{}[{}] title={:?} label={:?} desc={:?}",
            prefix, role, title, label, desc
        );

        for child in self.children() {
            child.debug_tree(indent + 1);
        }
    }
}

/// Check if the current process has accessibility permission
pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_accessibility_trusted() {
        // Just ensure it doesn't crash
        let _ = is_accessibility_trusted();
    }
}
```

## Verification

1. Add `mod accessibility;` to `src-tauri/src/lib.rs`
2. Run `cargo check -p mortician` to verify compilation
3. The module should compile without errors

## Success Criteria

- [ ] `accessibility.rs` compiles without errors
- [ ] `AXUIElement` wrapper provides safe access to AX API
- [ ] `is_accessibility_trusted()` function works
- [ ] Debug tree printing works for exploring UI hierarchies

## Notes

- All AXUIElement operations require Accessibility permission
- The debug_tree() function is invaluable for understanding System Settings structure
- Child element iteration handles memory management via CFRetain/CFRelease
