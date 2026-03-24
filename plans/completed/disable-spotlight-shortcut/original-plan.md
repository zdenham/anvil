# Plan: Disable Spotlight Shortcut via macOS Accessibility API

## Problem

The current AppleScript approach for disabling the system Spotlight shortcut (Cmd+Space) is fragile:
- SwiftUI accessibility labels (e.g., "Spotlight shortcuts") are not exposed to AppleScript
- Must iterate through all sidebar rows checking right pane content
- Slow and prone to breaking with macOS updates

## Goal

Implement a Rust-native solution using the macOS Accessibility API (AXUIElement) to:
1. Navigate System Settings programmatically
2. Find UI elements by their accessibility labels directly
3. Disable the Spotlight shortcut via a button in the existing onboarding `SpotlightStep`
4. Support independent CLI execution via `anvil-test` for testing and debugging

## Integration Requirements

1. **UI Integration**: Add an "Auto-disable" button to the existing `SpotlightStep.tsx` onboarding pane (alongside the manual instructions)
2. **Independent Testing**: The core Rust logic must be executable via `anvil-test disable-spotlight` command for testing without running the full app
3. **Tauri Command**: Expose as a Tauri command for the frontend button to invoke

## Technical Background

### Current Codebase
- **CGEvent API**: Already used in `src-tauri/src/clipboard.rs` for keyboard synthesis (Cmd+V paste)
- **CoreGraphics**: Used in `src-tauri/src/bin/anvil-test/accessibility.rs` for window enumeration
- **No AXUIElement usage**: The app doesn't currently use the Accessibility framework for UI automation

### Why AXUIElement?
- Direct access to the accessibility tree (same as Accessibility Inspector)
- Can query elements by `AXLabel`, `AXTitle`, `AXDescription`, `AXIdentifier`
- Can perform actions: `AXPress`, `AXPick`, `AXConfirm`
- Works with SwiftUI components (unlike AppleScript bridge)

## Implementation Plan

### Phase 1: Add Accessibility Framework Bindings

**File**: `src-tauri/src/accessibility.rs` (new)

Add Rust bindings for AXUIElement API:

```rust
use core_foundation::base::{CFType, TCFType};
use core_foundation::string::CFString;
use core_foundation::array::CFArray;

// Link to ApplicationServices framework
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementPerformAction(
        element: AXUIElementRef,
        action: CFStringRef,
    ) -> AXError;
    fn AXUIElementCopyAttributeNames(
        element: AXUIElementRef,
        names: *mut CFArrayRef,
    ) -> AXError;
}

// Wrapper types
pub struct AXUIElement { /* ... */ }

impl AXUIElement {
    pub fn application(pid: i32) -> Self;
    pub fn attribute<T>(&self, name: &str) -> Option<T>;
    pub fn children(&self) -> Vec<AXUIElement>;
    pub fn perform_action(&self, action: &str) -> Result<(), AXError>;

    // High-level queries
    pub fn find_by_role(&self, role: &str) -> Vec<AXUIElement>;
    pub fn find_by_label(&self, label: &str) -> Option<AXUIElement>;
    pub fn find_by_title(&self, title: &str) -> Option<AXUIElement>;
}
```

**Dependencies** (Cargo.toml):
```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.9"
```

### Phase 2: System Settings Navigation Helper

**File**: `src-tauri/src/system_settings.rs` (new)

```rust
pub struct SystemSettingsNavigator {
    app: AXUIElement,
}

impl SystemSettingsNavigator {
    /// Launch System Settings and get AX reference
    pub fn open() -> Result<Self, Error>;

    /// Navigate to a specific pane by URL scheme
    pub fn open_pane(pane_url: &str) -> Result<Self, Error>;

    /// Wait for window to be ready
    pub fn wait_for_window(&self, timeout_ms: u64) -> Result<AXUIElement, Error>;

    /// Find button by accessibility label (works with SwiftUI)
    pub fn find_button(&self, label: &str) -> Option<AXUIElement>;

    /// Find checkbox by label
    pub fn find_checkbox(&self, label: &str) -> Option<AXUIElement>;

    /// Click a button
    pub fn click_button(&self, label: &str) -> Result<(), Error>;

    /// Set checkbox state
    pub fn set_checkbox(&self, label: &str, checked: bool) -> Result<(), Error>;

    /// Close System Settings
    pub fn close(&self);
}
```

### Phase 3: Spotlight Shortcut Disabler

**File**: `src-tauri/src/spotlight_shortcut.rs` (new)

