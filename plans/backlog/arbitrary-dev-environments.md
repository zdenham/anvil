# Arbitrary Dev Environment Support

## Problem

We currently support two environments (dev and prod), but need to support arbitrarily many dev environments with port rotation, separate mort directories, and unique hotkeys. Each git worktree needs its own isolated dev environment.

## Current State

- Two hardcoded environments: `prod` (default) and `dev`
- Manual preset files in `scripts/env-presets/`
- Ports, hotkeys, directories are manually assigned
- Agents in worktrees have no easy way to discover their environment details

## Proposed Solution: Auto-Derived Environments

**Core Idea**: Derive all environment values from a single identifier (the env name) using deterministic algorithms.

---

## Implementation

### 1. Environment Resolution Script

**File**: `scripts/env-resolver.sh`

```bash
#!/bin/bash
# Resolves all env vars from a single ENV_NAME

ENV_NAME="${1:-prod}"

# If prod, use defaults
if [ "$ENV_NAME" = "prod" ]; then
  export MORT_ENV_NAME="prod"
  export MORT_APP_SUFFIX=""
  export MORT_VITE_PORT=1420
  export MORT_DIR="$HOME/.mort"
  export MORT_CONFIG_DIR="$HOME/.config/mortician"
  export MORT_SPOTLIGHT_HOTKEY="Command+Space"
  export MORT_CLIPBOARD_HOTKEY="Command+Option+C"
else
  # Derive port from hash of env name (deterministic, in range 1421-1499)
  PORT_OFFSET=$(echo -n "$ENV_NAME" | cksum | cut -d' ' -f1)
  PORT_OFFSET=$((PORT_OFFSET % 79 + 1))  # 1-79 range

  export MORT_ENV_NAME="$ENV_NAME"
  export MORT_APP_SUFFIX="$ENV_NAME"
  export MORT_VITE_PORT=$((1420 + PORT_OFFSET))
  export MORT_DIR="$HOME/.mort-$ENV_NAME"
  export MORT_CONFIG_DIR="$HOME/.config/mortician-$ENV_NAME"

  # Hotkeys: use modifier combos based on env
  # Non-prod envs get shifted modifiers to avoid conflicts with prod
  export MORT_SPOTLIGHT_HOTKEY="Command+Shift+Option+Space"
  export MORT_CLIPBOARD_HOTKEY="Command+Shift+Control+C"
fi

export MORT_HMR_PORT=$((MORT_VITE_PORT + 1))
export MORT_TAURI_DEV_URL="http://localhost:$MORT_VITE_PORT"
```

### 2. Auto-Detect Worktree Name

**File**: `scripts/detect-env.sh`

```bash
#!/bin/bash
# Auto-detect env name from git worktree path

get_env_name() {
  local worktree_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")

  # Main repo = prod, worktrees = their directory name
  if [ "$worktree_name" = "mortician" ]; then
    echo "prod"
  else
    echo "$worktree_name"
  fi
}

# If sourced, export function. If executed, print result.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  get_env_name
fi
```

### 3. Print Environment Script

**File**: `scripts/print-env.ts`

```typescript
#!/usr/bin/env tsx
// Prints current environment details in both human and JSON format

interface EnvDetails {
  envName: string;
  appSuffix: string;
  vitePort: number;
  hmrPort: number;
  mortDir: string;
  configDir: string;
  spotlightHotkey: string;
  clipboardHotkey: string;
  tauriDevUrl: string;
}

function getEnvDetails(): EnvDetails {
  const vitePort = parseInt(process.env.MORT_VITE_PORT || '1420');
  const envName = process.env.MORT_ENV_NAME || 'prod';
  const suffix = process.env.MORT_APP_SUFFIX || '';

  return {
    envName,
    appSuffix: suffix,
    vitePort,
    hmrPort: vitePort + 1,
    mortDir: process.env.MORT_DIR || `${process.env.HOME}/.mort${suffix ? `-${suffix}` : ''}`,
    configDir: process.env.MORT_CONFIG_DIR || `${process.env.HOME}/.config/mortician${suffix ? `-${suffix}` : ''}`,
    spotlightHotkey: process.env.MORT_SPOTLIGHT_HOTKEY || 'Command+Space',
    clipboardHotkey: process.env.MORT_CLIPBOARD_HOTKEY || 'Command+Option+C',
    tauriDevUrl: `http://localhost:${vitePort}`,
  };
}

