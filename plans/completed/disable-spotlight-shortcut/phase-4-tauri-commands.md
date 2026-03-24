# Phase 4: Tauri Command Integration

## Goal

Expose the spotlight shortcut functions as Tauri commands so the frontend can invoke them.

## Prerequisites

- Phase 3 complete (spotlight_shortcut.rs with core logic)

## Output

**Modified File:** `src-tauri/src/lib.rs`

## Implementation

### Add Tauri Commands

Add these commands to `src-tauri/src/lib.rs`:

```rust
// Near top of file, add the module
mod spotlight_shortcut;

// Add these command functions:

/// Disable the system Spotlight keyboard shortcut
#[tauri::command]
async fn disable_system_spotlight_shortcut() -> Result<(), String> {
    // Run in blocking task since it does UI automation with sleeps
    tokio::task::spawn_blocking(|| {
        spotlight_shortcut::disable_spotlight_shortcut()
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}

/// Check if the system Spotlight shortcut is enabled
#[tauri::command]
async fn is_system_spotlight_enabled() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        spotlight_shortcut::is_spotlight_shortcut_enabled()
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}

/// Check if the app has accessibility permission
#[tauri::command]
fn check_accessibility_permission() -> bool {
    crate::accessibility::is_accessibility_trusted()
}

/// Open System Settings to the Accessibility pane for granting permission
#[tauri::command]
fn request_accessibility_permission() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| format!("Failed to open settings: {}", e))?;
    Ok(())
}
```

### Register Commands in invoke_handler

Find the `.invoke_handler(tauri::generate_handler![...])` block and add the new commands:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...

    // Spotlight shortcut commands
    disable_system_spotlight_shortcut,
    is_system_spotlight_enabled,
    check_accessibility_permission,
    request_accessibility_permission,
])
```

## TypeScript Types

Add to `src/lib/tauri-commands.ts` (or wherever Tauri invoke wrappers live):

```typescript
// Spotlight shortcut management
export async function disableSystemSpotlightShortcut(): Promise<void> {
  return invoke('disable_system_spotlight_shortcut');
}

export async function isSystemSpotlightEnabled(): Promise<boolean> {
  return invoke('is_system_spotlight_enabled');
}

export async function checkAccessibilityPermission(): Promise<boolean> {
  return invoke('check_accessibility_permission');
}

export async function requestAccessibilityPermission(): Promise<void> {
  return invoke('request_accessibility_permission');
}
```

## Verification

1. Run `cargo check -p anvil`
2. Start the app in dev mode: `pnpm tauri dev`
3. Open browser console and test:
   ```javascript
   await __TAURI__.invoke('check_accessibility_permission')
   // Should return true or false
   ```

## Success Criteria

- [ ] All four commands compile
- [ ] `check_accessibility_permission` returns correct boolean
- [ ] `request_accessibility_permission` opens System Settings
- [ ] `disable_system_spotlight_shortcut` works (with permission)
- [ ] `is_system_spotlight_enabled` returns correct status

## Notes

- Commands that do UI automation use `spawn_blocking` to avoid blocking the async runtime
- Permission check is synchronous since it's a simple FFI call
- The TypeScript wrappers provide type safety for frontend usage
