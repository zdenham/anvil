# Identity Table & Log Properties

Two related changes: (1) an identity table linking `device_id` to a GitHub handle, and (2) adding an optional properties dictionary to the existing `logs` table via a companion `log_properties` table, so logs can carry structured metadata for centralized analytics.

## Problem

- We have anonymous `device_id` UUIDs in logs but no way to tie them to a person
- Logs are flat (timestamp, level, message, device_id) — no way to attach structured properties
- The gateway needs identity for webhook routing

## Phases

- [x] Migrate existing `logs` table — add `log_id` column
- [x] Add ClickHouse `identities` table via SQL migration
- [x] Add ClickHouse `log_properties` table via SQL migration
- [x] Add Zod schemas and server endpoints for identity and log properties
- [x] Add local identity storage (`~/.anvil/settings/identity.json`)
- [x] Wire up Rust config to persist and expose identity locally
- [x] Add client-side `identify` function (Tauri command + server POST)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Device ID Stability

The `device_id` is a UUID v4 generated once on first app launch, persisted to `~/.anvil/settings/app-config.json`, and never regenerated. The `#[serde(default = "generate_device_id")]` only fires if the field is missing from the file. The code saves immediately after generation. It is stable across restarts and suitable as a long-lived identity key.

---

## Phase 1: Migrate Existing `logs` Table — Add `log_id`

The existing `logs` table has no unique identifier per row. We need one to link logs to their properties in the `log_properties` table. This migration adds a `log_id` column to the existing table.

### Migration: `server/migrations/003_add_log_id_column.sql`

```sql
-- Migration: 003_add_log_id_column
-- Description: Adds a unique log_id to the existing logs table for linking to log_properties

ALTER TABLE logs ADD COLUMN IF NOT EXISTS log_id String DEFAULT generateUUIDv4() FIRST;
```

**Design decisions:**

- **`generateUUIDv4()` default**: Existing rows get a UUID backfilled. New rows get one automatically. No application-level UUID generation required (though the client can supply one).
- **`FIRST` position**: Makes `log_id` the first column for readability.
- **Non-breaking**: Existing inserts that don't include `log_id` will get an auto-generated one. The existing `POST /logs` endpoint continues to work unchanged.
- **String type**: Consistent with ClickHouse UUID-as-String pattern used elsewhere (device_id).

### Updated `logs` schema after migration

```
logs (
    log_id String DEFAULT generateUUIDv4(),  -- NEW (migration 003)
    timestamp DateTime64(3),
    device_id String DEFAULT '',              -- added in migration 002
    level LowCardinality(String),
    message String
) ENGINE = MergeTree()
ORDER BY timestamp
TTL timestamp + INTERVAL 30 DAY
```

---

## Phase 2: ClickHouse `identities` Table

New migration: `server/migrations/004_create_identities_table.sql`

```sql
-- Migration: 004_create_identities_table
-- Description: Creates identity mapping from device_id to GitHub handle

CREATE TABLE IF NOT EXISTS identities (
    device_id String,
    github_handle String,
    registered_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(registered_at)
ORDER BY device_id
```

**Design decisions:**

- **`ReplacingMergeTree(registered_at)`**: Re-registering with a different handle upserts — keeps latest row per `device_id` on merge.
- **`ORDER BY device_id`**: One identity per device. Primary lookup key.
- **No TTL**: Identities are permanent.
- **Minimal columns**: Just the mapping. Ephemeral device state (name, lastSeenAt, online) belongs in Redis (gateway).

---

## Phase 3: ClickHouse `log_properties` Table

Instead of creating separate `events` + `event_properties` tables, we extend the existing `logs` table with an EAV companion table. Each log row can optionally have N property rows in `log_properties`. This keeps logs as the single central table and avoids duplicating the schema.

### Migration: `server/migrations/005_create_log_properties_table.sql`

```sql
-- Migration: 005_create_log_properties_table
-- Description: EAV table for optional structured properties on log rows

CREATE TABLE IF NOT EXISTS log_properties (
    log_id String,
    device_id String,
    timestamp DateTime64(3),
    key LowCardinality(String),
    value_string String DEFAULT '',
    value_number Float64 DEFAULT 0,
    value_bool UInt8 DEFAULT 0
) ENGINE = MergeTree()
ORDER BY (device_id, log_id, key)
TTL timestamp + INTERVAL 30 DAY
```

