# Fix Missing sdk-runner.js Build Step

## Problem

The Tauri build fails with:
```
resource path `../sdk-runner.js` doesn't exist
```

The `tauri.conf.json` specifies bundled resources that don't exist:
```json
"resources": [
  "../agents/package.json",
  "../agents/dist/**/*",
  "../agents/node_modules/@anthropic-ai/**/*",
  "../core/sdk/template/**/*",
  "../sdk-runner.js",      // ← Missing!
  "../sdk-types.d.ts"      // ← Missing!
]
```

These files need to be built from `core/sdk/runner.ts` and `core/sdk/dist/index.d.ts` before the Tauri build runs.

## Root Cause Analysis

1. `core/sdk/runner.ts` exists and contains the SDK runner code
2. `core/sdk/dist/index.d.ts` exists with the SDK type definitions
3. The build configuration expects compiled versions at the project root (`../sdk-runner.js` relative to `src-tauri/`)
4. No build step exists to compile these files

## Solution: Follow agents/ Convention with esbuild

Follow the same build conventions used by the `agents/` package:
- Dedicated `package.json` in the source folder
- npm scripts matching the agents pattern (`build:sdk` similar to `build:agents`)
- Use **esbuild** directly (simpler than tsup for this single-entry-point use case)

### agents/ Convention Reference

The agents package uses:
- `agents/package.json` with `"build": "..."` script
- Root `package.json` with `"build:agents": "cd agents && pnpm build"`
- Concurrently for watch mode in dev

## Implementation

### Step 1: Add package.json to core/sdk/

Create `core/sdk/package.json`:
```json
{
  "name": "@mort/sdk-runner",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild runner.ts --bundle --format=esm --target=node22 --platform=node --outfile=../../sdk-runner.js --sourcemap && cp dist/index.d.ts ../../sdk-types.d.ts",
    "build:watch": "esbuild runner.ts --bundle --format=esm --target=node22 --platform=node --outfile=../../sdk-runner.js --sourcemap --watch"
  },
  "devDependencies": {
    "esbuild": "^0.20.2"
  },
  "dependencies": {
    "zod": "^4.3.5"
  }
}
```

### Step 2: Update root package.json

Add SDK build scripts alongside the existing agents scripts:
```json
{
  "scripts": {
    "dev:sdk": "cd core/sdk && pnpm build --watch",
    "build:sdk": "cd core/sdk && pnpm build && cp dist/index.d.ts ../../sdk-types.d.ts",
    "build:frontend": "pnpm build:agents && pnpm build:sdk && tsc && vite build"
  }
}
```

### Step 4: Update dev:run to include SDK

Update `dev:run` to build/watch SDK alongside agents:
```json
{
  "scripts": {
    "dev:run": "mkdir -p logs && concurrently -n agents,sdk,tauri -c green,blue,yellow \"pnpm dev:agents\" \"pnpm dev:sdk\" \"tauri dev $TAURI_ARGS\" 2>&1 | tee logs/dev.log"
  }
}
```

### Step 5: Update scripts/dev-mort.sh

Add initial SDK build before dev server starts:
```bash
# Build SDK runner (similar to how agents are built)
echo "Building SDK runner..."
pnpm build:sdk
```

### Step 6: Add to .gitignore

```
sdk-runner.js
sdk-types.d.ts
```

## Files to Modify

| File | Change |
|------|--------|
| `core/sdk/package.json` | Create new package.json with esbuild scripts |
| `package.json` | Add `build:sdk`, `dev:sdk` scripts; update `build:frontend` |
| `scripts/dev-mort.sh` | Add SDK build before dev server |
| `.gitignore` | Add `sdk-runner.js` and `sdk-types.d.ts` |

## Verification

```bash
# Install SDK dependencies
cd core/sdk && pnpm install && cd ../..

# Build SDK (should create sdk-runner.js and sdk-types.d.ts at root)
pnpm build:sdk

# Verify files exist
ls -la sdk-runner.js sdk-types.d.ts

# Run dev server (should now work)
pnpm dev
```

## Alternative: Quick Fix

If you need the build working immediately:

```bash
# Quick manual build using esbuild directly
cd core/sdk
npx esbuild runner.ts --bundle --format=esm --target=node22 --platform=node --outfile=../../sdk-runner.js
cp dist/index.d.ts ../../sdk-types.d.ts
cd ../..

# Then run dev
pnpm dev
```
