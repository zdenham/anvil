# Plan: Agent Hot Reload

## Goal

Enable hot reloading for the agent runner during development so changes to `agents/src/*.ts` are picked up without restarting the app.

---

## Background: How Tauri Resource Resolution Works

### Development Mode
- Tauri's `resolveResource` points to copied files in `src-tauri/target/debug/_up_/`
- These are copies, not the source files - changes require rebuild
- For hot reload, we need to bypass Tauri and use filesystem paths directly

### Production Mode
- Tauri bundles resources into the app package
- `resources` in `tauri.conf.json` specifies what to bundle (relative to `src-tauri/`)
- `../agents/dist/**/*` becomes `_up_/agents/dist/**/*` in the bundle
- `resolveResource("_up_/agents/dist/runner.js")` returns the absolute path in the bundle

### The `_up_/` Prefix Convention
Tauri converts `../` prefixes in `resources` config to `_up_/` internally:

| tauri.conf.json | resolveResource path |
|-----------------|---------------------|
| `"../agents/dist/**/*"` | `"_up_/agents/dist/runner.js"` |
| `"../agents/node_modules/**/*"` | `"_up_/agents/node_modules"` |

---

## Bug Fix: Original Dev Mode Approach Broken

### What Went Wrong

The original implementation used:
```typescript
runnerPath = new URL("../../agents/dist/runner.js", import.meta.url).pathname;
```

This assumes `import.meta.url` returns a `file://` URL, but in Vite's dev server it returns an HTTP URL like `http://localhost:1420/src/lib/agent-service.ts`. When you call `.pathname` on a relative URL resolved against an HTTP base, you get a web path (`/agents/dist/runner.js`) not a filesystem path.

**Result:** Node.js tries to load `/agents/dist/runner.js` from the filesystem root, which doesn't exist.

### The Fix

Use Vite's `define` config to inject the project root at build time as a compile-time constant.

---

## Step 1: Vite Config - Expose Project Root

Add to `vite.config.ts`:

```typescript
export default defineConfig(async () => ({
  plugins: [react()],

  // Expose project root for dev mode agent paths
  define: {
    __PROJECT_ROOT__: JSON.stringify(process.cwd()),
  },
  // ...
}));
```

---

## Step 2: TypeScript Declaration

Add type declaration for the global constant. Create or update `src/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />

declare const __PROJECT_ROOT__: string;
```

---

## Step 3: Dev Path Detection

Modify `src/lib/agent-service.ts` to use the injected constant:

```typescript
if (isDev) {
  // __PROJECT_ROOT__ is injected by Vite's define config at build time
  runnerPath = `${__PROJECT_ROOT__}/agents/dist/runner.js`;
  nodeModulesPath = `${__PROJECT_ROOT__}/agents/node_modules`;
  logger.info(`[agent] Dev mode paths - runner: ${runnerPath}, NODE_PATH: ${nodeModulesPath}`);
} else {
  // In production, use bundled resources
  // Note: Tauri converts "../" prefixes in resources config to "_up_/" in the bundle
  runnerPath = await resolveResource("_up_/agents/dist/runner.js");
  const agentsDistDir = await dirname(runnerPath);
  const agentsDir = await dirname(agentsDistDir);
  nodeModulesPath = await join(agentsDir, "node_modules");
  logger.info(`[agent] Prod mode paths - runner: ${runnerPath}, NODE_PATH: ${nodeModulesPath}`);
}
```

---

## Step 4: Update Dev Script

Modify root `package.json` to run all watchers concurrently:

```json
{
  "scripts": {
    "dev": "concurrently -n vite,agents,tauri -c blue,green,yellow \"vite\" \"pnpm dev:agents\" \"tauri dev\" 2>&1 | tee logs/dev.log"
  }
}
```

This runs:
- **vite**: Frontend hot reload
- **pnpm dev:agents**: tsup watch (agent rebuilds on source change)
- **tauri dev**: Rust backend + app window

---

## Step 5: Verify tauri.conf.json

Ensure `src-tauri/tauri.conf.json` includes both agent directories:

```json
{
  "bundle": {
    "resources": [
      "../agents/dist/**/*",
      "../agents/node_modules/**/*"
    ]
  }
}
```

Both are required:
- `agents/dist/` - The compiled runner.js
- `agents/node_modules/` - Runtime dependencies (Node.js needs these via NODE_PATH)

---

## Potential Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Dev: `ENOENT /agents/dist/runner.js` | `import.meta.url` returns HTTP URL | Use `__PROJECT_ROOT__` from Vite define |
| Dev: `__PROJECT_ROOT__ is not defined` | Missing Vite define config | Add `define` to vite.config.ts |
| Dev: TypeScript error on `__PROJECT_ROOT__` | Missing type declaration | Add declaration to vite-env.d.ts |
| Prod: `resolveResource` returns null | Resource not in tauri.conf.json | Verify `resources` array is complete |
| Prod: `Cannot find module` | NODE_PATH not set correctly | Ensure nodeModulesPath calculated from runner path |
| Both: Different paths on macOS/Windows/Linux | Path separators differ | Use Tauri's `join()` and `dirname()` APIs |

---

## Testing Checklist

### Development Mode
1. [ ] `__PROJECT_ROOT__` defined in `vite.config.ts`
2. [ ] Type declaration in `vite-env.d.ts`
3. [ ] Run `pnpm dev` - all three processes start
4. [ ] Check logs for "Dev mode paths" with correct absolute paths
5. [ ] Modify `agents/src/runner.ts` - tsup rebuilds
6. [ ] Trigger agent in app - uses updated code without restart

### Production Mode
1. [ ] Run `pnpm build && pnpm tauri build`
2. [ ] Inspect bundle: verify `_up_/agents/dist/` and `_up_/agents/node_modules/` exist
3. [ ] Launch built app
4. [ ] Check logs for "Prod mode paths" pointing to bundle location
5. [ ] Trigger agent - executes successfully

---

## Files to Modify

| File | Change |
|------|--------|
| `vite.config.ts` | Add `__PROJECT_ROOT__` define |
| `src/vite-env.d.ts` | Add type declaration for `__PROJECT_ROOT__` |
| `src/lib/agent-service.ts` | Use `__PROJECT_ROOT__` for dev mode paths |
| `package.json` | Update dev script for concurrent processes |
| `src-tauri/tauri.conf.json` | Verify resources include agents/dist and agents/node_modules |