**Design decisions:**

- **Companion to `logs`, not a replacement**: The `logs` table is preserved as-is. `log_properties` is a sidecar linked by `log_id`. Logs without properties simply have no rows in this table.
- **`device_id` denormalized on properties**: Avoids joining back to `logs` for the most common filter. Enables queries like `SELECT key, value_string FROM log_properties WHERE device_id = '...' AND key = 'toolName'` without touching the logs table.
- **`timestamp` denormalized**: Enables TTL (must be on the table itself in ClickHouse) and time-range filtering on properties directly.
- **Same 30-day TTL as `logs`**: Properties expire with their parent log rows. Keeps retention consistent.
- **`ORDER BY (device_id, log_id, key)`**: Optimizes "get all properties for a log" and per-device filtering.
- **`LowCardinality(String)` for key**: There will be a small set of distinct property keys (~30). Low-cardinality encoding compresses these heavily.
- **EAV value columns**: `value_string`, `value_number`, `value_bool` — same pattern as the local SQLite drain. Only one is populated per row depending on the value type.
- **Properties populated in the future**: The table is created now but properties will be populated by future work. The `POST /logs` endpoint is updated to accept an optional `properties` dict, but existing clients don't need to send it.

### Query examples

```sql
-- All ERROR logs from a device in the last 24h
SELECT l.log_id, l.level, l.message, l.timestamp
FROM logs l
WHERE l.device_id = '550e8400-...'
  AND l.level = 'ERROR'
  AND l.timestamp > now() - INTERVAL 1 DAY
ORDER BY l.timestamp DESC;

-- Get properties for those logs
SELECT lp.log_id, lp.key, lp.value_string, lp.value_number
FROM log_properties lp
WHERE lp.device_id = '550e8400-...'
  AND lp.log_id IN (
    SELECT log_id FROM logs
    WHERE device_id = '550e8400-...'
      AND level = 'ERROR'
      AND timestamp > now() - INTERVAL 1 DAY
  );

-- Join identity to get human-readable owner
SELECT i.github_handle, count(*) as log_count
FROM logs l
JOIN identities i ON l.device_id = i.device_id
WHERE l.timestamp > now() - INTERVAL 7 DAY
GROUP BY i.github_handle;

-- Find all logs with a specific property value
SELECT l.log_id, l.message, lp.value_string
FROM logs l
JOIN log_properties lp ON l.log_id = lp.log_id
WHERE lp.key = 'task_id'
  AND lp.value_string = 'abc-123';
```

---

## Phase 4: Zod Schemas & Server Endpoints

### Types — `server/src/types/identity.ts`

```typescript
import { z } from "zod";

export const IdentitySchema = z.object({
  device_id: z.string().uuid(),
  github_handle: z.string().min(1).max(39),
});

export type Identity = z.infer<typeof IdentitySchema>;
```

### Updated Types — `server/src/types/logs.ts`

Extend the existing `LogRowSchema` to accept an optional `properties` dictionary. The `log_id` is optional on ingest (server generates one if not provided).

```typescript
import { z } from "zod";

export const LogLevelSchema = z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogRowSchema = z.object({
  log_id: z.string().uuid().optional(),  // NEW: optional, server generates if missing
  timestamp: z.number(),
  device_id: z.string(),
  level: LogLevelSchema,
  message: z.string(),
  properties: z.record(                  // NEW: optional structured metadata
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ).optional(),
});

export type LogRow = z.infer<typeof LogRowSchema>;

// ... rest unchanged (LogBatchSchema, response schemas, etc.)
```

**Note:** The `core/types/logs.ts` schema does NOT need `log_id` or `properties` yet — those are server-side concerns. The core schema remains the client-side wire format. When we're ready to send properties from the client, we update the core schema then.

### Endpoint — `POST /identity`

```typescript
fastify.post<{ Body: unknown }>("/identity", async (request, reply) => {
  const parseResult = IdentitySchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400);
    return { status: "error", message: parseResult.error.message };
  }

  const { device_id, github_handle } = parseResult.data;

  await clickhouse.insert({
    table: "identities",
    values: [{ device_id, github_handle }],
    format: "JSONEachRow",
  });

  return { status: "ok" };
});
```

### Updated Endpoint — `POST /logs`

