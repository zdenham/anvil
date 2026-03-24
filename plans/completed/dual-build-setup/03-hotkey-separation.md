# 03: Hotkey Separation

## Current State

### Hotkey Definitions

**`src-tauri/src/lib.rs`**:
```rust
const CLIPBOARD_HOTKEY: &str = "Command+Option+C";
```

**`src-tauri/src/config.rs`** (user-configurable):
```rust
// Default spotlight hotkey, can be changed during onboarding
// Stored in config.json as "spotlight_hotkey"
```

### Registration Flow

1. User completes onboarding, chooses spotlight hotkey
2. `save_hotkey()` stores to config and registers
3. `register_hotkey()` registers both:
   - User's spotlight hotkey
   - Fixed clipboard hotkey (`Command+Option+C`)

### Conflict Issue

Global hotkeys are OS-wide. If multiple Anvil instances register the same hotkey:
- Only one will work (last registered wins)
- Switching between apps causes hotkey fights

## Design: Build-Time Baked Hotkey Defaults

**Key insight**: Hotkeys are baked at build time via `build.rs` (see 01-build-configuration.md). This ensures installed apps have the correct defaults without needing env vars at runtime.

| Build | Spotlight Default | Clipboard Default |
|-------|-------------------|-------------------|
| Production | `Command+Space` | `Command+Option+C` |
| Dev | `Command+Shift+Space` | `Command+Shift+Option+C` |

Users can still customize via onboarding/settings - this just sets different defaults per build.

## Implementation

### Use Build-Time Constants

The hotkey defaults are baked in `build.rs` and exposed via `build_info.rs` (see 01-build-configuration.md).

**Usage in hotkey code**:

```rust
use crate::build_info;

/// Get the clipboard hotkey (baked default)
pub fn clipboard_hotkey() -> &'static str {
    build_info::DEFAULT_CLIPBOARD_HOTKEY
}

/// Get the default spotlight hotkey (baked default)
pub fn default_spotlight_hotkey() -> &'static str {
    build_info::DEFAULT_SPOTLIGHT_HOTKEY
}
```

### Update Hotkey Registration

**`src-tauri/src/lib.rs`**:
```rust
use crate::build_info;

fn register_hotkeys(app: &AppHandle) {
    let clipboard_hk = build_info::DEFAULT_CLIPBOARD_HOTKEY;
    let spotlight_hk = get_spotlight_hotkey_from_config()
        .unwrap_or_else(|| build_info::DEFAULT_SPOTLIGHT_HOTKEY.to_string());

    // Register clipboard hotkey
    app.global_shortcut()
        .register(clipboard_hk)
        .expect("Failed to register clipboard hotkey");

    // Register spotlight hotkey
    app.global_shortcut()
        .register(&spotlight_hk)
        .expect("Failed to register spotlight hotkey");
}
```

### Update Config Loading

**`src-tauri/src/config.rs`**:
```rust
use crate::build_info;

pub fn get_spotlight_hotkey() -> Result<String, String> {
    let config = load_config()?;
    Ok(config.spotlight_hotkey.unwrap_or_else(|| {
        build_info::DEFAULT_SPOTLIGHT_HOTKEY.to_string()
    }))
}
```

### Onboarding Suggestions

Update onboarding UI to show appropriate defaults based on build.

**Add Tauri command** (in `anvil_commands.rs`):
```rust
use crate::build_info;

#[tauri::command]
pub fn get_default_hotkeys() -> HotkeyDefaults {
    HotkeyDefaults {
        spotlight: build_info::DEFAULT_SPOTLIGHT_HOTKEY.to_string(),
        clipboard: build_info::DEFAULT_CLIPBOARD_HOTKEY.to_string(),
        app_suffix: build_info::APP_SUFFIX.to_string(),
        is_alternate_build: build_info::is_alternate_build(),
    }
}

#[derive(serde::Serialize)]
pub struct HotkeyDefaults {
    pub spotlight: String,
    pub clipboard: String,
    pub app_suffix: String,
    pub is_alternate_build: bool,
}
```

**Frontend**: `src/components/onboarding/HotkeyStep.tsx`

```typescript
const defaults = await invoke<HotkeyDefaults>('get_default_hotkeys');

// Show the default for this instance
<p>Suggested hotkey: {defaults.spotlight}</p>
<p>Clipboard hotkey: {defaults.clipboard} (fixed)</p>
```

### Settings Display

Show current hotkeys with instance context:

```typescript
const { app_suffix, spotlight, clipboard } = await invoke<HotkeyDefaults>('get_default_hotkeys');

<div className="settings-section">
  <h3>
    Keyboard Shortcuts
    {app_suffix && <Badge>{app_suffix}</Badge>}
  </h3>
  <p>Spotlight: {currentSpotlightHotkey}</p>
  <p>Clipboard: {clipboard}</p>
</div>
```

## Example Configurations

| Instance | Spotlight | Clipboard |
|----------|-----------|-----------|
| Production | `Command+Space` | `Command+Option+C` |
| Development | `Command+Shift+Space` | `Command+Shift+Option+C` |
| Feature X | `Command+Control+Space` | `Command+Control+Option+C` |

## Files to Modify

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | **MODIFY**: Use `build_info::DEFAULT_*_HOTKEY` constants |
| `src-tauri/src/config.rs` | **MODIFY**: Use `build_info::DEFAULT_SPOTLIGHT_HOTKEY` |
| `src-tauri/src/anvil_commands.rs` | **MODIFY**: Add `get_default_hotkeys` command |
| `src/components/onboarding/*` | **MODIFY**: Query and display defaults |
| `src/components/settings/*` | **MODIFY**: Display instance indicator |

## Usage Examples

**Installed apps work automatically** - hotkeys are baked at build time:

```bash
# Production build
open /Applications/Anvil.app
# Hotkeys: Cmd+Space, Cmd+Option+C

# Dev build (different hotkeys baked in)
open /Applications/Anvil\ Dev.app
# Hotkeys: Cmd+Shift+Space, Cmd+Shift+Option+C
```

No env vars needed at runtime - the correct hotkeys are baked into each build.

## Verification

1. Build and install both production and dev apps
2. Launch production app
3. Verify `Command+Space` triggers spotlight
4. Verify `Command+Option+C` triggers clipboard
5. Launch dev app (simultaneously)
6. Verify `Command+Shift+Space` triggers dev spotlight
7. Verify `Command+Shift+Option+C` triggers dev clipboard
8. Both should work without interference

## Edge Cases

### User Already Completed Onboarding
- Existing config has their chosen hotkey (persisted in config.json)
- No conflict if they chose different hotkeys
- If conflict exists, user must manually change in settings

### Hotkey Collision Detection
Future enhancement: detect if another Anvil instance has registered a hotkey:

```rust
fn check_hotkey_available(hotkey: &str) -> bool {
    // Try to register temporarily
    // If fails, another app (possibly another Anvil) has it
    // Unregister and return result
}
```

### Build-Time Defaults Ensure No Conflicts
Since hotkeys are baked at build time, installed apps always have the correct defaults. No risk of a dev build accidentally using production hotkeys.
