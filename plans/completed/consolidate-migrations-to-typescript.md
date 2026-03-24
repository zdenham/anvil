# Consolidate Migrations to TypeScript

## Overview

Move all migrations from Rust to TypeScript, compiled to a standalone Node.js script that Rust invokes via shell spawn during app startup.

## Current State

- **Rust migrations** (`src-tauri/src/migrations/`): Version-tracked system with one migration (`_001_worktree_created_at.rs`). Invoked in `lib.rs` during app init.
- **TypeScript migrations** (`src/bootstrap/migrations/`): Idempotent system with one migration (`quick-actions-project-v1.ts`). Currently invoked from `anvil-bootstrap.ts` in the frontend.

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Rust App Startup (lib.rs)                                   │
│   └── paths::initialize()                                   │
│   └── config::initialize()                                  │
│   └── spawn: node migrations/dist/runner.js                 │
│         ├── Receives: ANVIL_DATA_DIR env var                 │
│         └── Runs all TS migrations in order                 │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### 1. Create standalone migration runner script

Create `migrations/` directory at project root (not inside `src/` or `src-tauri/`):

```
migrations/
├── package.json          # Minimal deps (just typescript types)
├── tsconfig.json         # Compile to ESM or CJS for Node
├── src/
│   ├── runner.ts         # Entry point - reads version, runs migrations
│   ├── types.ts          # Migration interface
│   ├── utils.ts          # File helpers (no Tauri deps)
│   └── migrations/
│       ├── index.ts      # Migration registry
│       └── 001-quick-actions-project.ts
└── dist/                 # Compiled output
```

### 2. Implement runner.ts

The runner should:
- Read `ANVIL_DATA_DIR` from environment (passed by Rust)
- Read current migration version from `$ANVIL_DATA_DIR/settings/app-config.json`
- Run pending migrations in order
- Update migration version on success
- Exit with code 0 on success, non-zero on failure
- Log to stdout/stderr (Rust captures this)

```typescript
// runner.ts pseudocode
const dataDir = process.env.ANVIL_DATA_DIR;
const configPath = path.join(dataDir, 'settings', 'app-config.json');
const config = JSON.parse(fs.readFileSync(configPath));
const currentVersion = config.migration_version ?? 0;

for (const migration of migrations) {
  if (migration.version > currentVersion) {
    await migration.up(dataDir);
    config.migration_version = migration.version;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}
```

### 3. Create quick-actions migration

Move `quick-actions-project-v1.ts` to `001-quick-actions-project.ts`:

- Remove Tauri API dependencies (`@tauri-apps/api/path`)
- Use `ANVIL_DATA_DIR` env var for paths
- Template path: Use `__dirname` relative path or another env var (`ANVIL_TEMPLATE_DIR`)

Rust will need to pass both:
- `ANVIL_DATA_DIR` - the ~/.anvil or ~/.anvil-dev directory
- `ANVIL_TEMPLATE_DIR` - path to bundled template (resolved via Tauri resource API before spawn)

### 4. Update Rust to spawn migration runner

In `src-tauri/src/lib.rs`, replace `migrations::run_migrations()` with:

```rust
use std::process::Command;

fn run_migrations(app: &tauri::App) -> Result<(), String> {
    let data_dir = paths::data_dir();

    // Resolve template path from bundled resources
    let template_dir = app.path()
        .resolve("_up_/core/sdk/template", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    // Resolve migration runner
    let runner_path = app.path()
        .resolve("migrations/dist/runner.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    let output = Command::new("node")
        .arg(&runner_path)
        .env("ANVIL_DATA_DIR", data_dir)
        .env("ANVIL_TEMPLATE_DIR", template_dir)
        .env("PATH", paths::shell_path())
        .output()
        .map_err(|e| format!("Failed to spawn migration runner: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(stderr = %stderr, "Migration runner failed");
        return Err(format!("Migration failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    tracing::info!(stdout = %stdout, "Migrations complete");
    Ok(())
}
```

### 5. Delete Rust migration code

Remove:
- `src-tauri/src/migrations/` directory entirely
- `migrations::run_migrations()` call from `lib.rs`
- `mod migrations;` from `lib.rs`

Keep in `config.rs`:
- `migration_version` field in `AppConfig` (still read/written, but now by TS)
- `get_migration_version()` and `set_migration_version()` can be removed (unused by Rust now)

### 6. Delete frontend migration code

Remove:
- `src/bootstrap/` directory entirely
- `runMigrations()` call from `src/lib/anvil-bootstrap.ts`
- The import I just added

### 7. Update build process

Add to `tauri.conf.json` resources:
```json
{
  "bundle": {
    "resources": [
      "_up_/migrations/dist/**/*",
      "_up_/core/sdk/template/**/*"
    ]
  }
}
```

Add build step to compile migrations before Tauri build:
```bash
cd migrations && npm run build
```

### 8. Update package.json scripts

Add to root `package.json`:
```json
{
  "scripts": {
    "build:migrations": "cd migrations && npm run build",
    "build": "npm run build:migrations && tauri build"
  }
}
```

## Migration Version Compatibility

Starting fresh with version 1 for the quick-actions migration. The old Rust migrations can be deleted since we're not porting them - existing users will simply re-run any relevant logic if needed, but the worktree-created-at migration is no longer necessary.

## Error Handling

- If Node.js is not installed, Rust should log an error but not crash the app
- Migration failures should be logged but not block app startup (graceful degradation)
- Consider adding a flag to `app-config.json` to track failed migrations for retry

## Testing

1. Fresh install: All migrations run
2. Existing install with v1: Only v2+ migrations run
3. No Node.js: App starts with warning, quick-actions unavailable
4. Migration failure: App starts with warning, subsequent migrations skipped
