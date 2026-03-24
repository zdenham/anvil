# 05: Build Scripts & Workflow

## Current Build Scripts

**`package.json`**:
```json
{
  "scripts": {
    "dev": "concurrently ... \"tauri dev\"",
    "build": "pnpm build:agents && tsc && vite build",
    "tauri": "tauri"
  }
}
```

## Design: Shell Script Presets

**Why shell scripts instead of cross-env?**

1. `cross-env` doesn't expand `~` or `$HOME` - it sets literal strings
2. Paths with spaces (like `Application Support`) are hard to escape in package.json
3. Shell scripts properly handle path expansion and quoting
4. Easier to add new build variants

## Implementation

### Shell Script Presets

**Create**: `scripts/env-presets/dev.sh`
```bash
# Dev build preset
export ANVIL_APP_SUFFIX=dev
export ANVIL_VITE_PORT=1421
export ANVIL_SPOTLIGHT_HOTKEY="Command+Shift+Space"
export ANVIL_CLIPBOARD_HOTKEY="Command+Shift+Option+C"
```

**Create**: `scripts/dev-anvil.sh`
```bash
#!/bin/bash
set -e

PRESET=${1:-prod}

# Source preset if it exists
if [ -f "scripts/env-presets/${PRESET}.sh" ]; then
  source "scripts/env-presets/${PRESET}.sh"
fi

echo "Starting Anvil with:"
echo "  ANVIL_APP_SUFFIX=${ANVIL_APP_SUFFIX:-<production>}"
echo "  ANVIL_VITE_PORT=${ANVIL_VITE_PORT:-1420}"

# Pass remaining args and config flag if not production
if [ "$PRESET" = "prod" ] || [ -z "$PRESET" ]; then
  pnpm dev:run
else
  pnpm dev:run -- --config "src-tauri/tauri.conf.${PRESET}.json"
fi
```

**Create**: `scripts/build-anvil.sh`
```bash
#!/bin/bash
set -e

PRESET=${1:-prod}

# Source preset if it exists
if [ -f "scripts/env-presets/${PRESET}.sh" ]; then
  source "scripts/env-presets/${PRESET}.sh"
fi

echo "Building Anvil with:"
echo "  ANVIL_APP_SUFFIX=${ANVIL_APP_SUFFIX:-<production>}"
echo "  ANVIL_SPOTLIGHT_HOTKEY=${ANVIL_SPOTLIGHT_HOTKEY:-Command+Space}"
echo "  ANVIL_CLIPBOARD_HOTKEY=${ANVIL_CLIPBOARD_HOTKEY:-Command+Option+C}"

pnpm build:frontend

if [ "$PRESET" = "prod" ] || [ -z "$PRESET" ]; then
  tauri build
else
  tauri build --config "src-tauri/tauri.conf.${PRESET}.json"
fi

echo "Build complete: src-tauri/target/release/bundle/macos/"
```

### Package.json Scripts

**`package.json`** (simplified - delegates to shell scripts):
```json
{
  "scripts": {
    "dev": "./scripts/dev-anvil.sh dev",
    "dev:run": "mkdir -p logs && concurrently -n agents,tauri -c green,yellow \"pnpm dev:agents\" \"tauri dev\" 2>&1 | tee logs/dev.log",

    "build": "./scripts/build-anvil.sh",
    "build:frontend": "pnpm build:agents && tsc && vite build"
  }
}
```

### Script Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run dev instance (port 1421, purple spotlight, hot reload) |
| `pnpm build` | Build stable app for /Applications |

### Adding More Instances

To add a new instance (e.g., `feature-xyz`):

1. Create preset: `scripts/env-presets/feature-xyz.sh`
2. Create config overlay: `src-tauri/tauri.conf.feature-xyz.json`
3. Optionally add script: `"dev:feature-xyz": "./scripts/dev-anvil.sh feature-xyz"`

### Usage

```bash
# Development (hot reload, purple spotlight)
pnpm dev

# Build stable app
pnpm build
```

## Vite Config Updates

**`vite.config.ts`**:
```typescript
import { defineConfig } from "vite";

const vitePort = parseInt(process.env.ANVIL_VITE_PORT || '1420', 10);
const appSuffix = process.env.ANVIL_APP_SUFFIX || '';

export default defineConfig(async () => ({
  server: {
    port: vitePort,
    strictPort: true,
    hmr: vitePort !== 1420
      ? { port: vitePort + 1, host: 'localhost' }
      : undefined,
  },
  define: {
    __ANVIL_APP_SUFFIX__: JSON.stringify(appSuffix),
  },
}));
```

**Frontend usage** (`src/lib/constants.ts`):
```typescript
declare const __ANVIL_APP_SUFFIX__: string;
export const APP_SUFFIX = __ANVIL_APP_SUFFIX__;
export const IS_ALTERNATE_BUILD = APP_SUFFIX !== '';
```

## Workflow

### Dogfooding: Using Anvil to build Anvil

```bash
# One-time: Build and install stable Anvil
pnpm build
cp -r src-tauri/target/release/bundle/macos/Anvil.app /Applications/

# Daily: Use installed Anvil.app as your daily driver
# Run dev instance for active development
pnpm dev
# This runs on port 1421, uses ~/.anvil-dev directory, purple spotlight
```

### Adding more instances (advanced)

```bash
# Create a new preset
cat > scripts/env-presets/feature-xyz.sh << 'EOF'
export ANVIL_APP_SUFFIX=feature-xyz
export ANVIL_VITE_PORT=1423
export ANVIL_SPOTLIGHT_HOTKEY="Command+Option+Space"
export ANVIL_CLIPBOARD_HOTKEY="Command+Option+Shift+C"
EOF

# Create config overlay
cat > src-tauri/tauri.conf.feature-xyz.json << 'EOF'
{
  "productName": "Anvil Feature XYZ",
  "identifier": "com.getanvil.app.feature-xyz",
  "build": {
    "devUrl": "http://localhost:1423"
  }
}
EOF

# Run it
./scripts/dev-anvil.sh feature-xyz
```

## CI/CD Considerations

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup
        run: pnpm install
      - name: Build
        run: pnpm build
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: anvil
          path: src-tauri/target/release/bundle/
```

## Files to Create/Modify

| File | Change |
|------|--------|
| `scripts/env-presets/dev.sh` | **NEW**: Dev preset env vars |
| `scripts/dev-anvil.sh` | **NEW**: Dev wrapper script |
| `scripts/build-anvil.sh` | **NEW**: Build wrapper script |
| `package.json` | **MODIFY**: Update script aliases |
| `vite.config.ts` | **MODIFY**: Read `ANVIL_VITE_PORT`, `ANVIL_APP_SUFFIX` env vars |
| `src/lib/constants.ts` | **NEW**: Export `APP_SUFFIX` and `IS_ALTERNATE_BUILD` |

### Make Scripts Executable

```bash
chmod +x scripts/dev-anvil.sh scripts/build-anvil.sh
```

## Verification

1. Run `pnpm build` and install to /Applications
2. Launch Anvil.app from Finder (stable, port 1420, default hotkeys)
3. Run `pnpm dev` (dev instance, port 1421, purple spotlight)
4. Both run simultaneously with different hotkeys and data directories
