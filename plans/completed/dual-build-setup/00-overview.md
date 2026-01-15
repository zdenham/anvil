# Multi-Instance Build Setup

## Goal

Run **N separate instances** of Mort simultaneously:
- **Production Build**: Stable version used as the daily driver
- **Development Build**: Active development version being worked on
- **Feature Builds**: Additional instances for testing specific features

This enables "dogfooding" - using Mort to build Mort.

## Environment Variables

Each configurable aspect has its own environment variable with sensible defaults:

| Variable | Description | Default |
|----------|-------------|---------|
| `MORT_APP_SUFFIX` | Suffix for app identifier and name | _(none)_ |
| `MORT_DATA_DIR` | Data directory path | `~/.mort` |
| `MORT_CONFIG_DIR` | Config directory path | `~/Library/Application Support/mortician` |
| `MORT_VITE_PORT` | Vite dev server port | `1420` |
| `MORT_SPOTLIGHT_HOTKEY` | Spotlight activation hotkey | `Command+Space` |
| `MORT_CLIPBOARD_HOTKEY` | Clipboard panel hotkey | `Command+Option+C` |

### Derived Values

When `MORT_APP_SUFFIX` is set (e.g., `dev`):
- App Identifier: `com.getmort.app` → `com.getmort.app.dev`
- App Name: `Mort` → `Mort Dev`
- Window titles and UI labels update accordingly

### Usage

```bash
pnpm dev              # Dev instance (port 1421, purple spotlight, hot reload)
pnpm build            # Build stable app for /Applications
```

**Typical workflow:**
1. Build stable Mort once → install to `/Applications/Mort.app`
2. Use installed Mort.app as your daily driver
3. Run `pnpm dev` for active development (hot reload, purple spotlight)

See `05-build-scripts.md` for details.

## Conflict Points

### Critical (Will Break)
1. **Global Hotkeys** - Same shortcuts will conflict at OS level
2. **Vite Port** - `strictPort: true` means dev server fails if port in use
3. **App Bundle ID** - macOS uses this to identify apps; same ID = same app

### High Priority
4. **Config Directory** - Shared config means settings conflicts
5. **Data Directory** - Shared data means repository/workspace conflicts
6. **Clipboard Database** - SQLite DB would be shared

### Medium Priority
7. **Visual Differentiation** - Need to know which app is which at a glance
8. **Log Files** - Separate logs for debugging each build

## Implementation Strategy

### Build-Time vs Runtime

**Important**: For installed apps launched from Finder/Dock, runtime env vars won't be available. We use a **hybrid approach**:

| Aspect | When Resolved | Mechanism |
|--------|---------------|-----------|
| App Identifier | Build-time | Tauri config overlay |
| App Name | Build-time | Tauri config overlay |
| Vite Port | Build-time | Vite config reads env |
| App Suffix | Build-time | Baked via `build.rs` → `env!()` macro |
| Default Hotkeys | Build-time | Baked via `build.rs` → `env!()` macro |
| Data Directory | Runtime | Rust reads baked suffix, derives path |
| Config Directory | Runtime | Rust reads baked suffix, derives path |
| Icons | Build-time | Asset selection in config overlay |

### Key Design Decision

**Bake instance identity at build time, derive paths at runtime.**

- `MORT_APP_SUFFIX` is read during `cargo build` and baked into the binary
- At runtime, the app uses the baked suffix to derive default paths:
  - Suffix `dev` → data dir `~/.mort-dev`, config dir `mortician-dev`
- This ensures installed apps work correctly without env vars
- Env vars can still override at runtime for development flexibility

### Flow

1. **Shell script** sets env vars including `MORT_APP_SUFFIX`
2. **Vite** uses `MORT_VITE_PORT` for dev server
3. **Cargo build.rs** bakes `MORT_APP_SUFFIX` and default hotkeys into binary
4. **Tauri build** uses config overlay (`--config tauri.conf.dev.json`)
5. **At runtime**, app uses baked suffix to derive default paths
6. **Runtime env vars** can still override for dev/testing flexibility

## Plan Structure

1. **01-build-configuration.md** - Tauri/Vite/Cargo config with env var support
2. **02-data-isolation.md** - Runtime directory resolution from env vars
3. **03-hotkey-separation.md** - Hotkey configuration from env vars
4. **04-visual-differentiation.md** - Icons, names, branding per suffix
5. **05-build-scripts.md** - Helper scripts for common configurations

## Scope

- **Files Modified**: ~8-10 files
- **New Files**: ~2-3 files (build helpers, dev icons)
- **Complexity**: Medium - env var plumbing, minimal logic changes
