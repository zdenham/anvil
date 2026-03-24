# Plan: Unique User Identifier for Log Tracking

## Overview

Add a persistent unique identifier (device ID) generated at the Rust app level to track logs per user/device. This identifier will be stored locally, sent with every log batch, and recorded in ClickHouse.

## Current State

- **Logging infrastructure**: `src-tauri/src/logging/` handles dual-output logging (console + JSON file) and batches logs to `https://anvil-server.fly.dev/logs`
- **Log schema**: Currently only has `timestamp`, `level`, `message` - no user identification
- **Configuration persistence**: `src-tauri/src/config.rs` uses JSON file storage at `~/.anvil/settings/app-config.json` (path resolved via `paths::app_config_file()`)
- **UUID support**: `uuid` crate already in `Cargo.toml` with v4 feature enabled
- **ClickHouse migrations**: Located in `server/migrations/`, follow `NNN_description.sql` pattern

## Storage Location

The device ID will be stored in `~/.anvil/settings/app-config.json` alongside existing settings (hotkeys, onboarding state). This file persists across app restarts and updates.

## Implementation Steps

### Step 1: Add device_id to AppConfig (Rust)

**File**: `src-tauri/src/config.rs`

Add a `device_id` field to `AppConfig` that auto-generates a UUID v4 on first load:

```rust
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "generate_device_id")]
    pub device_id: String,
    // ... existing fields ...
}

fn generate_device_id() -> String {
    Uuid::new_v4().to_string()
}
```

The `#[serde(default)]` attribute ensures existing configs without `device_id` will auto-generate one on load.

### Step 2: Update LogRow struct (Rust)

**File**: `src-tauri/src/logging/log_server.rs`

Add `device_id` field to the `LogRow` struct:

```rust
#[derive(Debug, Serialize)]
pub struct LogRow {
    pub timestamp: i64,
    pub level: String,
    pub message: String,
    pub device_id: String,  // NEW
}
```

### Step 3: Pass device_id to log server layer

**File**: `src-tauri/src/logging/log_server.rs`

Modify the `LogServerLayer` to hold the device_id and include it when creating log rows:

Option A: Load once at layer creation and store in the layer struct
Option B: Load from config on each batch send

Recommended: Option A for efficiency - load the device_id when creating the layer and store it.

```rust
pub struct LogServerLayer {
    sender: Mutex<Sender<LogRow>>,
    device_id: String,  // Cache the device_id
}

impl LogServerLayer {
    pub fn new(/* ... */) -> Self {
        let config = crate::config::load_config();
        // ... existing code ...
        Self {
            sender: Mutex::new(sender),
            device_id: config.device_id,
        }
    }
}
```

Then in `on_event`, use `self.device_id.clone()` when creating `LogRow`.

### Step 4: Create ClickHouse migration

**File**: `server/migrations/002_add_device_id_column.sql`

```sql
-- Add device_id column for user/device tracking
ALTER TABLE logs ADD COLUMN IF NOT EXISTS device_id String DEFAULT '' AFTER timestamp;
```

Notes:
- Using `DEFAULT ''` to handle existing rows without breaking queries
- New migration number `002` follows the existing `001_create_logs_table.sql`

### Step 5: Update server schema validation

**File**: `server/src/types/logs.ts`

Update the Zod schema to include `device_id`:

```typescript
export const LogRowSchema = z.object({
  timestamp: z.number(),
  level: LogLevelSchema,
  message: z.string(),
  device_id: z.string(),  // NEW - required field
});
```

### Step 6: Expose device_id to frontend (optional)

**File**: `src-tauri/src/config.rs`

Add a Tauri command to retrieve the device_id if needed by the frontend:

```rust
#[tauri::command]
pub fn get_device_id() -> String {
    load_config().device_id
}
```

Register in `lib.rs` if not already registered.

## File Changes Summary

| File | Change |
|------|--------|
| `src-tauri/src/config.rs` | Add `device_id` field to `AppConfig` with default UUID generation |
| `src-tauri/src/logging/log_server.rs` | Add `device_id` to `LogRow`, pass it from cached config |
| `server/migrations/002_add_device_id_column.sql` | New migration to add column |
| `server/src/types/logs.ts` | Add `device_id` to Zod schema |
| `src-tauri/src/lib.rs` | (Optional) Register `get_device_id` command |

## Testing

1. **Local testing**: Delete `~/.config/anvil/app-config.json`, restart app, verify new UUID is generated
2. **Persistence check**: Restart app again, verify same UUID is retained
3. **Log verification**: Check that logs sent to server include `device_id` field
4. **Migration testing**: Run migration against ClickHouse, verify existing logs have empty string default
5. **Query verification**: Query ClickHouse to confirm `device_id` is being stored correctly

## Rollout Considerations

- **Backward compatibility**: The server should handle logs both with and without `device_id` during transition
- **Existing logs**: Will have empty `device_id` (default value) - this is acceptable for historical data
- **Privacy**: Device ID is a random UUID, not tied to any PII. Consider documenting this for transparency.

## Future Enhancements (Out of Scope)

- User authentication/account linking (separate user_id vs device_id)
- Device ID reset functionality in settings
- Cross-device user identification
