# Rename Fly Apps: mort-server → anvil-server, mort-redis → anvil-redis

Fly.io does not support renaming apps in place. We must create new apps, deploy, migrate data/secrets, update all code references, then destroy the old apps.

Downtime is acceptable.

## Phases

- [x] Phase 1: Create new Fly apps
- [x] Phase 2: Migrate secrets and volumes
- [x] Phase 3: Deploy to new apps
- [x] Phase 4: Verify new apps are healthy
- [x] Phase 5: Update all code references (mort-server → anvil-server, mort-redis → anvil-redis)
- [ ] Phase 6: Deploy Anvil desktop app with new URLs (deferred — old apps kept alive as grace period)
- [ ] Phase 7: Destroy old Fly apps (deferred — after Phase 6 is verified)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create new Fly apps

```bash
fly apps create anvil-server --org fundamental-research-labs
fly apps create anvil-redis --org fundamental-research-labs
```

## Phase 2: Migrate secrets and volumes

### Secrets (anvil-server)

First, get current secret names:
```bash
fly secrets list -a mort-server
```

Then set them on the new app (fill in actual values — Fly only shows names, not values, so you need them from your records or `.env`):
```bash
fly secrets set -a anvil-server \
  CLICKHOUSE_URL="..." \
  CLICKHOUSE_USER="..." \
  CLICKHOUSE_PASSWORD="..." \
  CLICKHOUSE_DATABASE="..." \
  CLICKHOUSE_TABLE="..."
```

### Volume (anvil-redis)

Create a volume for Redis data on the new app:
```bash
fly volumes create redis_data -a anvil-redis --region sjc --size 1
```

Redis data is ephemeral — no migration needed, start fresh.

## Phase 3: Deploy to new apps

### Update fly.toml files

**`server/fly.toml`** — change line 7:
```
app = 'anvil-server'
```
Remove the `TODO(anvil-rename)` comment on line 6.

**`redis/fly.toml`** — change line 2:
```
app = 'anvil-redis'
```
Remove the `TODO(anvil-rename)` comment on line 1.

### Deploy

```bash
cd server && fly deploy
cd ../redis && fly deploy
```

## Phase 4: Verify new apps are healthy

```bash
# Server health
curl https://anvil-server.fly.dev/health

# Redis connectivity
fly proxy 16381:6379 -a anvil-redis &
redis-cli -p 16381 ping
# Expected: PONG

# Server status
fly status -a anvil-server
fly status -a anvil-redis
```

## Phase 5: Update all code references

Every file below has hardcoded `mort-server` or `mort-redis` references that must change. Remove all `TODO(anvil-rename)` comments as you go.

### Source code (causes runtime behavior change)

| File | Line | Old | New |
|------|------|-----|-----|
| `src/lib/constants.ts` | 3 | `https://mort-server.fly.dev` | `https://anvil-server.fly.dev` |
| `src-tauri/src/identity.rs` | 6 | `https://mort-server.fly.dev/identity` | `https://anvil-server.fly.dev/identity` |
| `src-tauri/src/logging/config.rs` | 20 | `https://mort-server.fly.dev/logs` | `https://anvil-server.fly.dev/logs` |
| `src-tauri/src/logging/mod.rs` | 272 | `"connecting to mort-server"` | `"connecting to anvil-server"` |
| `src-tauri/src/logging/log_server.rs` | 221 | `"connecting to mort-server"` | `"connecting to anvil-server"` |
| `src-tauri/capabilities/default.json` | 106 | `https://mort-server.fly.dev/*` | `https://anvil-server.fly.dev/*` |

### Tests

| File | Line | Old | New |
|------|------|-----|-----|
| `src/entities/gateway-channels/__tests__/store.test.ts` | 35 | `mort-server.fly.dev` | `anvil-server.fly.dev` |

### Docs & config

| File | Change |
|------|--------|
| `server/deployment.md` | All `mort-server` → `anvil-server` (lines 7, 29, 60, 63, 66, 69, 72, 85, 91) |
| `docs/fly-redis.md` | All `mort-redis` → `anvil-redis` (lines 4, 11, 45) |
| `server/package-lock.json` | `"name": "mort-server"` → `"name": "anvil-server"` (lines 2, 8) — or just `cd server && pnpm install` after changing `package.json` name |

### Already-completed plans (optional cleanup)

These are in `plans/completed/` and `plans/open-source-audit.md` — they reference `mort-server`/`mort-redis` as historical context. These can be left as-is since they document past state.

## Phase 6: Deploy Anvil desktop app with new URLs

After the code changes in Phase 5, build and release a new version of the desktop app so clients point at `anvil-server.fly.dev`.

**Note:** Any existing Anvil installs will lose telemetry/identity connectivity until they update. This is acceptable per stated downtime tolerance.

## Phase 7: Destroy old Fly apps

Only after Phase 6 is shipped and verified:

```bash
fly apps destroy mort-server --yes
fly apps destroy mort-redis --yes
```

Optionally keep the old apps alive for a grace period if you want to avoid breaking older desktop installs.
