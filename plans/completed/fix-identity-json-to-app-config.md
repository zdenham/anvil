# Fix: Replace identity.json reads with app-config.json

## Problem

Gateway channel code reads `device_id` from a nonexistent `identity.json` file:

```
[ERROR] [entities:hydrate] Failed to ensure gateway channel for anvil: Error: Identity file not found (identity.json)
```

The `device_id` was moved to `~/.anvil/settings/app-config.json` (managed by Rust `AppConfig` in `src-tauri/src/config.rs`), but two TypeScript files still look for the old `identity.json` path.

## Root Cause

Two files read `identity.json` via `appData.readJson("identity.json")`:

1. **`src/entities/gateway-channels/ensure-channel.ts:25-32`** — `getDeviceId()` reads `identity.json` and parses with `IdentitySchema`
2. **`src/entities/gateway-channels/webhook-helpers.ts:60-72`** — `loadDeviceId()` reads `identity.json` and extracts `device_id`

Both should read from `settings/app-config.json` instead, which is where the Rust backend persists `device_id` (auto-generated UUID on first run).

## Fix

### Phase 1: Update `ensure-channel.ts`

Replace the `getDeviceId()` function (lines 25-32):

**Before:**
```ts
import { IdentitySchema } from "@core/types/identity.js";

async function getDeviceId(): Promise<string> {
  const raw = await appData.readJson("identity.json");
  if (!raw) {
    throw new Error("Identity file not found (identity.json)");
  }
  const identity = IdentitySchema.parse(raw);
  return identity.device_id;
}
```

**After:**
```ts
async function getDeviceId(): Promise<string> {
  const raw = await appData.readJson<{ device_id?: string }>("settings/app-config.json");
  if (!raw?.device_id) {
    throw new Error("App config not found or missing device_id (settings/app-config.json)");
  }
  return raw.device_id;
}
```

- Remove the `IdentitySchema` import (no longer needed here)

### Phase 2: Update `webhook-helpers.ts`

Replace the `loadDeviceId()` function (lines 60-72):

**Before:**
```ts
export async function loadDeviceId(): Promise<string> {
  const raw = await appData.readJson("identity.json");
  if (!raw) {
    throw new Error("Identity file not found (identity.json)");
  }
  const identity = raw as { device_id?: string };
  if (!identity.device_id) {
    throw new Error("Invalid identity file: missing device_id");
  }
  return identity.device_id;
}
```

**After:**
```ts
export async function loadDeviceId(): Promise<string> {
  const raw = await appData.readJson<{ device_id?: string }>("settings/app-config.json");
  if (!raw?.device_id) {
    throw new Error("App config not found or missing device_id (settings/app-config.json)");
  }
  return raw.device_id;
}
```

### Phase 3: Clean up dead `IdentitySchema` import

After phase 1, check if `IdentitySchema` from `@core/types/identity.js` is imported anywhere else in `src/`. If it's unused across the frontend, the `core/types/identity.ts` file can be left alone (it may still be used server-side), but the import in `ensure-channel.ts` should be removed.

## Phases

- [x] Update `getDeviceId()` in `ensure-channel.ts` to read from `settings/app-config.json`
- [x] Update `loadDeviceId()` in `webhook-helpers.ts` to read from `settings/app-config.json`
- [x] Remove unused `IdentitySchema` import from `ensure-channel.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files Changed

| File | Change |
|---|---|
| `src/entities/gateway-channels/ensure-channel.ts` | Read `settings/app-config.json` instead of `identity.json`; remove `IdentitySchema` import |
| `src/entities/gateway-channels/webhook-helpers.ts` | Read `settings/app-config.json` instead of `identity.json` |

## Validation

After the fix, restart the app and verify:
- No `Identity file not found` errors in logs
- Gateway channels are created successfully during hydration
- `[ensureGatewayChannelForRepo] Created and activated channel for ...` appears in logs
