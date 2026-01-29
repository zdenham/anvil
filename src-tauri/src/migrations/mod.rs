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