```rust
pub fn disable_spotlight_shortcut() -> Result<(), Error> {
    // 1. Open Keyboard preferences
    let nav = SystemSettingsNavigator::open_pane(
        "x-apple.systempreferences:com.apple.preference.keyboard"
    )?;

    // 2. Wait for window
    let window = nav.wait_for_window(3000)?;

    // 3. Find and click "Keyboard Shortcuts..." button
    nav.click_button("Keyboard Shortcuts…")?;

    // 4. Wait for sheet
    nav.wait_for_sheet(3000)?;

    // 5. Find "Spotlight shortcuts" in sidebar by label (direct lookup!)
    nav.click_button("Spotlight shortcuts")?;

    // 6. Uncheck "Show Spotlight search" checkbox
    nav.set_checkbox("Show Spotlight search", false)?;

    // 7. Click Done and close
    nav.click_button("Done")?;
    nav.close();

    Ok(())
}

pub fn is_spotlight_shortcut_enabled() -> Result<bool, Error> {
    // Similar navigation, but just check checkbox state
    // Return true if enabled, false if disabled
}
```

### Phase 4: Tauri Command Integration

**File**: `src-tauri/src/lib.rs` (modify)

```rust
#[tauri::command]
async fn disable_system_spotlight_shortcut() -> Result<(), String> {
    spotlight_shortcut::disable_spotlight_shortcut()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn is_system_spotlight_enabled() -> Result<bool, String> {
    spotlight_shortcut::is_spotlight_shortcut_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_accessibility_permission() -> bool {
    // Check if app has accessibility permission
    // Uses AXIsProcessTrusted() or similar
}

#[tauri::command]
async fn request_accessibility_permission() {
    // Open System Settings to Accessibility pane
    // Show the app in the list for user to enable
}
```

### Phase 5: anvil-test CLI Integration

**File**: `src-tauri/src/bin/anvil-test/main.rs` (modify)

Add new subcommand for testing the spotlight disable functionality independently:

```rust
#[derive(Subcommand)]
enum Commands {
    // ... existing commands ...

    /// Disable the system Spotlight keyboard shortcut
    DisableSpotlight {
        /// Dry run - just check if shortcut is enabled without modifying
        #[arg(long)]
        dry_run: bool,
    },

    /// Check accessibility permission status
    CheckAccessibility,
}

// In main():
Commands::DisableSpotlight { dry_run } => {
    if dry_run {
        let enabled = spotlight_shortcut::is_spotlight_shortcut_enabled()?;
        println!("{}", serde_json::json!({ "spotlight_enabled": enabled }));
    } else {
        spotlight_shortcut::disable_spotlight_shortcut()?;
        eprintln!("Spotlight shortcut disabled successfully");
    }
}

Commands::CheckAccessibility => {
    let has_permission = accessibility::check_accessibility_permission();
    println!("{}", serde_json::json!({ "has_accessibility_permission": has_permission }));
    std::process::exit(if has_permission { 0 } else { 1 });
}
```

**File**: `src-tauri/src/bin/anvil-test/spotlight_shortcut.rs` (new - shared with main crate)

The core spotlight shortcut logic should be in a module that can be used by both:
- The main Tauri app (via `src-tauri/src/spotlight_shortcut.rs`)
- The anvil-test CLI (imported or duplicated)

Option A: Shared library crate
Option B: Symlink or include the module in both places
Option C: Move to a workspace crate `anvil-core`

Recommended: **Option B** for simplicity - the anvil-test binary can import from the parent crate:

```rust
// In anvil-test/main.rs
use anvil::spotlight_shortcut;
```

### Phase 6: SpotlightStep UI Enhancement

**File**: `src/components/onboarding/steps/SpotlightStep.tsx` (modify)

Enhance the existing component to add an "Auto-disable" button:

```typescript
export const SpotlightStep = ({}: SpotlightStepProps) => {
  const [hasDisabled, setHasDisabled] = useState(false);
  const [willSkip, setWillSkip] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState<boolean | null>(null);

  // Check accessibility permission on mount
  useEffect(() => {
    invoke<boolean>('check_accessibility_permission').then(setHasAccessibilityPermission);
  }, []);

  const handleAutoDisable = async () => {
    setIsDisabling(true);
    setError(null);
    try {
      await invoke('disable_system_spotlight_shortcut');
      setHasDisabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDisabling(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ... existing header ... */}

      {/* NEW: Auto-disable option */}
      <div className="bg-surface-700 border border-surface-600 rounded-lg p-4">
        <p className="font-medium text-surface-100 mb-3">Quick option:</p>
        {hasAccessibilityPermission === false ? (
          <div className="space-y-2">
            <p className="text-sm text-surface-300">
              Anvil needs Accessibility permission to auto-disable Spotlight.
            </p>
            <Button onClick={() => invoke('request_accessibility_permission')}>
              Grant Accessibility Permission
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleAutoDisable}
            disabled={isDisabling || hasDisabled}
            variant="primary"
          >
            {isDisabling ? "Disabling..." : hasDisabled ? "Disabled ✓" : "Auto-disable Spotlight Shortcut"}
          </Button>
        )}
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      </div>

      {/* Existing manual instructions section */}
      <div className="bg-surface-700 border border-surface-600 rounded-lg p-4 space-y-4">
        <p className="font-medium text-surface-100">Or disable manually:</p>
        {/* ... existing step-by-step instructions ... */}
      </div>
    </div>
  );
};
```