The existing `/logs` endpoint is extended to handle optional `properties`. If a log row includes properties, the server decomposes them into EAV rows and inserts into `log_properties`. Backwards-compatible — existing clients that don't send `properties` or `log_id` continue to work.

```typescript
fastify.post<{ Body: unknown }>('/logs', async (request, reply) => {
  const parseResult = LogBatchSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400);
    return { status: 'error', message: `Invalid log batch: ${parseResult.error.message}` } satisfies LogErrorResponse;
  }

  const { logs } = parseResult.data;
  if (logs.length === 0) {
    return { status: 'ok', inserted: 0 } satisfies LogInsertResponse;
  }

  // Assign log_id to any rows missing one
  const logsWithIds = logs.map((log) => ({
    ...log,
    log_id: log.log_id ?? crypto.randomUUID(),
  }));

  // Insert log rows (without properties — ClickHouse column default handles log_id)
  const logRows = logsWithIds.map(({ properties, ...row }) => row);

  const result = await clickhouse.insert({
    table: TABLE,
    values: logRows,
    format: 'JSONEachRow',
  });

  // Decompose properties into EAV rows
  const propRows = logsWithIds.flatMap((log) =>
    Object.entries(log.properties ?? {}).map(([key, value]) => ({
      log_id: log.log_id,
      device_id: log.device_id,
      timestamp: log.timestamp,
      key,
      value_string: typeof value === "string" ? value : "",
      value_number: typeof value === "number" ? value : 0,
      value_bool: typeof value === "boolean" ? (value ? 1 : 0) : 0,
    }))
  );

  if (propRows.length > 0) {
    await clickhouse.insert({
      table: "log_properties",
      values: propRows,
      format: "JSONEachRow",
    });
  }

  const writtenRows = Number(result.summary?.written_rows ?? 0);
  return { status: 'ok', inserted: writtenRows } satisfies LogInsertResponse;
});
```

**Why on the existing logging server?** Identity and log properties are simple extensions to the existing log pipeline. No new services needed.

---

## Phase 5: Local Identity Storage

Store at `~/.anvil/settings/identity.json`:

```json
{
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "github_handle": "zac"
}
```

**Why separate from `app-config.json`?**

- `app-config.json` is Rust-owned (serde), contains UI settings (hotkeys, onboarding). Coupling identity there mixes domains.
- `identity.json` is readable by Node.js agents, the gateway client, and any process — without parsing the full app config.
- Follows "disk as truth" — any process reads this file to know who the current user is.

### Core type — `core/types/identity.ts`

```typescript
import { z } from "zod";

export const IdentitySchema = z.object({
  device_id: z.string().uuid(),
  github_handle: z.string().min(1),
});

export type Identity = z.infer<typeof IdentitySchema>;
```

---

## Phase 6: Rust Config — Expose Identity Locally

### `src-tauri/src/identity.rs`

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub device_id: String,
    pub github_handle: String,
}
```

Functions:
- `load_identity() -> Option<Identity>` — reads `~/.anvil/settings/identity.json`
- `save_identity(identity: &Identity) -> Result<(), String>` — writes it
- `get_github_handle() -> Option<String>` — convenience accessor

The `device_id` comes from the existing `AppConfig::device_id`. Identity file is created during onboarding or first gateway registration.

---

## Phase 7: Client-Side `identify` Function

The end-to-end flow: user provides their GitHub handle → Rust persists it locally → POSTs to the server → identity is linked in ClickHouse. Callable from the frontend as a Tauri command and usable by Node.js agents via the local `identity.json` file.

### Tauri Command — `src-tauri/src/identity.rs`

Extends the `identity.rs` module from Phase 6 with an `identify` function exposed as a Tauri command.

```rust
use crate::config::get_device_id;
use tracing::{info, warn};

const IDENTITY_SERVER_URL: &str = "https://anvil-server.fly.dev/identity";

/// Tauri command: link the current device to a GitHub handle.
/// Persists locally and registers with the server.
#[tauri::command]
pub async fn identify(github_handle: String) -> Result<(), String> {
    let device_id = get_device_id();
    let identity = Identity { device_id: device_id.clone(), github_handle: github_handle.clone() };

    // 1. Persist locally first (disk as truth)
    save_identity(&identity)?;
    info!(device_id = %device_id, github_handle = %github_handle, "Identity saved locally");

    // 2. Register with server (best-effort, don't block on failure)
    std::thread::spawn(move || {
        if let Err(e) = register_with_server(&device_id, &github_handle) {
            warn!(error = %e, "Failed to register identity with server — will retry on next launch");
        }
    });

    Ok(())
}

