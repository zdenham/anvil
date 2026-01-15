# Settings Storage Consolidation Plan

## Decision

**Approach**: Clean break - switch to unified `.mort` directory without data migration. Old data in `~/Library/Application Support/mortician/` will be abandoned.

## Current State

```
~/Library/Application Support/mortician/
├── config.json                 # Main app config (hotkeys, onboarding)
└── clipboard.db                # SQLite clipboard history

~/.mort/
├── settings/
│   ├── workspace.json          # Workspace settings
│   └── [other-settings].json   # Generic key-value settings
├── tasks/
├── repositories/
└── prompt-history.json
```

## Target State

```
~/.mort/
├── settings/
│   ├── app-config.json         # Main app config (hotkeys, onboarding)
│   ├── workspace.json          # Workspace settings
│   └── [other-settings].json   # Generic key-value settings
├── databases/
│   └── clipboard.db            # SQLite clipboard history
├── tasks/
├── repositories/
└── prompt-history.json
```

## Files to Change

### 1. `src-tauri/src/paths.rs`

Update path functions:
- `config_file()` → return `{data_dir}/settings/app-config.json`
- `clipboard_db()` → return `{data_dir}/databases/clipboard.db`
- Remove or deprecate `config_dir()` if no longer needed

### 2. `src-tauri/src/config.rs`

- Update `initialize()` to ensure `{data_dir}/settings/` exists
- Path resolution already uses `paths::config_file()`

### 3. `src-tauri/src/clipboard_db.rs`

- Update `initialize()` to ensure `{data_dir}/databases/` exists
- Path resolution already uses `paths::clipboard_db()`

### 4. `src-tauri/src/lib.rs` (if needed)

- Ensure `.mort` directory bootstrap happens before config loading

## Implementation Steps

1. Update `paths.rs` to point `config_file()` and `clipboard_db()` to new locations
2. Update `config.rs` to create `settings/` subdirectory on init
3. Update `clipboard_db.rs` to create `databases/` subdirectory on init
4. Test that app starts fresh with default config and empty clipboard
5. Remove any now-unused `config_dir()` references

## Notes

- Users will lose existing hotkey customizations (will reset to defaults)
- Users will lose clipboard history (starts fresh)
- Icon cache can stay in system cache directory - that's appropriate
- Environment variable overrides (`MORT_DATA_DIR`) continue to work

---

_Updated 2026-01-13_