function printHuman(details: EnvDetails): void {
  const lines = [
    '╔═══════════════════════════════════════════════════╗',
    '║           Mort Environment Details                ║',
    '╠═══════════════════════════════════════════════════╣',
    `║  ENV_NAME:      ${details.envName.padEnd(33)}║`,
    `║  APP_SUFFIX:    ${(details.appSuffix || '<none>').padEnd(33)}║`,
    `║  VITE_PORT:     ${String(details.vitePort).padEnd(33)}║`,
    `║  HMR_PORT:      ${String(details.hmrPort).padEnd(33)}║`,
    `║  MORT_DIR:      ${details.mortDir.padEnd(33)}║`,
    `║  CONFIG_DIR:    ${details.configDir.padEnd(33)}║`,
    `║  SPOTLIGHT:     ${details.spotlightHotkey.padEnd(33)}║`,
    `║  CLIPBOARD:     ${details.clipboardHotkey.padEnd(33)}║`,
    `║  TAURI_DEV_URL: ${details.tauriDevUrl.padEnd(33)}║`,
    '╚═══════════════════════════════════════════════════╝',
  ];

  lines.forEach(line => console.log(line));
}

function printJson(details: EnvDetails): void {
  console.log(JSON.stringify(details, null, 2));
}

function printShell(details: EnvDetails): void {
  // Output that can be eval'd by shell scripts
  console.log(`export MORT_ENV_NAME="${details.envName}"`);
  console.log(`export MORT_APP_SUFFIX="${details.appSuffix}"`);
  console.log(`export MORT_VITE_PORT="${details.vitePort}"`);
  console.log(`export MORT_HMR_PORT="${details.hmrPort}"`);
  console.log(`export MORT_DIR="${details.mortDir}"`);
  console.log(`export MORT_CONFIG_DIR="${details.configDir}"`);
  console.log(`export MORT_SPOTLIGHT_HOTKEY="${details.spotlightHotkey}"`);
  console.log(`export MORT_CLIPBOARD_HOTKEY="${details.clipboardHotkey}"`);
  console.log(`export MORT_TAURI_DEV_URL="${details.tauriDevUrl}"`);
}

const details = getEnvDetails();

if (process.argv.includes('--json')) {
  printJson(details);
} else if (process.argv.includes('--shell')) {
  printShell(details);
} else {
  printHuman(details);
}
```

### 4. Dynamic Tauri Config Generation

**File**: `scripts/generate-tauri-conf.sh`

```bash
#!/bin/bash
# Generates tauri.conf.local.json from current env vars
# This avoids needing separate tauri.conf.*.json for each environment

set -e

VITE_PORT="${MORT_VITE_PORT:-1420}"
APP_SUFFIX="${MORT_APP_SUFFIX:-}"

if [ -n "$APP_SUFFIX" ]; then
  IDENTIFIER="com.juice.mort-$APP_SUFFIX"
  PRODUCT_NAME="Mort ($APP_SUFFIX)"
else
  IDENTIFIER="com.juice.mort"
  PRODUCT_NAME="Mort"
fi

cat > src-tauri/tauri.conf.local.json << EOF
{
  "\$schema": "https://schema.tauri.app/config/2",
  "identifier": "$IDENTIFIER",
  "productName": "$PRODUCT_NAME",
  "build": {
    "devUrl": "http://localhost:$VITE_PORT"
  }
}
EOF

echo "Generated src-tauri/tauri.conf.local.json for $MORT_ENV_NAME"
```

### 5. Updated Dev Script

**File**: `scripts/dev-mort.sh` (modified)

```bash
#!/bin/bash
set -e

# Auto-detect or use provided env name
if [ -n "$1" ]; then
  ENV_NAME="$1"
else
  ENV_NAME=$(./scripts/detect-env.sh)
