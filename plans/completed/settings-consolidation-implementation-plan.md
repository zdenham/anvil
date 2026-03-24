# Settings Consolidation Implementation Plan

## Overview

This plan outlines the implementation steps to consolidate all settings storage into the `.anvil/settings` directory, addressing the current split between `~/Library/Application Support/anvil/` and `~/.anvil/`.

## Goals

1. **Consolidate** all settings to `~/.anvil/settings/` directory
2. **Migrate** clipboard database to `~/.anvil/databases/` directory
3. **Preserve** all existing user data during migration
4. **Maintain** backward compatibility during transition
5. **Fix** bootstrap timing to ensure `.anvil` directory exists early

## Implementation Phases

### Phase 1: Bootstrap Timing Fix (Critical Foundation)

**Problem**: Currently `.anvil` directory is bootstrapped asynchronously after app startup, but main config needs to be loaded synchronously during Tauri initialization.

#### 1.1 Update Tauri Main Process Bootstrap

**File**: `src-tauri/src/main.rs`

**Changes Required**:
- Move `.anvil` directory creation to **before** config initialization
- Ensure synchronous bootstrap of essential directories
- Call new `ensure_anvil_directories()` function

**New function to add**:
```rust
/// Ensures essential .anvil directories exist synchronously
fn ensure_anvil_directories() -> Result<(), String> {
    let data_dir = paths::data_dir();
    let settings_dir = data_dir.join("settings");
    let databases_dir = data_dir.join("databases");

    std::fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("Failed to create settings dir: {}", e))?;
    std::fs::create_dir_all(&databases_dir)
        .map_err(|e| format!("Failed to create databases dir: {}", e))?;

    Ok(())
}
```

#### 1.2 Update Paths Module

**File**: `src-tauri/src/paths.rs`

**New functions to add**:
```rust
/// Path to settings directory in .anvil
pub fn settings_dir() -> PathBuf {
    data_dir().join("settings")
}

/// Path to databases directory in .anvil
pub fn databases_dir() -> PathBuf {
    data_dir().join("databases")
}

/// Path to app config file in .anvil/settings
pub fn app_config_file() -> PathBuf {
    settings_dir().join("app-config.json")
}

/// Path to clipboard database in .anvil/databases
pub fn clipboard_database() -> PathBuf {
    databases_dir().join("clipboard.db")
}
```

### Phase 2: Configuration Migration System

#### 2.1 Create Migration Utilities

**New File**: `src-tauri/src/migration.rs`

**Purpose**: Handle one-time migration of existing config files.

**Key Functions**:
```rust
/// Checks if migration is needed
pub fn needs_migration() -> bool

/// Migrates config.json from old to new location
pub fn migrate_app_config() -> Result<(), String>

/// Migrates clipboard.db from old to new location
pub fn migrate_clipboard_database() -> Result<(), String>

/// Performs full migration with rollback support
pub fn perform_migration() -> Result<MigrationResult, String>

/// Removes old files after successful migration
pub fn cleanup_old_files() -> Result<(), String>
```

**Migration Strategy**:
1. **Detection**: Check if files exist in old locations but not new locations
2. **Backup**: Create backup of existing files before migration
3. **Copy**: Copy files to new locations
4. **Verify**: Verify new files are readable and valid
5. **Cleanup**: Remove old files (optional, with user consent)

#### 2.2 Update Config Module

**File**: `src-tauri/src/config.rs`

**Changes Required**:
1. Update `get_config_path()` to use new location
2. Add migration check in `load_config()`
3. Ensure backward compatibility during transition

**Implementation**:
```rust
/// Gets the path to the config file (new location)
fn get_config_path() -> std::path::PathBuf {
    paths::app_config_file()
}

/// Gets the legacy config path
fn get_legacy_config_path() -> std::path::PathBuf {
    paths::config_file() // old location
}

/// Loads config with automatic migration
pub fn load_config() -> AppConfig {
    let config_path = get_config_path();
    let legacy_path = get_legacy_config_path();

    // Try new location first
    if config_path.exists() {
        return load_from_path(&config_path);
    }

    // Check legacy location and migrate if needed
    if legacy_path.exists() {
        tracing::info!("Migrating config from legacy location");
        if let Ok(_) = crate::migration::migrate_app_config() {
            return load_from_path(&config_path);
        } else {
            tracing::warn!("Migration failed, using legacy location");
            return load_from_path(&legacy_path);
        }
    }

    // No config exists, return default
    AppConfig::default()
}
```

### Phase 3: Clipboard Database Migration

#### 3.1 Update Clipboard Database Module

**File**: `src-tauri/src/clipboard_db.rs`

**Changes Required**:
1. Update database path resolution
2. Add migration logic for existing database
3. Ensure database schema preservation

**Key Changes**:
```rust
/// Gets the database file path (new location)
fn get_db_path() -> PathBuf {
    paths::clipboard_database()
}

/// Gets the legacy database path
fn get_legacy_db_path() -> PathBuf {
    paths::clipboard_db() // old location
}

/// Initialize with automatic migration
pub fn initialize() -> Result<(), rusqlite::Error> {
    let db_path = get_db_path();
    let legacy_path = get_legacy_db_path();

    // Ensure databases directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // Check for migration need
    if !db_path.exists() && legacy_path.exists() {
        if let Err(e) = crate::migration::migrate_clipboard_database() {
            tracing::error!("Failed to migrate clipboard database: {}", e);
            // Continue with legacy path for now
            return initialize_at_path(&legacy_path);
        }
    }

    initialize_at_path(&db_path)
}
```

#### 3.2 Database Migration Implementation

**In**: `src-tauri/src/migration.rs`

