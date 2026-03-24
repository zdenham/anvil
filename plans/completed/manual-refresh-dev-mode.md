# Manual Refresh for Dev Mode (No Auto Hot Reload)

## Overview

Add a Tauri dev mode that disables automatic hot reloading (HMR) and instead provides a "Refresh" command in the spotlight for manual reload. This is useful for dev scenarios where HMR causes issues or where you want explicit control over when the app reloads.

## Current State

- Vite HMR is configured in `vite.config.ts:51-61`
- Dev server runs via `pnpm dev` → `./scripts/dev-anvil.sh dev` → `pnpm dev:run`
- Spotlight actions are added in `src/components/spotlight/spotlight.tsx` via `partialMatch()` in the `search()` method
- Dev mode detection: `import.meta.env.DEV` (Vite provides this, true during `tauri dev`)
- Window reload already works: `window.location.reload()` is used in `src/components/diff-viewer/diff-viewer.tsx`

## Implementation Steps

### Step 1: Add Environment Variable to Disable HMR

**File: `vite.config.ts`**

Add HMR disable logic based on environment variable:

```typescript
const disableHmr = process.env.ANVIL_DISABLE_HMR === "true";

// In server config:
server: {
  port: vitePort,
  strictPort: true,
  host: host || false,
  hmr: disableHmr ? false : (host
    ? { protocol: "ws", host, port: vitePort + 1 }
    : vitePort !== 1420
      ? { port: vitePort + 1 }
      : undefined),
  watch: disableHmr ? false : {
    ignored: ["**/src-tauri/**"],
  },
},
```

### Step 2: Create No-HMR Dev Script

**File: `package.json`**

Add a new script that sets the environment variable:

```json
"scripts": {
  "dev:no-hmr": "ANVIL_DISABLE_HMR=true pnpm dev",
  // ... existing scripts
}
```

Alternatively, add to `scripts/dev-anvil.sh` to accept a `--no-hmr` flag.

### Step 3: Add Refresh Action Type

**File: `src/components/spotlight/types.ts`**

Add a new action result type for refresh and update the `ActionResult` union:

```typescript
/** Internal type - refresh action (dev only) */
export interface RefreshResult {
  action: "refresh";
}

/** Internal type - action result discriminated union */
export type ActionResult = OpenRepoResult | OpenAnvilResult | OpenTasksResult | RefreshResult;
```

Note: The `SpotlightResult` type already uses `ActionResult`, so it will automatically include the new type.

### Step 4: Add Refresh to Spotlight Search (Dev Only)

**File: `src/components/spotlight/spotlight.tsx`**

First, add `RefreshResult` to the imports from `./types`:

```typescript
import {
  AppResultSchema,
  OpenRepoResult,
  OpenAnvilResult,
  OpenTasksResult,
  RefreshResult,  // Add this
  SpotlightResult,
} from "./types";
```

Then in the `search()` method, add a conditional refresh action:

```typescript
async search(query: string): Promise<SpotlightResult[]> {
  const results: SpotlightResult[] = [];

  // ... existing search logic ...

  // Add "Refresh" action ONLY in dev mode
  if (import.meta.env.DEV && this.partialMatch(query, "Refresh")) {
    const refreshData: RefreshResult = { action: "refresh" };
    results.push({
      type: "action",
      data: refreshData,
    });
  }

  // ... rest of method ...
}
```

### Step 5: Handle Refresh Action in activateResult

**File: `src/components/spotlight/spotlight.tsx`**

In the `activateResult` callback, add handling for the refresh action:

```typescript
} else if (result.type === "action" && result.data.action === "refresh") {
  // Refresh all windows by reloading current webview
  logger.info("[spotlight] Triggering manual refresh...");
  window.location.reload();
}
```

### Step 6: Add Refresh Display in Results Tray

**File: `src/components/spotlight/results-tray.tsx`**

In the `getResultDisplay` function, add handling for the refresh action before the default return:

```typescript
if (result.type === "action") {
  if (result.data.action === "open-anvil") {
    // ... existing code ...
  }
  if (result.data.action === "open-tasks") {
    // ... existing code ...
  }
  if (result.data.action === "refresh") {
    return {
      icon: <span className="text-3xl">🔄</span>,
      title: "Refresh",
      subtitle: "Reload the current window (dev only)",
    };
  }
  return {
    // ... existing open-repo fallback ...
  };
}
```

### Step 7: Add Visual Indicator (Optional Enhancement)

To make it clear the user is in "no-HMR" mode, consider adding a visual indicator in the spotlight or main window when HMR is disabled. This could be done by:

1. Exposing `ANVIL_DISABLE_HMR` via Vite's `define`:
   ```typescript
   define: {
     __ANVIL_DISABLE_HMR__: JSON.stringify(process.env.ANVIL_DISABLE_HMR === "true"),
   },
   ```

2. Showing a small badge or different border color on the spotlight when in no-HMR mode.

## File Changes Summary

| File | Change |
|------|--------|
| `vite.config.ts` | Add `ANVIL_DISABLE_HMR` env var check to disable HMR |
| `package.json` | Add `dev:no-hmr` script |
| `src/components/spotlight/types.ts` | Add `RefreshResult` type to `ActionResult` union |
| `src/components/spotlight/spotlight.tsx` | Add "Refresh" action in search + handle in activateResult |
| `src/components/spotlight/results-tray.tsx` | Add display handling for refresh action in `getResultDisplay` |

## Usage

```bash
# Normal dev mode (with HMR)
pnpm dev

# Dev mode without HMR (manual refresh only)
pnpm dev:no-hmr
```

Then type "Refresh" in the spotlight to trigger a manual page reload.

## Notes

- The refresh action is **only visible in dev builds** (`import.meta.env.DEV`)
- `window.location.reload()` will refresh the current webview/window
- If you need to refresh multiple windows, you could emit a Tauri event that all windows listen for, but starting with single-window refresh is simpler
- The HMR disable affects the Vite dev server's watch mode and WebSocket HMR connection

## Testing

1. Run `pnpm dev:no-hmr`
2. Open spotlight and type "Ref" - should see "Refresh" action appear
3. Select "Refresh" - page should reload
4. Make a code change - should NOT auto-reload
5. Run `pnpm dev` (normal mode) - Refresh action still available, but HMR should also work
