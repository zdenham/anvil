# Diagnosis: `runner.js` not found at `agents/dist/runner.js`

## Root Cause

**Race condition in `pnpm dev`** — `tauri dev` can start the frontend (and thus spawn agents) before `pnpm dev:agents` (`tsup --watch`) has finished its first build.

The `dev:run` script in `package.json`:

```
concurrently "pnpm dev:agents" "pnpm dev:sdk" "pnpm dev:migrations" "tauri dev"
```

All four processes start simultaneously. `tauri dev` compiles Rust + launches the webview, which loads the Vite dev server. As soon as the frontend is ready and the user triggers an agent, `agent-service.ts:getRunnerPaths()` resolves to:

```
${__PROJECT_ROOT__}/agents/dist/runner.js
```

But `tsup --watch` may not have completed its initial build yet. The `agents/dist/` directory only contains a `.gitkeep` placeholder until tsup runs — the built files are gitignored (root `.gitignore` has `dist`).

**Secondary issue**: `agents/dist/cli/anvil.js` is also empty (the `cli/` dir exists but has no files), which would cause a similar failure for CLI-based agent operations.

## Why it doesn't always happen

- If the agents build finishes before the user triggers an agent, it works fine
- `dev:run:no-hmr` path does `pnpm build:agents` synchronously *before* `tauri dev`, so it never hits this
- On fast machines, tsup may finish before Rust compilation + webview launch completes

## Proposed Fix

**Option A (recommended): Pre-build agents before starting concurrently**

In `dev-anvil.sh`, add an initial agents build before the concurrent `dev:run`:

```bash
# Build agents once so runner.js exists immediately
echo "Building agents..."
pnpm build:agents

# Then start watch mode + tauri dev concurrently
pnpm dev:run
```

This ensures `agents/dist/runner.js` exists from the start. The `--watch` mode in `dev:run` will pick up subsequent changes. Adds ~1-2s to startup.

Alternatively, modify `dev:run` in `package.json` to sequence the agents build:

```json
"dev:run": "pnpm build:agents && mkdir -p logs && concurrently ..."
```

**Option B: Add retry/wait logic in agent-service**

In `spawnSimpleAgent()`, when `runnerExists` is false, wait briefly and retry before failing:

```typescript
if (!runnerExists) {
  logger.warn("[agent-service] runner.js not found, waiting for build...");
  // wait up to 10s for the file to appear
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await fs.exists(runnerPath)) break;
  }
}
```

This is more resilient but masks the underlying ordering problem.

**Option C: Both A + B**

Pre-build for the common case, retry as a safety net.

## Recommendation

Go with **Option A** — it's simple, addresses the root cause, and the startup cost is negligible since tsup builds in ~150ms. Option B adds unnecessary complexity for a dev-only race condition.
