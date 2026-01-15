//! macOS Accessibility API bindings for UI automation
//!
//! Provides safe Rust wrappers around AXUIElement functions.

use core_foundation::base::{CFType, TCFType, CFTypeRef, CFIndex};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::array::CFArrayRef;
use std::ptr;

/// CGPoint for position
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

/// CGSize for dimensions
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CGSize {
    pub width: f64,
    pub height: f64,
}

/// CGRect for frame
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CGRect {
    pub origin: CGPoint,
    pub size: CGSize,
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(theArray: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(theArray: CFArrayRef, idx: CFIndex) -> CFTypeRef;
}

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
    fn AXUIElementCopyActionNames(
        element: AXUIElementRef,
        names: *mut CFArrayRef,
    ) -> AXError;
    fn AXUIElementCopyAttributeNames(
        element: AXUIElementRef,
        names: *mut CFArrayRef,
    ) -> AXError;
    fn AXValueGetValue(
        value: CFTypeRef,
        theType: i32,
        valuePtr: *mut std::ffi::c_void,
    ) -> bool;
}

// AXValue types
const K_AX_VALUE_TYPE_CG_POINT: i32 = 1;
const K_AX_VALUE_TYPE_CG_SIZE: i32 = 2;

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

    /// Get an attribute value as an integer (e.g., AXValue for checkboxes is 0/1)
    pub fn get_int_attribute(&self, name: &str) -> Option<i64> {
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
            .downcast::<core_foundation::number::CFNumber>()
            .and_then(|n| n.to_i64())
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

        // The value is a CFArray, use raw CF functions to iterate
        let array = value as CFArrayRef;
        let count = unsafe { CFArrayGetCount(array) };

        let mut children = Vec::new();
        for i in 0..count {
            let item = unsafe { CFArrayGetValueAtIndex(array, i) };
            if !item.is_null() {
                // Retain the element since we're creating a new owner
                let raw = item as AXUIElementRef;
                unsafe { core_foundation::base::CFRetain(raw as CFTypeRef) };
                children.push(AXUIElement::from_raw(raw));
            }
        }

        // Release the array we got from CopyAttributeValue
        unsafe { CFRelease(value) };

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

    /// Get all supported actions for this element
    pub fn supported_actions(&self) -> Vec<String> {
        let mut names: CFArrayRef = ptr::null_mut();
        let result = unsafe { AXUIElementCopyActionNames(self.inner, &mut names) };

        if result != K_AX_ERROR_SUCCESS || names.is_null() {
            return vec![];
        }

        let count = unsafe { CFArrayGetCount(names) };
        let mut actions = Vec::new();

        for i in 0..count {
            let item = unsafe { CFArrayGetValueAtIndex(names, i) };
            if !item.is_null() {
                let cf_str = unsafe { CFString::wrap_under_get_rule(item as CFStringRef) };
                actions.push(cf_str.to_string());
            }
        }

        unsafe { CFRelease(names as CFTypeRef) };
        actions
    }

    /// Get all attribute names for this element
    pub fn attribute_names(&self) -> Vec<String> {
        let mut names: CFArrayRef = ptr::null_mut();
        let result = unsafe { AXUIElementCopyAttributeNames(self.inner, &mut names) };

        if result != K_AX_ERROR_SUCCESS || names.is_null() {
            return vec![];
        }

        let count = unsafe { CFArrayGetCount(names) };
        let mut attrs = Vec::new();

        for i in 0..count {
            let item = unsafe { CFArrayGetValueAtIndex(names, i) };
            if !item.is_null() {
                let cf_str = unsafe { CFString::wrap_under_get_rule(item as CFStringRef) };
                attrs.push(cf_str.to_string());
            }
        }

        unsafe { CFRelease(names as CFTypeRef) };
        attrs
    }

    /// Get the position of this element (AXPosition)
    pub fn position(&self) -> Option<CGPoint> {
        let attr_name = CFString::new("AXPosition");
        let mut value: CFTypeRef = ptr::null_mut();

        let result = unsafe {
            AXUIElementCopyAttributeValue(self.inner, attr_name.as_concrete_TypeRef(), &mut value)
        };

        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }

        let mut point = CGPoint::default();
        let success = unsafe {
            AXValueGetValue(
                value,
                K_AX_VALUE_TYPE_CG_POINT,
                &mut point as *mut CGPoint as *mut std::ffi::c_void,
            )
        };

        unsafe { CFRelease(value) };

        if success {
            Some(point)
        } else {
            None
        }
    }

    /// Get the size of this element (AXSize)
    pub fn size(&self) -> Option<CGSize> {
        let attr_name = CFString::new("AXSize");
        let mut value: CFTypeRef = ptr::null_mut();

        let result = unsafe {
            AXUIElementCopyAttributeValue(self.inner, attr_name.as_concrete_TypeRef(), &mut value)
        };

        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }

        let mut size = CGSize::default();
        let success = unsafe {
            AXValueGetValue(
                value,
                K_AX_VALUE_TYPE_CG_SIZE,
                &mut size as *mut CGSize as *mut std::ffi::c_void,
            )
        };

        unsafe { CFRelease(value) };

        if success {
            Some(size)
        } else {
            None
        }
    }

    /// Get the frame (position + size) of this element
    pub fn frame(&self) -> Option<CGRect> {
        let pos = self.position()?;
        let size = self.size()?;
        Some(CGRect {
            origin: pos,
            size,
        })
    }

    /// Check if this element is selected (AXSelected)
    pub fn is_selected(&self) -> bool {
        self.get_bool_attribute("AXSelected").unwrap_or(false)
    }

    /// Check if this element has keyboard focus (AXFocused)
    pub fn is_focused(&self) -> bool {
        self.get_bool_attribute("AXFocused").unwrap_or(false)
    }

    /// Get the subrole of this element (AXSubrole)
    pub fn subrole(&self) -> Option<String> {
        self.get_string_attribute("AXSubrole")
    }

    /// Get the role description (AXRoleDescription)
    pub fn role_description(&self) -> Option<String> {
        self.get_string_attribute("AXRoleDescription")
    }

    /// Debug: Get a summary of this element's state for logging
    pub fn debug_summary(&self) -> String {
        let role = self.role().unwrap_or_else(|| "?".to_string());
        let desc = self.description().unwrap_or_default();
        let title = self.title().unwrap_or_default();
        let label = self.label().unwrap_or_default();
        let selected = self.is_selected();
        let focused = self.is_focused();
        let enabled = self.is_enabled();
        let pos = self.position();
        let size = self.size();
        let actions = self.supported_actions();

        format!(
            "[{}] desc={:?} title={:?} label={:?} | selected={} focused={} enabled={} | pos={:?} size={:?} | actions={:?}",
            role, desc, title, label, selected, focused, enabled, pos, size, actions
        )
    }

    /// Click using CGEvent mouse simulation at element center
    /// Used for AXUnknown elements (macOS Tahoe) that don't respond to AXPress
    pub fn click_with_mouse(&self) -> Result<(), AccessibilityError> {
        let frame = self.frame().ok_or_else(|| {
            AccessibilityError::new(-1, "Cannot get element frame for mouse click")
        })?;

        // Calculate center of element
        let center_x = frame.origin.x + frame.size.width / 2.0;
        let center_y = frame.origin.y + frame.size.height / 2.0;

        tracing::debug!(
            "click_with_mouse: clicking at ({}, {}), frame={:?}",
            center_x, center_y, frame
        );

        // Use CGEvent to simulate mouse click
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventCreateMouseEvent(
                source: CFTypeRef,
                mouseType: u32,
                mouseCursorPosition: CGPoint,
                mouseButton: u32,
            ) -> CFTypeRef;
            fn CGEventPost(tap: u32, event: CFTypeRef);
        }

        const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
        const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
        const K_CG_HID_EVENT_TAP: u32 = 0;
        const K_CG_MOUSE_BUTTON_LEFT: u32 = 0;

        let point = CGPoint { x: center_x, y: center_y };

        unsafe {
            // Mouse down
            let event = CGEventCreateMouseEvent(
                ptr::null_mut(),
                K_CG_EVENT_LEFT_MOUSE_DOWN,
                point,
                K_CG_MOUSE_BUTTON_LEFT,
            );
            if !event.is_null() {
                CGEventPost(K_CG_HID_EVENT_TAP, event);
                CFRelease(event);
            }

            // Small delay
            std::thread::sleep(std::time::Duration::from_millis(10));

            // Mouse up
            let event = CGEventCreateMouseEvent(
                ptr::null_mut(),
                K_CG_EVENT_LEFT_MOUSE_UP,
                point,
                K_CG_MOUSE_BUTTON_LEFT,
            );
            if !event.is_null() {
                CGEventPost(K_CG_HID_EVENT_TAP, event);
                CFRelease(event);
            }
        }

        Ok(())
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

    /// Find first element matching role and a predicate (more efficient than find_by_role + filter)
    pub fn find_first<F>(&self, role: &str, predicate: F) -> Option<AXUIElement>
    where
        F: Fn(&AXUIElement) -> bool,
    {
        self.find_first_recursive(role, &predicate)
    }

    fn find_first_recursive<F>(&self, role: &str, predicate: &F) -> Option<AXUIElement>
    where
        F: Fn(&AXUIElement) -> bool,
    {
        if self.role().as_deref() == Some(role) && predicate(self) {
            unsafe { core_foundation::base::CFRetain(self.inner as CFTypeRef) };
            return Some(AXUIElement::from_raw(self.inner));
        }
        for child in self.children() {
            if let Some(found) = child.find_first_recursive(role, predicate) {
                return Some(found);
            }
        }
        None
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

        // For elements that commonly have values, also print the value
        let value = self.value().unwrap_or_default();
        if !value.is_empty() {
            eprintln!(
                "{}[{}] title={:?} label={:?} desc={:?} value={:?}",
                prefix, role, title, label, desc, value
            );
        } else {
            eprintln!(
                "{}[{}] title={:?} label={:?} desc={:?}",
                prefix, role, title, label, desc
            );
        }

        for child in self.children() {
            child.debug_tree(indent + 1);
        }
    }

    /// Debug: return the accessibility tree as a string
    pub fn debug_tree_to_string(&self, indent: usize) -> String {
        let mut output = String::new();
        self.debug_tree_to_string_recursive(indent, &mut output);
        output
    }

    fn debug_tree_to_string_recursive(&self, indent: usize, output: &mut String) {
        use std::fmt::Write;

        let prefix = "  ".repeat(indent);
        let role = self.role().unwrap_or_default();
        let title = self.title().unwrap_or_default();
        let label = self.label().unwrap_or_default();
        let desc = self.description().unwrap_or_default();
        let value = self.value().unwrap_or_default();

        if !value.is_empty() {
            let _ = writeln!(
                output,
                "{}[{}] title={:?} label={:?} desc={:?} value={:?}",
                prefix, role, title, label, desc, value
            );
        } else {
            let _ = writeln!(
                output,
                "{}[{}] title={:?} label={:?} desc={:?}",
                prefix, role, title, label, desc
            );
        }

        for child in self.children() {
            child.debug_tree_to_string_recursive(indent + 1, output);
        }
    }
}

/// Check if the current process has accessibility permission
pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Check if accessibility permission is granted, with option to prompt
///
/// When `prompt` is true and permission is not granted, macOS will show
/// a system dialog asking the user to grant permission.
pub fn check_accessibility_with_prompt(prompt: bool) -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> bool;
    }

    if prompt {
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;

        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::true_value();

        let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);

        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
    } else {
        is_accessibility_trusted()
    }
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
