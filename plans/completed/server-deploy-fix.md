# Server Deploy Fix — Log Properties

Deploying the server to Fly.io so `log_properties` EAV rows get populated in ClickHouse.

## What's Already Done

- [x] **Rust `LogServerLayer` updated** — `FieldVisitor` now captures all structured tracing fields into a `properties: Option<HashMap<String, serde_json::Value>>` on `LogRow`. Handles `str`, `i64`, `u64`, `f64`, `bool`, and `debug` fallback. Serialization skips `properties` when `None` (backward compatible). All tests pass (`cargo test --lib`).
- [x] **Server `/logs` endpoint updated** — Accepts optional `properties` dict, decomposes into EAV rows in `log_properties` table. Also accepts optional `log_id` (generates UUID if missing).
- [x] **Server `/identity` endpoint added** — POSTs `device_id` + `github_handle` to `identities` table.
- [x] **ClickHouse migrations 003-005 ran successfully** — `log_id` column on `logs`, `identities` table, `log_properties` table all exist in production ClickHouse.
- [x] **Commits made** — `ce74262`, `ff45990`, `a121907` on `gateway` branch.
- [x] **tsconfig.json fixed** — `outDir: "dist"` added, `../core/types/*.ts` removed from `include` (server never imports from `core/types/` directly).
- [x] **Local build verified** — `pnpm run build` produces clean `dist/` with flat structure: `dist/index.js`, `dist/types/logs.js`, `dist/types/identity.js`.

## What Failed

Three deploy attempts failed:

1. **Attempt 1** — No `outDir` in tsconfig → tsc output JS files next to TS sources → `dist/index.js` not found → crash on boot.
2. **Attempt 2** — Added `outDir: "dist"` but Dockerfile still had `COPY . .` (server-only context) → worked locally but the Dockerfile expected `server/package.json` paths for repo-root context → confused state.
3. **Attempt 3** — Updated Dockerfile to use repo-root context (`COPY server/ .`, `COPY core/types/ ../core/types/`), ran `fly deploy . -c server/fly.toml --dockerfile server/Dockerfile` → tsc compilation fails because `../core/types/*.ts` files import `zod` but `node_modules/` is only in `/app/`, not in `../core/`.

## The Core Problem

The tsconfig `include` previously had `../core/types/*.ts`. This worked locally because `zod` resolves from the server's `node_modules/` via Node's resolution. But inside Docker, `../core/types/` is at `/core/types/` which is outside `/app/node_modules/` resolution scope, so tsc can't find `zod`.

**This is now fixed** — `../core/types/*.ts` was removed from `include` since the server never imports from `core/types/` directly. The tsconfig only includes `src/**/*`.

## What Needs to Happen

### Phase 1: Fix Dockerfile and deploy config

The Dockerfile and `package.json` `start` script need to be consistent with the current state:

- **tsconfig** outputs to `dist/` with only `src/**/*` included → output is `dist/index.js` (flat, no nesting)
- **`package.json` start script** currently says `node dist/server/src/index.js` — this is WRONG for the current tsconfig. It should be `node dist/index.js` since there's no more `../core/types` causing path nesting.
- **Dockerfile** currently references `server/package.json` and `COPY server/ .` and `COPY core/types/ ../core/types/` — the `core/types` COPY line is no longer needed and the Dockerfile should go back to a simple `server/`-only context.

Concrete changes:

1. **`server/package.json`**: Change `"start": "node dist/server/src/index.js"` → `"start": "node dist/index.js"`
2. **`server/Dockerfile`**: Revert to simple server-only context:
   ```dockerfile
   COPY package.json pnpm-lock.yaml ./
   RUN pnpm install --frozen-lockfile --prod=false
   COPY . .
   RUN pnpm run build
   ```
   Remove the `COPY core/types/ ../core/types/` line and the `COPY server/` prefixed lines.
3. **`.dockerignore`** (repo root): Can be deleted — no longer needed since we go back to server-only context.
4. **`server/fly.toml`**: Keep `[build]` empty (no `dockerfile` override needed).

### Phase 2: Deploy

```bash
cd server && fly deploy
```

That's it. The deploy runs from `server/`, uses `server/Dockerfile` with server-only context, builds with `tsc` into `dist/`, and `node dist/index.js` starts the app.

### Phase 3: Verify

After deploy:
1. `curl https://anvil-server.fly.dev/health` — should return healthy
2. Restart the desktop app — the `paths::initialize()` tracing event at startup should now send `data_dir`, `config_dir`, `shell_path`, `app_suffix` as properties
3. Query ClickHouse:
   ```sql
   SELECT * FROM log_properties ORDER BY timestamp DESC LIMIT 20;
   ```
   Should see rows with keys like `data_dir`, `config_dir`, `shell_path`, `app_suffix`.

## Phases

- [x] Rust LogServerLayer: capture structured fields as properties
- [x] Server code: log_id, properties EAV, identity endpoint
- [x] ClickHouse migrations
- [x] Fix Dockerfile/package.json start path inconsistency
- [x] Deploy to Fly.io
- [ ] Verify log_properties populated in ClickHouse

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Current File State (for reference)

### `server/tsconfig.json` (correct, no changes needed)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `server/package.json` start script (NEEDS FIX)
```
"start": "node dist/server/src/index.js"  →  "start": "node dist/index.js"
```

### `server/Dockerfile` (NEEDS FIX — revert to simple context)
Current state has `COPY server/package.json` and `COPY core/types/` lines that assume repo-root context. Revert to:
```dockerfile
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm run build
RUN pnpm prune --prod
```

### `server/fly.toml` [build] section (correct, keep empty)
```toml
[build]
```
