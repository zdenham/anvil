# Spotlight Enable/Disable Toggle

Make the global spotlight feature opt-in (default disabled), add an enable toggle, remove the "disable system Spotlight" section, and add explanatory copy.

## Context

Currently:
- The spotlight hotkey is **always registered** on startup (if onboarded)
- The `SpotlightSettings` component helps users disable macOS system Spotlight to free up ⌘+Space
- There's no way to disable Anvil's global spotlight entirely
- The `HotkeySettings` component lets users change the hotkey but not disable it

Goal:
- Spotlight should be **default disabled** for new users
- Users can enable/disable it via a toggle in settings
- Remove (comment out) the "disable system Spotlight" section
- Add copy explaining what the spotlight does

## Phases

- [x] Add `spotlight_enabled` to config (Rust + frontend)
- [x] Gate hotkey registration on `spotlight_enabled`
- [x] Replace SpotlightSettings with enable/disable toggle + explanatory copy
- [x] Comment out system Spotlight disable section

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `spotlight_enabled` to config

**Rust (`src-tauri/src/config.rs`):**
- Add `spotlight_enabled: bool` field to `AppConfig` with `#[serde(default)]` (defaults to `false`)
- Update `Default` impl to set `spotlight_enabled: false`
- Add `get_spotlight_enabled() -> bool` and `set_spotlight_enabled(enabled: bool) -> Result<(), String>` helpers

**Rust (`src-tauri/src/lib.rs`):**
- Add Tauri commands: `get_spotlight_enabled` and `set_spotlight_enabled`
- Register both in the `invoke_handler`

**Frontend (`src/lib/invoke.ts`):**
- Add `"get_spotlight_enabled"` and `"set_spotlight_enabled"` to `NATIVE_COMMANDS`

**Frontend (`src/lib/hotkey-service.ts`):**
- Add `getSpotlightEnabled(): Promise<boolean>` and `setSpotlightEnabled(enabled: boolean): Promise<void>` wrappers

## Phase 2: Gate hotkey registration on `spotlight_enabled`

**Rust (`src-tauri/src/lib.rs`):**
- In the startup code (~line 1206), check `config::get_spotlight_enabled()` before calling `register_hotkey_internal`
- If disabled, only register the clipboard hotkey (skip spotlight hotkey registration)
- In `save_hotkey` command, also check if spotlight is enabled before registering
- Add a new command `set_spotlight_enabled_cmd` that:
  1. Saves the setting via `config::set_spotlight_enabled()`
  2. If enabling: calls `register_hotkey_internal()` with the saved hotkey
  3. If disabling: unregisters the spotlight shortcut (re-register only clipboard)

## Phase 3: Replace SpotlightSettings with enable toggle + copy

**Modify `src/components/main-window/settings/spotlight-settings.tsx`:**
- Remove all the system-Spotlight-disable logic
- Replace with a simple toggle (checkbox or switch) for enabling/disabling the global spotlight
- Load state from `getSpotlightEnabled()` on mount
- On toggle: call `setSpotlightEnabled()` which handles registration/unregistration on the Rust side
- Add explanatory copy, something like:

> **Global Spotlight**
> When enabled, pressing the global hotkey opens Anvil's spotlight from anywhere on your desktop — even when Anvil isn't focused. Use it to quickly start a new thread, search your projects, or run quick actions.

- When enabled, show the current hotkey and a "Change" link (or just reference the Global Hotkey section above)
- Note: If the user's hotkey is ⌘+Space, mention they may need to disable macOS Spotlight first (a brief inline note, not the full auto-disable UI)

## Phase 4: Comment out system Spotlight disable section

**`src/components/main-window/settings-page.tsx`:**
- Comment out the `<SpotlightSettings />` usage (the old system-disable component)
- Actually — since we're rewriting `SpotlightSettings` in Phase 3, this is already handled. The old component content gets replaced, not commented out.
- If any dead code remains (accessibility commands, `system_spotlight.rs` usage from settings), leave it — it may be used elsewhere and can be cleaned up separately.

**Alternative approach:** Rather than rewriting `spotlight-settings.tsx` in place, we could:
1. Rename the old file to `spotlight-settings.tsx.bak` or comment out its body
2. Write the new toggle UI in the same file

Either way works — the old auto-disable UI should be commented out (not deleted) per request.