fn register_with_server(device_id: &str, github_handle: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("IDENTITY_SERVER_URL")
        .unwrap_or_else(|_| IDENTITY_SERVER_URL.to_string());

    #[derive(serde::Serialize)]
    struct Payload<'a> {
        device_id: &'a str,
        github_handle: &'a str,
    }

    ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(&Payload { device_id, github_handle })?;

    info!(device_id = %device_id, "Identity registered with server");
    Ok(())
}
```

**Design decisions:**

- **Local-first**: `save_identity` writes `~/.anvil/settings/identity.json` before contacting the server. If the server is unreachable, the local identity is still usable. Follows the "disk as truth" pattern.
- **Fire-and-forget server call**: `std::thread::spawn` keeps the Tauri command responsive. The `ReplacingMergeTree` on the server makes this idempotent — calling `identify` again just upserts.
- **No background worker/channel**: Unlike `LogServerLayer` which handles high-throughput batched logs, `identify` is called once (during onboarding or settings). A simple thread spawn with a single POST is sufficient.
- **Env var override**: `IDENTITY_SERVER_URL` allows pointing to a local dev server, same pattern as `LOG_SERVER_URL`.

### Registration in `lib.rs`

```rust
// Add to invoke_handler
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    identity::identify,
    identity::get_github_handle,
])
```

### Frontend Usage

Called from onboarding or a settings screen:

```typescript
import { invoke } from "@tauri-apps/api/core";

async function identify(githubHandle: string): Promise<void> {
  await invoke("identify", { githubHandle });
}
```

### Startup Re-registration

On app startup, if `identity.json` exists but the server registration may have failed previously, re-register. Add to the app setup hook in `lib.rs`:

```rust
// In the app setup closure
if let Some(identity) = identity::load_identity() {
    std::thread::spawn(move || {
        if let Err(e) = identity::register_with_server(&identity.device_id, &identity.github_handle) {
            warn!(error = %e, "Startup identity re-registration failed");
        }
    });
}
```

### Node.js Agent Usage

Agents can read identity directly from disk without going through Tauri:

```typescript
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { IdentitySchema } from "@anvil/core/types/identity";

async function loadIdentity() {
  const path = join(homedir(), ".anvil", "settings", "identity.json");
  const raw = JSON.parse(await readFile(path, "utf-8"));
  return IdentitySchema.parse(raw);
}
```

---

## Relationship to Existing Systems

### Local SQLite Drains → ClickHouse Log Properties

The Rust `SQLiteLayer` + `sqlite_worker` currently captures drain events locally in SQLite EAV tables. The `log_properties` table is the centralized equivalent. The two coexist:

| Storage | Purpose | Retention |
|---------|---------|-----------|
| SQLite (`drain.db`) | Local-first, always available, used by observability CLI | On-device, no TTL |
| ClickHouse (`logs` + `log_properties`) | Centralized analytics across all devices | 30 days |

A future `LogServerLayer` extension could dual-write properties to both. For now, the server endpoint accepts optional properties from any client.

### Gateway Integration

| Concern | Storage | Why |
|---------|---------|-----|
| "Who is this device?" | ClickHouse `identities` + local `identity.json` | Durable, survives restarts |
| "Is this device online?" | Redis (gateway) | Ephemeral, real-time |
| "What did this device do?" | ClickHouse `logs` + `log_properties` | Centralized analytics |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `server/migrations/003_add_log_id_column.sql` | Create |
| `server/migrations/004_create_identities_table.sql` | Create |
| `server/migrations/005_create_log_properties_table.sql` | Create |
| `server/src/types/identity.ts` | Create |
| `server/src/types/logs.ts` | Modify (add optional `log_id` and `properties` to schema) |
| `server/src/index.ts` | Modify (add `/identity` endpoint, extend `/logs` to handle properties) |
| `core/types/identity.ts` | Create |
| `core/types/index.ts` | Modify (re-export identity types) |
| `src-tauri/src/identity.rs` | Create (struct, load/save, `identify` command, `register_with_server`) |
| `src-tauri/src/lib.rs` | Modify (add `mod identity`, register commands, startup re-registration) |
