# Logging System Cleanup Plan

## Overview

The logging infrastructure has three main issues that need to be addressed:

1. **Package manager inconsistency**: Server has both `package-lock.json` (npm) and `pnpm-lock.yaml`, should be pnpm-only
2. **Type/schema mismatch**: `@core/types/logs.ts` defines 14 fields but ClickHouse table only has 3 columns - types need to match the simplified schema
3. **Rust client mismatch**: `log_server.rs` sends 14 fields but should only send the 3 that ClickHouse stores

## Source of Truth

The ClickHouse migration (`server/migrations/001_create_logs_table.sql`) is the source of truth:

```sql
CREATE TABLE IF NOT EXISTS logs (
    timestamp DateTime64(3),
    level LowCardinality(String),
    message String
) ENGINE = MergeTree()
ORDER BY timestamp
TTL timestamp + INTERVAL 30 DAY
```

**Only 3 fields**: `timestamp`, `level`, `message`

---

## Current State (What's Wrong)

### TypeScript Types (`@core/types/logs.ts`) - TOO MANY FIELDS
Currently defines 14 fields that don't exist in ClickHouse:
- `timestamp`, `level`, `message` - CORRECT (match schema)
- `target`, `version`, `session_id`, `app_suffix`, `source`, `task_id`, `thread_id`, `repo_name`, `worktree_path`, `duration_ms`, `data` - WRONG (not in schema)

### Rust Client (`log_server.rs`) - TOO MANY FIELDS
`LogRow` struct has the same 14 fields - sends data that gets silently dropped by ClickHouse.

### Server (`server/src/index.ts`)
Validates against the over-specified TypeScript types, then inserts. ClickHouse silently ignores the extra fields.

---

## Cleanup Tasks

### Phase 1: Server Package Cleanup

**Files to modify:**
- `server/package-lock.json` - DELETE

**Steps:**
1. Delete `server/package-lock.json`
2. Run `pnpm install` in server directory if needed

---

### Phase 2: Simplify TypeScript Types

**File to modify:** `core/types/logs.ts`

**New schema:**
```typescript
import { z } from "zod";

export const LogLevelSchema = z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Individual log row - matches ClickHouse schema exactly.
 */
export const LogRowSchema = z.object({
  timestamp: z.number(), // DateTime64(3) as milliseconds since epoch
  level: LogLevelSchema,
  message: z.string(),
});

export type LogRow = z.infer<typeof LogRowSchema>;

/**
 * Batch of logs sent from client to server
 */
export const LogBatchSchema = z.object({
  logs: z.array(LogRowSchema),
});

export type LogBatch = z.infer<typeof LogBatchSchema>;

/**
 * Server response for successful log insertion
 */
export const LogInsertResponseSchema = z.object({
  status: z.literal("ok"),
  inserted: z.number(),
});

export type LogInsertResponse = z.infer<typeof LogInsertResponseSchema>;

/**
 * Server response for errors
 */
export const LogErrorResponseSchema = z.object({
  status: z.literal("error"),
  message: z.string(),
});

export type LogErrorResponse = z.infer<typeof LogErrorResponseSchema>;

/**
 * Union of all possible server responses
 */
export const LogResponseSchema = z.discriminatedUnion("status", [
  LogInsertResponseSchema,
  LogErrorResponseSchema,
]);

export type LogResponse = z.infer<typeof LogResponseSchema>;
```

---

### Phase 3: Simplify Rust LogRow Struct

**File to modify:** `src-tauri/src/logging/log_server.rs`

**Changes needed:**

1. **Simplify `LogRow` struct** (lines 26-55):
```rust
#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp: i64,   // DateTime64(3) as milliseconds since epoch
    pub level: String,    // TRACE, DEBUG, INFO, WARN, ERROR
    pub message: String,
}
```

2. **Remove unused imports and code:**
   - Remove `SESSION_ID` static and `get_session_id()` function (lines 17-21)
   - Remove `LogVisitor` struct and all its field extraction logic (lines 282-329)
   - Remove `HashMap` import if no longer needed

3. **Simplify `on_event` in `LogServerLayer`** (lines 244-278):
```rust
fn on_event(
    &self,
    event: &tracing::Event<'_>,
    _ctx: tracing_subscriber::layer::Context<'_, S>,
) {
    let mut message = String::new();
    let mut visitor = MessageVisitor(&mut message);
    event.record(&mut visitor);

    let row = LogRow {
        timestamp: chrono::Utc::now().timestamp_millis(),
        level: event.metadata().level().to_string(),
        message,
    };

    if self.sender.send(row).is_err() {
        // Channel disconnected - worker thread has exited
    }
}
```

4. **Add simple `MessageVisitor`** (can reuse pattern from `mod.rs:252-270`):
```rust
struct MessageVisitor<'a>(&'a mut String);

impl tracing::field::Visit for MessageVisitor<'_> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            *self.0 = format!("{:?}", value);
            if self.0.starts_with('"') && self.0.ends_with('"') && self.0.len() >= 2 {
                *self.0 = self.0[1..self.0.len() - 1].to_string();
            }
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            *self.0 = value.to_string();
        }
    }
}
```

5. **Update/remove tests** (lines 354-435):
   - Remove tests for field extraction (`test_log_visitor_extracts_known_fields`, etc.)
   - Remove `test_session_id_is_consistent`
   - Keep or simplify remaining tests

---

### Phase 4: Verify Server Still Works

**File to review:** `server/src/index.ts`

The server should work unchanged since:
- It validates with Zod (now simplified schema)
- Inserts to ClickHouse with `JSONEachRow` format
- ClickHouse schema matches the 3 fields

No changes expected, but verify after TypeScript types change.

---

## Implementation Order

1. **Delete `server/package-lock.json`** - Quick win
2. **Update `core/types/logs.ts`** - Simplify to 3 fields
3. **Update `src-tauri/src/logging/log_server.rs`** - Simplify LogRow and remove field extraction
4. **Build and test** - Verify compilation and log flow

---

## Testing Plan

### Build Verification
1. `pnpm build` in server directory (TypeScript compiles)
2. `cargo build` in src-tauri (Rust compiles)

### Runtime Testing
1. Start the Fastify server with ClickHouse connected
2. Start the Tauri app with:
   ```bash
   LOG_SERVER_ENABLED=true LOG_SERVER_URL=http://localhost:3000/logs
   ```
3. Trigger some logs (app startup produces many)
4. Query ClickHouse to verify logs are inserted:
   ```sql
   SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10
   ```

---

## What We're Losing (Intentionally)

The simplified schema removes these fields that were being sent but never stored:
- `target` - Rust module path
- `version` - App version
- `session_id` - Per-launch UUID
- `app_suffix` - Dev/production indicator
- `source` - Window source
- `task_id`, `thread_id` - Context IDs
- `repo_name`, `worktree_path` - Git context
- `duration_ms` - Operation timing
- `data` - Extra JSON blob

If any of these are needed later, the migration should be updated first (as the source of truth), then types and Rust updated to match.
