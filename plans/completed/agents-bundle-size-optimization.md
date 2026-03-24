# Agents Bundle Size Optimization

## Problem

The bundled `anvil.app` is **547MB**, with **523MB (95%)** coming from `agents/node_modules`. This includes:

- Dev dependencies (tsup, typescript, vitest, vite, esbuild) - ~200MB
- Duplicate packages due to pnpm's resolution (2x `@anthropic-ai/claude-agent-sdk` for different zod versions) - 150MB
- Sharp native binaries (not even a direct dependency) - 30MB
- Only ~75MB is actually needed runtime dependencies

The `dist/` folder is only **3.8MB** - the actual bundled code.

## Current Setup

**tsup.config.ts:**

```ts
noExternal: ["glob", "zod"],  // Only these are inlined
// Anthropic SDKs kept external → requires node_modules at runtime
```

**tauri.conf.json:**

```json
"resources": [
  "../agents/package.json",
  "../agents/dist/**/*",
  "../agents/node_modules/**/*"  // Copies EVERYTHING including devDeps
]
```

## Options

### Option 1: Full Bundling with tsup (Recommended)

Bundle all dependencies into the output files, eliminating node_modules entirely.

**Changes:**

```ts
// tsup.config.ts
export default defineConfig({
  entry: ["src/runner.ts", "src/cli/anvil.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/], // Bundle everything
  esbuildOptions(options) {
    options.alias = {
      "@core": resolve(__dirname, "../core"),
      "@": resolve(__dirname, "../src"),
    };
  },
});
```

```json
// tauri.conf.json
"resources": [
  "../agents/dist/**/*"
]
```

**Pros:**

- Smallest bundle size (estimated ~5-10MB for agents)
- No node_modules resolution issues
- No pnpm symlink problems
- Faster app startup (no module resolution)

**Cons:**

- May hit edge cases with packages that use dynamic requires or `__dirname`
- `@anthropic-ai/claude-agent-sdk` may have bundling issues (needs testing)

**Testing approach:**

1. Build with `noExternal: [/.*/]`
2. Run `node dist/runner.js` directly to test
3. Check for runtime errors related to missing modules or path issues

---

### Option 2: Production-only node_modules

Use pnpm's `--prod` flag or a deploy mechanism to only include production dependencies.

**Approach A: pnpm deploy**

```bash
# In build script
cd agents
pnpm deploy --prod ../agents-prod
```

Then bundle `agents-prod/node_modules` instead.

**Approach B: Selective bundling script**
Create a build script that:

1. Creates a temp directory
2. Copies only `dependencies` (not `devDependencies`)
3. Runs `pnpm install --prod`
4. Bundles that node_modules

**Changes to tauri.conf.json:**

```json
"resources": [
  "../agents-prod/package.json",
  "../agents/dist/**/*",
  "../agents-prod/node_modules/**/*"
]
```

**Pros:**

- Removes dev dependencies (~200MB savings)
- Lower risk than full bundling

**Cons:**

- Still bundles duplicate packages
- Still larger than full bundling
- More complex build process
- pnpm deploy can be finicky

---

### Option 3: Selective External Packages

Keep only truly problematic packages external, bundle the rest.

**Research needed:** Why are Anthropic SDKs kept external? The comment says "runtime resolution" but this needs investigation.

```ts
// Test if these can be bundled
noExternal: [/^(?!@anthropic-ai)/],  // Bundle everything except Anthropic
```

If Anthropic packages CAN be bundled:

```ts
noExternal: [/.*/],  // Bundle everything
```

If they can't, identify exactly which sub-packages need to be external and bundle the rest.

---

### Option 4: Hybrid - Bundle Anthropic SDK Manually

If `@anthropic-ai/claude-agent-sdk` can't be bundled by tsup due to some edge case:

1. Fork/copy the SDK source into the agents package
2. Import from local source instead of node_modules
3. Bundle everything

This is more maintenance but gives full control.

---

## Recommended Path Forward

### Phase 1: Test Full Bundling

1. Create a branch
2. Set `noExternal: [/.*/]` in tsup.config.ts
3. Build and test locally: `pnpm build && node dist/runner.js --help`
4. If it works, test in the full Tauri bundle
5. Document any issues encountered

### Phase 2: Fix Edge Cases (if needed)

- If specific packages fail, add them to an `external` array
- For each external package, document WHY it can't be bundled
- Consider if the package can be replaced with a bundleable alternative

### Phase 3: CI/Build Integration

- Update build scripts to verify bundle works
- Add a size check to CI to prevent regression
- Document the bundling approach for future maintainers

---

## Size Estimates

| Approach                   | Estimated Size | Complexity |
| -------------------------- | -------------- | ---------- |
| Current (all node_modules) | 523MB          | Low        |
| Option 1 (full bundle)     | ~5-10MB        | Medium     |
| Option 2 (prod only)       | ~80-100MB      | Medium     |
| Option 3 (selective)       | ~10-50MB       | Medium     |

---

## Investigation Needed

1. **Why are Anthropic SDKs external?**

   - Test bundling them directly
   - Check for dynamic imports, `__dirname` usage, or native bindings

2. **What packages in claude-agent-sdk cause issues?**

   - It's 75MB per copy - what's in there?
   - Is there a lighter alternative or can unused parts be tree-shaken?

3. **Sharp dependency**
   - Why is it in node_modules? Not listed in package.json
   - Likely a transitive dev dependency - would be eliminated with Option 1 or 2

---

## Commands for Investigation

```bash
# Check what's importing sharp
cd agents && pnpm why sharp

# Test full bundling
cd agents
# Edit tsup.config.ts to set noExternal: [/.*/]
pnpm build
node dist/runner.js --help

# Check bundle size
du -sh dist/

# Check for external imports in bundle
grep -r "require(" dist/ | head -20
grep -r "from ['\"]@" dist/ | head -20
```
