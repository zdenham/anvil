# 06: Implementation Checklist

Quick reference for implementing multi-instance build support.

## Key Design Decisions

1. **Build-time baking**: `ANVIL_APP_SUFFIX` and hotkeys are baked into the binary via `build.rs`
2. **Suffix-derived paths**: Data/config directories are derived from the baked suffix at runtime
3. **Shell script presets**: Use shell scripts instead of cross-env for proper path handling
4. **Env var overrides**: Runtime env vars can still override for development flexibility

## Environment Variables Reference

| Variable | Purpose | When Used | Default |
|----------|---------|-----------|---------|
| `ANVIL_APP_SUFFIX` | App identifier/name suffix | Build-time (baked) | _(none)_ |
| `ANVIL_VITE_PORT` | Vite dev server port | Build-time | `1420` |
| `ANVIL_SPOTLIGHT_HOTKEY` | Spotlight hotkey | Build-time (baked) | `Command+Space` |
| `ANVIL_CLIPBOARD_HOTKEY` | Clipboard hotkey | Build-time (baked) | `Command+Option+C` |
| `ANVIL_DATA_DIR` | Data directory override | Runtime (optional) | Derived from suffix |
| `ANVIL_CONFIG_DIR` | Config directory override | Runtime (optional) | Derived from suffix |

## Phase 1: Build Scripts & Configuration

- [ ] Create shell script presets
  - `scripts/env-presets/dev.sh` - exports `ANVIL_APP_SUFFIX=dev`, `ANVIL_VITE_PORT=1421`, hotkeys

- [ ] Create build wrapper scripts
  - `scripts/dev-anvil.sh` - sources preset, runs `pnpm dev:run`
  - `scripts/build-anvil.sh` - builds stable app (no preset)
  - Make executable: `chmod +x scripts/*.sh`

- [ ] Create `src-tauri/tauri.conf.dev.json` overlay
  - Set `identifier` to `com.getanvil.app.dev`
  - Set `productName` to `Anvil Dev`
  - Set `devUrl` to `http://localhost:1421`
  - Reference `icons-dev/` paths

- [ ] Update `vite.config.ts`
  - Read `ANVIL_VITE_PORT` env var (default 1420)
  - Read `ANVIL_APP_SUFFIX` env var
  - Define `__ANVIL_APP_SUFFIX__` global

- [ ] Update `package.json` scripts
  - `"dev": "./scripts/dev-anvil.sh dev"`
  - `"build": "./scripts/build-anvil.sh"`

## Phase 2: Build-Time Baking

- [ ] Update `src-tauri/build.rs`
  - Bake `ANVIL_APP_SUFFIX` via `cargo:rustc-env`
  - Bake `ANVIL_SPOTLIGHT_HOTKEY` via `cargo:rustc-env`
  - Bake `ANVIL_CLIPBOARD_HOTKEY` via `cargo:rustc-env`

- [ ] Create `src-tauri/src/build_info.rs`
  - `APP_SUFFIX: &str = env!("ANVIL_APP_SUFFIX")`
  - `DEFAULT_SPOTLIGHT_HOTKEY: &str = env!("ANVIL_SPOTLIGHT_HOTKEY")`
  - `DEFAULT_CLIPBOARD_HOTKEY: &str = env!("ANVIL_CLIPBOARD_HOTKEY")`
  - `is_alternate_build() -> bool`
  - `display_suffix() -> &'static str` (returns " Dev", " Canary", etc.)

- [ ] Update `src-tauri/src/lib.rs`
  - Add `mod build_info;`

## Phase 3: Data Isolation

- [ ] Add `shellexpand` dependency to `src-tauri/Cargo.toml`
  - `shellexpand = "3.1"`

- [ ] Create `src-tauri/src/paths.rs`
  - `initialize()` - derives paths from baked suffix, allows env override
  - `default_data_dir()` → `~/.anvil` or `~/.anvil-{suffix}`
  - `default_config_dir()` → `anvil` or `anvil-{suffix}`
  - `data_dir()`, `config_dir()`, `repositories_dir()`, `threads_dir()`, etc.
  - `get_paths_info()` → expose to frontend

- [ ] Update `src-tauri/src/lib.rs`
  - Add `mod paths;`
  - Call `paths::initialize()` at app startup

- [ ] Update `src-tauri/src/config.rs`
  - Use `paths::config_dir()` and `paths::config_file()`

