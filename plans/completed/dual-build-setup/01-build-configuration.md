# 01: Build Configuration

## Current State

### Tauri Config (`src-tauri/tauri.conf.json`)
```json
{
  "productName": "desktop",
  "identifier": "com.getanvil.app",
  "build": {
    "devUrl": "http://localhost:1420"
  }
}
```

### Vite Config (`vite.config.ts`)
```typescript
server: {
  port: 1420,
  strictPort: true,  // Fails if port unavailable
}
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANVIL_APP_SUFFIX` | Appended to app ID and name (baked at build time) | _(none)_ |
| `ANVIL_VITE_PORT` | Vite dev server port | `1420` |

## Implementation

### Approach: Tauri Config Overlays + Build-Time Baking

We use Tauri's `--config` flag with overlay files for each instance. This is simpler and more maintainable than generating configs dynamically.

**Create**: `src-tauri/tauri.conf.dev.json` (example for "dev" suffix)
```json
{
  "productName": "Anvil Dev",
  "identifier": "com.getanvil.app.dev",
  "build": {
    "devUrl": "http://localhost:1421"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Anvil Dev"
      }
    ]
  },
  "bundle": {
    "icon": [
      "icons-dev/32x32.png",
      "icons-dev/128x128.png",
      "icons-dev/128x128@2x.png",
      "icons-dev/icon.icns",
      "icons-dev/icon.ico"
    ]
  }
}
```

**Build with overlay**:
```bash
cargo tauri build --config src-tauri/tauri.conf.dev.json
```

### Vite Config Changes

**File**: `vite.config.ts`

```typescript
import { defineConfig } from "vite";

const vitePort = parseInt(process.env.ANVIL_VITE_PORT || '1420', 10);
const appSuffix = process.env.ANVIL_APP_SUFFIX || '';

export default defineConfig(async () => ({
  server: {
    port: vitePort,
    strictPort: true,
    hmr: vitePort !== 1420
      ? { port: vitePort + 1, host: 'localhost' }
      : undefined,
  },
  define: {
    __ANVIL_APP_SUFFIX__: JSON.stringify(appSuffix),
    __ANVIL_VITE_PORT__: JSON.stringify(vitePort),
  },
}));
```

### Rust: Build-Time Baking via build.rs

**Important**: Runtime env vars won't be available when users launch the app from Finder/Dock. We bake the suffix at build time so installed apps work correctly.

**Update**: `src-tauri/build.rs`

```rust
fn main() {
    // Bake ANVIL_APP_SUFFIX into the binary at compile time
    let suffix = std::env::var("ANVIL_APP_SUFFIX").unwrap_or_default();
    println!("cargo:rustc-env=ANVIL_APP_SUFFIX={}", suffix);

    // Bake default hotkeys
    let spotlight_hotkey = std::env::var("ANVIL_SPOTLIGHT_HOTKEY")
        .unwrap_or_else(|_| "Command+Space".to_string());
    let clipboard_hotkey = std::env::var("ANVIL_CLIPBOARD_HOTKEY")
        .unwrap_or_else(|_| "Command+Option+C".to_string());
    println!("cargo:rustc-env=ANVIL_SPOTLIGHT_HOTKEY={}", spotlight_hotkey);
    println!("cargo:rustc-env=ANVIL_CLIPBOARD_HOTKEY={}", clipboard_hotkey);

    tauri_build::build()
}
```

**Create**: `src-tauri/src/build_info.rs`

```rust
//! Build-time baked configuration values.
//! These are set during `cargo build` via build.rs and cannot be changed at runtime.

/// App suffix baked at build time (e.g., "dev", "feature-xyz", or "" for production)
pub const APP_SUFFIX: &str = env!("ANVIL_APP_SUFFIX");

/// Default spotlight hotkey baked at build time
pub const DEFAULT_SPOTLIGHT_HOTKEY: &str = env!("ANVIL_SPOTLIGHT_HOTKEY");

/// Default clipboard hotkey baked at build time
pub const DEFAULT_CLIPBOARD_HOTKEY: &str = env!("ANVIL_CLIPBOARD_HOTKEY");

/// Check if this is a non-production build
pub const fn is_alternate_build() -> bool {
    !APP_SUFFIX.is_empty()
}

/// Get the display name suffix (e.g., " Dev" or "" for production)
pub fn display_suffix() -> &'static str {
    match APP_SUFFIX {
        "" => "",
        "dev" => " Dev",
        "canary" => " Canary",
        other => {
            // For unknown suffixes, we can't easily capitalize at const time
            // The caller should handle this case
            other
        }
    }
}
```

## Files to Modify/Create

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.dev.json` | **NEW**: Config overlay for dev build |
| `src-tauri/src/build_info.rs` | **NEW**: Build-time constants module |
| `src-tauri/build.rs` | **MODIFY**: Bake suffix and hotkeys into binary |
| `vite.config.ts` | **MODIFY**: Read `ANVIL_VITE_PORT`, `ANVIL_APP_SUFFIX` |
| `src-tauri/src/lib.rs` | **MODIFY**: Add `mod build_info;` |

## Verification

```bash
# Build production (no env vars needed)
pnpm build
# Check: identifier = com.getanvil.app

# Build dev variant (uses shell script preset)
pnpm build:dev
# Check: identifier = com.getanvil.app.dev

# Verify both can be installed side-by-side
mdls -name kMDItemCFBundleIdentifier /Applications/Anvil.app
mdls -name kMDItemCFBundleIdentifier /Applications/Anvil\ Dev.app

# Verify baked values in binary
strings "src-tauri/target/release/bundle/macos/Anvil Dev.app/Contents/MacOS/Anvil Dev" | grep -i "anvil"
```
