# Plan: Order Worktrees by Creation Date Instead of Last Accessed

## Goal

Change the side panel to order worktrees by `createdAt` instead of `lastAccessedAt`. Add a new `createdAt` field to the `WorktreeState` type. **Run a migration on app startup** to set `createdAt = lastAccessedAt` for existing worktrees that don't have it.

---

## Background

### Current Behavior

Worktrees are currently sorted by `lastAccessedAt` (most recently accessed first):

1. **Rust backend** (`worktree_commands.rs:356-361`):
   ```rust
   existing_worktrees.sort_by(|a, b| {
       b.last_accessed_at.unwrap_or(0).cmp(&a.last_accessed_at.unwrap_or(0))
   });
   ```

2. **TypeScript service** (`worktree-service.ts:105-110`):
   ```typescript
   return [...settings.worktrees].sort(
     (a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0)
   );
   ```

### The Problem

Ordering by `lastAccessedAt` causes worktrees to jump around in the side panel as the user interacts with them. Users expect a stable, predictable order based on when worktrees were created.

---

## Implementation

### Step 1: Add `createdAt` Field to TypeScript Type

**File:** `core/types/repositories.ts`

Add `createdAt` as an optional field to `WorktreeStateSchema`:

```typescript
export const WorktreeStateSchema = z.object({
  /** UUID for worktree identification */
  id: z.string().uuid(),
  /** Absolute path to the worktree directory */
  path: z.string(),
  /** Name of the worktree */
  name: z.string(),
  /** Creation timestamp (ms since epoch). Defaults to lastAccessedAt for migration. */
  createdAt: z.number().optional(),
  /** Last access timestamp */
  lastAccessedAt: z.number().optional(),
  /** Currently checked out branch, or null */
  currentBranch: z.string().nullable().optional(),
  /** Whether this worktree has been renamed from its initial animal name */
  isRenamed: z.boolean().optional(),
});
```

### Step 2: Add `createdAt` Field to Rust Struct

**File:** `src-tauri/src/worktree_commands.rs`

Add `created_at` to the `WorktreeState` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeState {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(rename = "lastAccessedAt", skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<i64>,
    #[serde(rename = "currentBranch", skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(rename = "isRenamed", skip_serializing_if = "Option::is_none")]
    pub is_renamed: Option<bool>,
}
```

### Step 3: Set `createdAt` When Creating New Worktrees

**File:** `src-tauri/src/worktree_commands.rs` (in `worktree_create` function, around line 144)

When creating a new `WorktreeState`, set `created_at` to the current timestamp:

```rust
let new_state = WorktreeState {
    id: uuid::Uuid::new_v4().to_string(),
    path: actual_wt_path.clone(),
    name: worktree_name,
    created_at: Some(now_millis()),  // Add this line
    last_accessed_at: Some(now_millis()),
    current_branch: Some(branch_name.clone()),
    is_renamed: Some(false),
};
```

**File:** `core/services/worktree/worktree-service.ts` (in `create` method)

When creating a new worktree via TypeScript, also set `createdAt`:

```typescript
const newWorktree: WorktreeState = {
  id: crypto.randomUUID(),
  path: worktreePath,
  name,
  createdAt: Date.now(),      // Add this line
  lastAccessedAt: Date.now(),
  currentBranch: branch,
  isRenamed: false,
};
```

### Step 4: Update Sorting Logic - Rust Backend

**File:** `src-tauri/src/worktree_commands.rs` (lines 356-361)

Change sorting to use `created_at`, falling back to `last_accessed_at` for migration:

```rust
// Sort by createdAt descending (most recent first)
// Fall back to lastAccessedAt for worktrees that don't have createdAt yet
existing_worktrees.sort_by(|a, b| {
    let a_time = a.created_at.or(a.last_accessed_at).unwrap_or(0);
    let b_time = b.created_at.or(b.last_accessed_at).unwrap_or(0);
    b_time.cmp(&a_time)
});
```

### Step 5: Update Sorting Logic - TypeScript Service

**File:** `core/services/worktree/worktree-service.ts` (lines 105-110)

Change sorting to use `createdAt`, falling back to `lastAccessedAt`:

```typescript
/**
 * List all worktrees, sorted by creation date (most recent first).
 */
list(repoName: string): WorktreeState[] {
  const settings = this.settingsService.load(repoName);
  return [...settings.worktrees].sort((a, b) => {
    // Use createdAt, falling back to lastAccessedAt for migration
    const aTime = a.createdAt ?? a.lastAccessedAt ?? 0;
    const bTime = b.createdAt ?? b.lastAccessedAt ?? 0;
    return bTime - aTime;
  });
}
```

### Step 6: Handle Main Worktree Discovery (Rust)

**File:** `src-tauri/src/worktree_commands.rs` (in `sync_worktrees_with_settings` function)

When discovering the main worktree that wasn't in settings, set `created_at`:

```rust
// Around line 323-340, where new WorktreeState is created for discovered worktrees
WorktreeState {
    id: uuid::Uuid::new_v4().to_string(),
    path: git_wt.path.clone(),
    name: name.clone(),
    created_at: Some(now_millis()),  // Add this line
    last_accessed_at: Some(now_millis()),
    current_branch: current_branch.clone(),
    is_renamed: Some(false),
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `core/types/repositories.ts` | Add `createdAt` optional field to `WorktreeStateSchema` |
| `src-tauri/src/worktree_commands.rs` | Add `created_at` to struct, set it on creation, update sorting |
| `core/services/worktree/worktree-service.ts` | Set `createdAt` on creation, update sorting |
| `src-tauri/src/migrations/mod.rs` | **New** - Migration runner (version stored in AppConfig) |
| `src-tauri/src/migrations/001_worktree_created_at.rs` | **New** - Migration to add `createdAt` to existing worktrees |
| `src-tauri/src/config.rs` | Add `migration_version` field to `AppConfig` |
| `src-tauri/src/lib.rs` | Add `mod migrations` and call `migrations::run_migrations()` on startup |

---

## Migration System Architecture

### Overview

Create a versioned migration system that runs on app startup. Migrations are stored in a dedicated directory with numbered prefixes (e.g., `001_`, `002_`) for alphabetical ordering. The migration version is tracked in the existing `AppConfig`.

### Step 7: Add Migration Version to AppConfig

**File:** `src-tauri/src/config.rs`

Add `migration_version` field to `AppConfig`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "generate_device_id")]
    pub device_id: String,
    #[serde(default = "default_spotlight_hotkey")]
    pub spotlight_hotkey: String,
    #[serde(default = "default_clipboard_hotkey")]
    pub clipboard_hotkey: String,
    #[serde(default)]
    pub onboarded: bool,
    /// Current migration version (0 = no migrations run yet)
    #[serde(default)]
    pub migration_version: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            device_id: generate_device_id(),
            spotlight_hotkey: default_spotlight_hotkey(),
            clipboard_hotkey: default_clipboard_hotkey(),
            onboarded: false,
            migration_version: 0,
        }
    }
}
```

Add helper functions:

```rust
/// Gets the current migration version
pub fn get_migration_version() -> u32 {
    load_config().migration_version
}