### Phase 7: Permission Handling

**File**: `src-tauri/src/spotlight_shortcut.rs` (add to existing)

```rust
/// Check if the app has accessibility permission
pub fn check_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

/// Open System Settings to the Accessibility pane
pub fn request_accessibility_permission() -> Result<(), Error> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| Error::new(&format!("Failed to open settings: {}", e)))?;
    Ok(())
}
```

## File Structure

```
src-tauri/src/
├── accessibility.rs           (NEW - AXUIElement bindings)
├── system_settings.rs         (NEW - System Settings navigator)
├── spotlight_shortcut.rs      (NEW - Spotlight disable logic + permission checks)
├── lib.rs                     (MODIFY - add Tauri commands)
└── bin/
    └── anvil-test/
        └── main.rs            (MODIFY - add disable-spotlight and check-accessibility commands)

src/components/onboarding/
├── steps/
│   └── SpotlightStep.tsx      (MODIFY - add auto-disable button)
└── ...
```

## Key Advantages Over AppleScript

| Aspect | AppleScript | AXUIElement API |
|--------|-------------|-----------------|
| SwiftUI labels | Not accessible | Full access via AXLabel |
| Speed | Slow (polling/iteration) | Direct element lookup |
| Reliability | Fragile, breaks with UI changes | More stable (semantic queries) |
| Error handling | Limited | Full error codes |
| Integration | Shell out to osascript | Native Rust, in-process |

## Testing Strategy

1. **Unit tests**: Mock AXUIElement responses
2. **Integration tests**: Use existing `anvil-test` CLI infrastructure
3. **Manual testing**: Verify on different macOS versions (13, 14, 15)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Accessibility permission required | Add permission check/request flow in onboarding |
| System Settings UI changes | Use semantic labels, not positional queries |
| macOS version differences | Test on multiple versions, add version checks |
| User denies permission | Provide manual instructions fallback |

## Alternative: Direct Defaults Write

If accessibility approach proves too complex, consider:

```bash
# Check current value
defaults read com.apple.symbolichotkeys AppleSymbolicHotKeys | grep -A4 "64 ="

# Disable Spotlight shortcut (key 64)
defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 64 '{enabled = 0; value = { parameters = (32, 49, 1048576); type = standard; }; }'

# Restart cfprefsd to apply
killall cfprefsd
```

This is faster but:
- Requires logout/restart to take effect
- Less user-friendly
- May not work on all macOS versions

## Implementation Order

1. **Phase 1**: Accessibility bindings (foundation)
2. **Phase 2**: System Settings navigator (reusable)
3. **Phase 3**: Spotlight disabler (core feature)
4. **Phase 4**: Tauri commands (backend complete)
5. **Phase 5**: anvil-test CLI integration (independent testing)
6. **Phase 6**: SpotlightStep UI enhancement (user-facing button)
7. **Phase 7**: Permission handling (polish)

## Success Criteria

- [ ] Can find "Spotlight shortcuts" button by label in < 100ms
- [ ] Successfully disables shortcut on macOS 13, 14, 15
- [ ] Graceful fallback if permission denied
- [ ] **Button added to existing SpotlightStep.tsx onboarding pane**
- [ ] **`anvil-test disable-spotlight` works independently for testing**
- [ ] **`anvil-test disable-spotlight --dry-run` checks status without modifying**
- [ ] **`anvil-test check-accessibility` reports permission status**
- [ ] No AppleScript dependency

## CLI Usage Examples

```bash
# Check if spotlight shortcut is enabled (dry run)
anvil-test disable-spotlight --dry-run
# Output: {"spotlight_enabled": true}

# Disable the spotlight shortcut
anvil-test disable-spotlight
# Output: Spotlight shortcut disabled successfully

# Check accessibility permission
anvil-test check-accessibility
# Output: {"has_accessibility_permission": true}
# Exit code: 0 if granted, 1 if not
```
