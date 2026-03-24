# Phase 7: Permission Handling Polish

## Goal

Ensure robust accessibility permission handling with good UX for edge cases.

## Prerequisites

- Phases 4, 5, 6 complete (all integration points working)

## Output

**Modified Files:**
- `src-tauri/src/accessibility.rs` - Add permission prompt helper
- `src-tauri/src/lib.rs` - Add additional permission commands
- `src/components/onboarding/steps/SpotlightStep.tsx` - Handle edge cases

## Implementation

### 1. Enhanced Permission Checking

Add to `src-tauri/src/accessibility.rs`:

```rust
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
```

### 2. Additional Tauri Commands

Add to `src-tauri/src/lib.rs`:

```rust
/// Check accessibility permission with optional system prompt
#[tauri::command]
fn check_accessibility_permission_with_prompt(prompt: bool) -> bool {
    crate::accessibility::check_accessibility_with_prompt(prompt)
}

/// Get detailed accessibility status for debugging
#[tauri::command]
fn get_accessibility_status() -> serde_json::Value {
    let has_permission = crate::accessibility::is_accessibility_trusted();

    serde_json::json!({
        "has_permission": has_permission,
        "app_name": std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
    })
}
```

Register in invoke_handler:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing ...
    check_accessibility_permission_with_prompt,
    get_accessibility_status,
])
```

### 3. Enhanced SpotlightStep Error Handling

Update `src/components/onboarding/steps/SpotlightStep.tsx` to handle more edge cases:

```typescript
// Add near the top of the component
const [retryCount, setRetryCount] = useState(0);

// Update handleAutoDisable to track retries
const handleAutoDisable = async () => {
  setStatus('disabling');
  setError(null);
  try {
    await invoke('disable_system_spotlight_shortcut');
    setStatus('success');
  } catch (err) {
    setStatus('error');
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Provide more helpful error messages
    if (errorMessage.includes('permission') || errorMessage.includes('Permission')) {
      setError('Accessibility permission was revoked. Please grant it again.');
      setHasAccessibilityPermission(false);
    } else if (errorMessage.includes('not found') || errorMessage.includes('NotFound')) {
      setError(
        'Could not find the Spotlight settings. ' +
        'This might be due to a different macOS version. ' +
        'Please use the manual instructions below.'
      );
    } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      setError(
        'System Settings took too long to respond. ' +
        'Please close any open System Settings windows and try again.'
      );
    } else {
      setError(errorMessage);
    }
    setRetryCount(prev => prev + 1);
  }
};

// In the error state render, show different options based on retry count
{status === 'error' && retryCount >= 2 && (
  <p className="text-sm text-surface-400 mt-2">
    Having trouble? Try the manual instructions below, or restart your Mac
    and try again.
  </p>
)}
```

### 4. Add anvil-test Debug Commands

Add to `src-tauri/src/bin/anvil-test/main.rs`:

```rust
Commands::CheckAccessibility => {
    let has_permission = accessibility::is_accessibility_trusted();
    let app_path = std::env::current_exe().ok();

    println!("{}", serde_json::json!({
        "has_accessibility_permission": has_permission,
        "executable": app_path.map(|p| p.display().to_string()),
        "note": if !has_permission {
            Some("Run 'anvil-test request-accessibility' to grant permission")
        } else {
            None
        }
    }));
    std::process::exit(if has_permission { 0 } else { 1 });
}
```

### 5. TypeScript Helper Functions

Add to `src/lib/tauri-commands.ts`:

```typescript
export interface AccessibilityStatus {
  has_permission: boolean;
  app_name: string | null;
}

export async function getAccessibilityStatus(): Promise<AccessibilityStatus> {
  return invoke('get_accessibility_status');
}

export async function checkAccessibilityWithPrompt(prompt: boolean): Promise<boolean> {
  return invoke('check_accessibility_permission_with_prompt', { prompt });
}
```

## Testing Scenarios

1. **Fresh install (no permission):**
   - Component should show "Grant Accessibility Permission" button
   - Clicking should open System Settings
   - After granting, button should change to "Auto-disable"

2. **Permission granted:**
   - Should immediately show "Auto-disable" button
   - Clicking should disable the shortcut
   - Success message should appear

3. **Permission revoked mid-flow:**
   - Should detect and show permission request again
   - Should not crash or hang

4. **System Settings already open:**
   - Should handle gracefully (might timeout)
   - Error message should suggest closing Settings

5. **Different macOS version:**
   - Debug tree output helps identify element names
   - Error message points to manual instructions

## Verification

1. Test all scenarios above
2. Run `anvil-test check-accessibility` to verify CLI
3. Run `anvil-test disable-spotlight --debug` on different macOS versions
4. Verify error messages are helpful

## Success Criteria

- [ ] Permission prompt appears when using `check_accessibility_with_prompt(true)`
- [ ] Permission revocation is detected and handled
- [ ] Error messages are actionable and helpful
- [ ] Multiple retries don't crash the app
- [ ] CLI provides good debugging output
- [ ] Works on macOS 13, 14, and 15

## Notes

- `AXIsProcessTrustedWithOptions` with prompt shows a system dialog
- Error categorization helps users understand what went wrong
- The retry count helps decide when to suggest alternatives
- Debug output from anvil-test is essential for supporting different macOS versions
