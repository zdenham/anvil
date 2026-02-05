# Fix Production Migrations Failure

## Problem

TypeScript migrations fail silently in production builds with the warning:
```
[14:27:49.613] [WARN ] [mort_lib] TypeScript migrations failed (non-fatal)
```

## Root Cause

The migration runner uses ES modules (`import` statements) and requires `"type": "module"` in package.json to work. However, the Tauri bundle configuration only includes `migrations/dist/**/*` but **not** `migrations/package.json`.

When Node.js runs the bundled `runner.js` without the package.json, it defaults to CommonJS mode and fails with:
```
SyntaxError: Cannot use import statement outside a module
```

### Evidence

1. **Dev mode works** - running migrations from source succeeds because package.json is present:
   ```bash
   MORT_DATA_DIR=/Users/zac/.mort \
   MORT_TEMPLATE_DIR=core/sdk/template \
   MORT_SDK_TYPES_PATH=core/sdk/dist/index.d.ts \
   node migrations/dist/runner.js
   # Works - package.json with "type": "module" is in parent directory
   ```

2. **Production fails** - running from bundled app resources fails:
   ```bash
   node /Applications/Mort.app/Contents/Resources/_up_/migrations/dist/runner.js
   # SyntaxError: Cannot use import statement outside a module
   ```

3. **Missing file** - `package.json` is not present in production:
   ```
   /Applications/Mort.app/Contents/Resources/_up_/migrations/
   └── dist/           # Only this directory is bundled
       ├── runner.js
       └── ...
   # No package.json at migrations/ level
   ```

## Solution

Add the migrations package.json to the Tauri bundle resources.

### File to modify

**`src-tauri/tauri.conf.json`** - Add `"../migrations/package.json"` to the resources array:

```json
"resources": [
  "../agents/package.json",
  "../agents/dist/**/*",
  "../agents/node_modules/@anthropic-ai/**/*",
  "../core/sdk/template/README.md",
  "../core/sdk/template/build.ts",
  "../core/sdk/template/package.json",
  "../core/sdk/template/tsconfig.json",
  "../core/sdk/template/mort-types/**/*",
  "../core/sdk/template/src/**/*",
  "../migrations/package.json",   // <-- ADD THIS LINE
  "../migrations/dist/**/*",
  "../sdk-runner.js",
  "../sdk-types.d.ts"
]
```

## Alternative Solutions Considered

1. **Rename files to .mjs** - Would require changing tsconfig and all import paths. More invasive.

2. **Bundle migrations with esbuild** - Could create a single CommonJS bundle, but adds build complexity.

3. **Use --experimental-detect-module flag** - Node.js flag for auto-detection. Not reliable across Node versions.

The simplest fix is to include the package.json file in the bundle.

## Verification Steps

After applying the fix:

1. Rebuild the app: `pnpm tauri build`
2. Verify package.json is bundled: `ls /Applications/Mort.app/Contents/Resources/_up_/migrations/`
3. Run the app and check logs - should see `[INFO] TypeScript migrations complete` instead of the warning

## Phases

- [x] Diagnose the root cause
- [x] Apply the fix to tauri.conf.json
- [x] Rebuild and verify