- [ ] Update `src-tauri/src/anvil_commands.rs`
  - Use `paths::data_dir()`, `paths::repositories_dir()`, etc.
  - Add `get_paths_info` Tauri command

- [ ] Update `src-tauri/src/clipboard_db.rs`
  - Use `paths::clipboard_db()`

- [ ] Update `src-tauri/src/logging.rs`
  - Use `paths::logs_dir()`

## Phase 4: Hotkey Integration

- [ ] Update `src-tauri/src/lib.rs`
  - Use `build_info::DEFAULT_CLIPBOARD_HOTKEY` for registration

- [ ] Update `src-tauri/src/config.rs`
  - Use `build_info::DEFAULT_SPOTLIGHT_HOTKEY` for default

- [ ] Add `get_default_hotkeys` Tauri command
  - Returns baked hotkey defaults and suffix

- [ ] Update onboarding UI (optional)
  - Query default hotkeys, show appropriate suggestions

## Phase 5: Visual Differentiation

- [ ] Create `src-tauri/icons-dev/` directory
  - Generate all icon sizes with visual distinction (purple tint)
  - 32x32.png, 128x128.png, 128x128@2x.png
  - icon.icns, icon.ico, icon.png

- [ ] Update `src-tauri/src/panels.rs`
  - `panel_title()` function uses `build_info::display_suffix()`

- [ ] Add spotlight background color differentiation
  - Update spotlight component to read `app_suffix` from `get_paths_info`
  - Add CSS for `.spotlight-dev` with purple tint
  - Set `data-app-suffix` attribute on root element

- [ ] Create `src/components/ui/BuildModeIndicator.tsx`
  - Shows suffix badge when `is_alternate_build` is true

- [ ] Add indicator to main layouts
  - Import and render BuildModeIndicator

- [ ] Create `src/lib/constants.ts`
  - Export `APP_SUFFIX` and `IS_ALTERNATE_BUILD` from Vite defines

## Verification

- [ ] Run `pnpm build` - builds stable app
- [ ] Install to /Applications: `cp -r src-tauri/target/release/bundle/macos/Anvil.app /Applications/`
- [ ] Launch Anvil.app from Finder (stable, Cmd+Space hotkey)
- [ ] Run `pnpm dev` - uses port 1421, purple spotlight, Cmd+Shift+Space hotkey
- [ ] Both run simultaneously without conflicts
- [ ] Verify different data directories:
  ```bash
  ls ~/.anvil/          # stable
  ls ~/.anvil-dev/      # dev
  ```
- [ ] Verify visual distinction (purple spotlight, window titles)
- [ ] Create data in each, verify isolation

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `scripts/env-presets/dev.sh` | Dev build env var preset |
| `scripts/dev-anvil.sh` | Dev wrapper script |
| `scripts/build-anvil.sh` | Build wrapper script |
| `src-tauri/tauri.conf.dev.json` | Dev build Tauri config overlay |
| `src-tauri/src/build_info.rs` | Build-time baked constants |
| `src-tauri/src/paths.rs` | Centralized path resolution with suffix derivation |
| `src-tauri/icons-dev/*` | Dev build icons (purple tinted) |
| `src/lib/constants.ts` | Frontend build constants |
| `src/components/ui/BuildModeIndicator.tsx` | Instance UI indicator |

### Modified Files
| File | Changes |
|------|---------|
| `package.json` | Add script aliases to shell scripts |
| `vite.config.ts` | Read `ANVIL_VITE_PORT`, `ANVIL_APP_SUFFIX` env vars |
| `src-tauri/Cargo.toml` | Add `shellexpand` dependency |
| `src-tauri/build.rs` | Bake suffix and hotkeys into binary |
| `src-tauri/src/lib.rs` | Add `mod build_info;`, `mod paths;`, init paths |
| `src-tauri/src/config.rs` | Use `paths` and `build_info` modules |
| `src-tauri/src/anvil_commands.rs` | Use `paths` module, add `get_paths_info` command |
| `src-tauri/src/clipboard_db.rs` | Use `paths` module |
| `src-tauri/src/logging.rs` | Use `paths` module |
| `src-tauri/src/panels.rs` | Use `build_info::display_suffix()` for titles |
| `src/components/spotlight/*` | Spotlight background color from suffix |

## Quick Start Commands

```bash
# Build and install stable app
pnpm build
cp -r src-tauri/target/release/bundle/macos/Anvil.app /Applications/

# Run dev instance (purple spotlight, port 1421)
pnpm dev
```