/// Sets the migration version
pub fn set_migration_version(version: u32) -> Result<(), String> {
    let mut config = load_config();
    config.migration_version = version;
    save_config(&config)
}
```

### Step 8: Create Migration Infrastructure

**New File:** `src-tauri/src/migrations/mod.rs`

```rust
//! Data migrations for evolving settings schemas.
//!
//! Migrations run once on app startup. Version is tracked in AppConfig.
//! Migration files use numbered prefixes (001_, 002_) for alphabetical ordering.

mod _001_worktree_created_at;

use crate::config;

/// Current migration version. Increment when adding new migrations.
pub const CURRENT_VERSION: u32 = 1;

/// Run all pending migrations.
/// Called once during app initialization, after config::initialize().
pub fn run_migrations() {
    let current = config::get_migration_version();

    if current >= CURRENT_VERSION {
        tracing::debug!(
            current_version = current,
            target_version = CURRENT_VERSION,
            "Migrations already up to date"
        );
        return;
    }

    tracing::info!(
        from_version = current,
        to_version = CURRENT_VERSION,
        "Running migrations"
    );

    // Run migrations in order
    if current < 1 {
        if let Err(e) = _001_worktree_created_at::run() {
            tracing::error!(error = %e, "Migration 001 failed");
            return; // Don't update version on failure
        }
    }

    // Add future migrations here:
    // if current < 2 {
    //     if let Err(e) = _002_something::run() { ... }
    // }

    // Save the new version
    if let Err(e) = config::set_migration_version(CURRENT_VERSION) {
        tracing::error!(error = %e, "Failed to save migration version");
    } else {
        tracing::info!(version = CURRENT_VERSION, "Migrations complete");
    }
}
```

### Step 9: Create Migration 001 - Worktree createdAt

**New File:** `src-tauri/src/migrations/_001_worktree_created_at.rs`

```rust
//! Migration v1: Add createdAt field to worktrees
//!
//! For existing worktrees that don't have createdAt, set it to lastAccessedAt.

use crate::paths;
use serde_json::{Map, Value};
use std::fs;