**Database Migration Function**:
```rust
pub fn migrate_clipboard_database() -> Result<(), String> {
    let old_path = paths::clipboard_db();
    let new_path = paths::clipboard_database();

    if !old_path.exists() {
        return Ok(()); // Nothing to migrate
    }

    if new_path.exists() {
        return Err("New database already exists".to_string());
    }

    // Ensure parent directory exists
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create databases dir: {}", e))?;
    }

    // Copy database file
    std::fs::copy(&old_path, &new_path)
        .map_err(|e| format!("Failed to copy database: {}", e))?;

    // Verify new database is valid
    let conn = rusqlite::Connection::open(&new_path)
        .map_err(|e| format!("Failed to verify migrated database: {}", e))?;

    // Test that we can query the database
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM clipboard_entries",
        [],
        |row| row.get(0)
    ).unwrap_or(0);

    tracing::info!("Migrated clipboard database with {} entries", count);
    Ok(())
}
```

### Phase 4: Integration Testing and Validation

#### 4.1 Migration Integration

**File**: `src-tauri/src/main.rs`

**Updated initialization sequence**:
```rust
fn main() {
    // 1. Initialize paths
    paths::initialize();

    // 2. Ensure .anvil directories exist (NEW)
    if let Err(e) = ensure_anvil_directories() {
        tracing::error!("Failed to ensure .anvil directories: {}", e);
    }

    // 3. Perform one-time migration if needed (NEW)
    if migration::needs_migration() {
        match migration::perform_migration() {
            Ok(result) => tracing::info!("Migration completed: {:?}", result),
            Err(e) => tracing::error!("Migration failed: {}", e),
        }
    }

    // 4. Initialize config (now uses migrated location)
    config::initialize();

    // 5. Initialize clipboard database (now uses migrated location)
    if let Err(e) = clipboard_db::initialize() {
        tracing::error!("Failed to initialize clipboard database: {}", e);
    }

    // 6. Continue with rest of app initialization...
}
```

#### 4.2 Testing Strategy

**Unit Tests**:
- Migration functions work correctly
- Config loading works from new locations
- Database migration preserves data
- Backward compatibility works

**Integration Tests**:
- Fresh install creates correct directory structure
- Existing install migrates correctly
- App functions normally after migration
- Environment variable overrides still work

**Manual Testing**:
- Test with existing config data
- Test with existing clipboard data
- Test fresh installation
- Test development vs production builds

### Phase 5: Cleanup and Documentation

#### 5.1 Remove Legacy Path Functions

**After migration is stable and tested**:
- Remove `paths::config_file()` (replaced by `app_config_file()`)
- Remove `paths::clipboard_db()` (replaced by `clipboard_database()`)
- Update any remaining references

#### 5.2 Update Build Configuration

**File**: `src-tauri/build.rs`

**Ensure environment variables are properly handled**:
- Verify `ANVIL_DATA_DIR` override works
- Verify `ANVIL_CONFIG_DIR` override works (though less relevant now)
- Update any build-time path references

#### 5.3 Documentation Updates

**Files to Update**:
- README.md - Update directory structure documentation
- Any installation/setup guides
- Developer documentation about settings storage

## Implementation Checklist

### Phase 1: Foundation ✓
- [ ] Add `ensure_anvil_directories()` to `src-tauri/src/main.rs`
- [ ] Add new path functions to `src-tauri/src/paths.rs`
- [ ] Update Tauri initialization sequence

### Phase 2: Config Migration ✓
- [ ] Create `src-tauri/src/migration.rs`
- [ ] Implement config migration logic
- [ ] Update `config.rs` to use new location with migration fallback
- [ ] Add migration calls to app initialization

### Phase 3: Database Migration ✓
- [ ] Update `clipboard_db.rs` path resolution
- [ ] Implement database migration in `migration.rs`
- [ ] Test database migration preserves data and schema
- [ ] Add error handling and rollback

### Phase 4: Testing & Integration ✓
- [ ] Write unit tests for migration functions
- [ ] Write integration tests for full migration
- [ ] Manual testing with existing data
- [ ] Test environment variable overrides

### Phase 5: Cleanup ✓
- [ ] Remove legacy path functions
- [ ] Update documentation
- [ ] Remove migration code after stable period (optional)

## Risk Mitigation

### Data Loss Prevention
1. **Always backup** before migration
2. **Verify** migrated data is readable
3. **Keep fallback** to old location if migration fails
4. **Atomic operations** where possible

### Rollback Strategy
1. **Detection**: If new config/database fails to load
2. **Fallback**: Temporarily use old location
3. **Logging**: Clear error messages about what went wrong
4. **User notification**: Inform user of migration status

### Compatibility Maintenance
1. **Gradual migration**: Don't remove old location support immediately
2. **Environment variables**: Ensure overrides continue to work
3. **Development builds**: Test with different APP_SUFFIX values

## Success Criteria

- ✅ All settings consolidated to `~/.anvil/settings/`
- ✅ Clipboard database moved to `~/.anvil/databases/`
- ✅ Existing user data preserved during migration
- ✅ Bootstrap timing fixed for consistent initialization
- ✅ No breaking changes for existing users
- ✅ Environment variable overrides continue working
- ✅ Development/production suffix system maintained

## Timeline Estimation

- **Phase 1** (Foundation): 4-6 hours
- **Phase 2** (Config Migration): 6-8 hours
- **Phase 3** (Database Migration): 8-10 hours
- **Phase 4** (Testing): 8-12 hours
- **Phase 5** (Cleanup): 2-4 hours

**Total Estimated Effort**: 28-40 hours

---

*Implementation plan created on 2026-01-13*
*For anvil settings consolidation project*