fi

# Resolve all environment variables
source ./scripts/env-resolver.sh "$ENV_NAME"

# Print environment details
pnpm print-env

# Generate dynamic tauri config
./scripts/generate-tauri-conf.sh

# Set TAURI_ARGS to use generated config for non-prod
if [ "$ENV_NAME" != "prod" ]; then
  export TAURI_ARGS="--config src-tauri/tauri.conf.local.json"
fi

pnpm dev:run
```

### 6. Package.json Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "env": "./scripts/detect-env.sh",
    "print-env": "tsx scripts/print-env.ts",
    "print-env:json": "tsx scripts/print-env.ts --json",
    "print-env:shell": "tsx scripts/print-env.ts --shell",
    "dev": "./scripts/dev-mort.sh",
    "dev:env": "./scripts/dev-mort.sh"
  }
}
```

---

## Usage

### Starting a Dev Environment

```bash
# In any worktree - auto-detects env name from directory
pnpm dev

# Or specify explicitly
pnpm dev my-feature
```

### Getting Environment Details (for agents)

```bash
# Human-readable output
pnpm print-env

# JSON output for programmatic use
pnpm print-env:json

# Shell-eval output
eval $(pnpm print-env:shell)
```

### Example Output

```
╔═══════════════════════════════════════════════════╗
║           Mort Environment Details                ║
╠═══════════════════════════════════════════════════╣
║  ENV_NAME:      feature-auth                      ║
║  APP_SUFFIX:    feature-auth                      ║
║  VITE_PORT:     1447                              ║
║  HMR_PORT:      1448                              ║
║  MORT_DIR:      /Users/zac/.mort-feature-auth     ║
║  CONFIG_DIR:    ~/.config/mortician-feature-auth  ║
║  SPOTLIGHT:     Command+Shift+Option+Space        ║
║  CLIPBOARD:     Command+Shift+Control+C           ║
║  TAURI_DEV_URL: http://localhost:1447             ║
╚═══════════════════════════════════════════════════╝
```

---

## Port Assignment Strategy

Ports are derived deterministically from the env name using `cksum`:

```bash
PORT_OFFSET=$(echo -n "$ENV_NAME" | cksum | cut -d' ' -f1)
PORT_OFFSET=$((PORT_OFFSET % 79 + 1))  # Range: 1-79
VITE_PORT=$((1420 + PORT_OFFSET))       # Range: 1421-1499
```

This ensures:
- Same env name always gets same port
- Ports don't conflict with prod (1420)
- 79 possible ports should be enough for any reasonable number of worktrees

---

## Hotkey Considerations

**Limitation**: macOS global hotkeys must be unique system-wide. We cannot have truly unique hotkeys per environment without user configuration.

**Current approach**:
- Prod uses `Command+Space` / `Command+Option+C`
- All dev envs use `Command+Shift+Option+Space` / `Command+Shift+Control+C`

**Future improvement**: Could add env-specific hotkey config that users can customize per-environment, stored in each env's config directory.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/env-resolver.sh` | Create | Core env variable resolution |
| `scripts/detect-env.sh` | Create | Auto-detect env from worktree |
| `scripts/print-env.ts` | Create | Human/JSON/shell output |
| `scripts/generate-tauri-conf.sh` | Create | Dynamic tauri config |
| `scripts/dev-mort.sh` | Modify | Use new resolver system |
| `package.json` | Modify | Add new scripts |
| `.gitignore` | Modify | Add `src-tauri/tauri.conf.local.json` |

---

## Migration Path

1. Create new scripts without removing old `env-presets/` system
2. Update `dev-mort.sh` to use new system with fallback
3. Test with multiple worktrees
4. Remove old `env-presets/` directory once stable

---

## Open Questions

1. **Hotkey uniqueness**: Should we support per-env hotkey configuration? Or accept that only one dev env can have working hotkeys at a time?

2. **Port collision handling**: Should we detect port-in-use and auto-increment, or fail fast and let user specify?

3. **Worktree naming convention**: Should we enforce/suggest a naming convention for worktrees to ensure short, unique names?