pub fn run() -> Result<(), String> {
    tracing::info!("Running migration v1: worktree createdAt");

    let repos_dir = paths::repositories_dir();
    if !repos_dir.exists() {
        tracing::debug!("No repositories directory, skipping migration");
        return Ok(());
    }

    // Iterate over all repository directories
    let entries = fs::read_dir(&repos_dir)
        .map_err(|e| format!("Failed to read repositories dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let settings_path = path.join("settings.json");
        if !settings_path.exists() {
            continue;
        }

        let repo_name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        if let Err(e) = migrate_repo_settings(&settings_path) {
            tracing::warn!(
                repo = repo_name,
                error = %e,
                "Failed to migrate repository settings"
            );
            // Continue with other repos
        }
    }

    Ok(())
}

fn migrate_repo_settings(settings_path: &std::path::Path) -> Result<(), String> {
    let content = fs::read_to_string(settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;

    let mut settings: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {}", e))?;

    let mut modified = false;

    // Get worktrees array
    if let Some(worktrees) = settings.get_mut("worktrees").and_then(|w| w.as_array_mut()) {
        for worktree in worktrees.iter_mut() {
            if let Some(wt) = worktree.as_object_mut() {
                // If createdAt is missing, set it to lastAccessedAt
                if !wt.contains_key("createdAt") {
                    let created_at = wt.get("lastAccessedAt")
                        .and_then(|v| v.as_i64())
                        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

                    wt.insert("createdAt".to_string(), Value::Number(created_at.into()));
                    modified = true;

                    let name = wt.get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("unnamed");
                    tracing::debug!(worktree = name, created_at, "Added createdAt to worktree");
                }
            }
        }
    }

    if modified {
        let new_content = serde_json::to_string_pretty(&settings)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        fs::write(settings_path, new_content)
            .map_err(|e| format!("Failed to write: {}", e))?;
        tracing::info!(path = %settings_path.display(), "Migrated worktree settings");
    }

    Ok(())
}
```

### Step 10: Register Migrations Module

**File:** `src-tauri/src/lib.rs`

Add module declaration:
```rust
mod migrations;
```

### Step 11: Call Migrations on App Startup

**File:** `src-tauri/src/lib.rs` (in `run()` setup block, after `config::initialize()`)

```rust
// Run data migrations
migrations::run_migrations();
```

This should be placed early in the setup block, after paths and config are initialized but before any worktree operations.

---

## Migration Strategy

The migration system ensures:

1. **Existing worktrees**: Automatically get `createdAt` set to `lastAccessedAt` on first app launch after update
2. **New worktrees**: Will have proper `createdAt` set at creation time
3. **Version tracking**: Migrations only run once, tracked in `AppConfig.migration_version`
4. **Graceful failures**: Individual repo migration failures don't block other repos

### File Naming Convention

Migration files use numbered prefixes for alphabetical ordering:
- `_001_worktree_created_at.rs`
- `_002_future_migration.rs`
- etc.

The underscore prefix is used because Rust module names cannot start with a digit.

---

## Testing Checklist

### Migration Tests

1. [ ] Fresh install (no existing data)
   - Verify `app-config.json` has `migration_version: 1`
   - Verify no errors in logs

2. [ ] Existing install with worktrees (migration runs)
   - Verify all worktrees get `createdAt` field added
   - Verify `createdAt` equals previous `lastAccessedAt` value
   - Verify `app-config.json` has `migration_version: 1`
   - Verify migration only runs once (restart app, check logs)

3. [ ] Existing install, already migrated
   - Verify migration is skipped (check logs)
   - Verify worktree data unchanged

### Feature Tests

4. [ ] Create a new worktree
   - Verify `createdAt` is set in settings.json
   - Verify worktree appears at top of list (most recent)

5. [ ] Access an older worktree (touch it)
   - Verify `lastAccessedAt` updates but order doesn't change
   - Verify worktree stays in its position based on `createdAt`

6. [ ] Verify both Rust and TypeScript return same order
   - Compare worktree list from Tauri command vs TypeScript service

---

## Edge Cases

1. **Worktrees created before this change**: Will use `lastAccessedAt` as proxy for creation time. This is acceptable since we can't know the true creation time.

2. **Multiple worktrees created at same millisecond**: Extremely unlikely, but order among them would be undefined. Could add secondary sort by name if this becomes an issue.

3. **Clock skew**: If system clock is adjusted backwards, new worktrees might appear after older ones. This is a general timestamp problem, not specific to this change.

4. **Migration during corrupt settings**: If a repo's settings.json is malformed, that repo is skipped and logged. Other repos continue to migrate.

5. **Concurrent access during migration**: Migration runs synchronously at startup before any UI loads, so there's no race condition with user actions.
