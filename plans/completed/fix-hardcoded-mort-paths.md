# Fix Hardcoded `.mort` Paths That Ignore App Suffix

## Problem

When running a dev build (with `MORT_APP_SUFFIX=dev`), several code paths hardcode `~/.mort` instead of using the suffix-aware path (`~/.mort-dev`). This means dev builds can accidentally read from or write to the production `.mort` directory, causing cross-contamination between environments.

## Affected Locations

### 1. `src/lib/tauri-commands.ts:436` — `removeRepositoryData`

```typescript
const mortDir = `${homeDir}/.mort`;  // BUG: hardcoded, ignores suffix
```

This function constructs the mort directory path by hardcoding `/.mort` instead of calling `fs.getDataDir()` (which resolves the suffix-aware path via the Tauri backend). When a user removes a repository in a dev build, this deletes from `~/.mort/repositories/` instead of `~/.mort-dev/repositories/`.

### 2. `agents/src/lib/persistence-node.ts:26` — `NodePersistence` fallback

```typescript
this.mortDir = mortDir ?? process.env.MORT_DATA_DIR ?? join(homedir(), ".mort");
```

The final fallback is `~/.mort`. In the normal flow, `MORT_DATA_DIR` is set by `agent-service.ts:780` when spawning agents from the Tauri app, so this fallback is unlikely to be hit in practice. However, if an agent is ever spawned without `MORT_DATA_DIR` set (e.g., CLI usage, tests, or a bug in the spawn path), it silently falls back to production `.mort`.

### 3. `core/lib/skills/skills-service.ts:18` — `SKILL_LOCATIONS` fallback

```typescript
{ getPath: (_, home, mortDir) => mortDir ? `${mortDir}/skills` : `${home}/.mort/skills`, ... }
```

If `mortDataDir` is not passed to `discover()`, the fallback is `~/.mort/skills`. Same risk as #2 — normally the callers provide `mortDir`, but the fallback is wrong when they don't.

## Impact Assessment

- **#1 is a real bug**: `removeRepositoryData` always uses `~/.mort` regardless of build suffix. If a user on dev removes a repo, it targets the wrong directory.
- **#2 and #3 are latent bugs**: They work correctly when callers set `MORT_DATA_DIR` or pass `mortDir`, but fail silently to the wrong directory if those are ever missing.

## Proposed Fix

### Fix 1: `src/lib/tauri-commands.ts` — Use `getDataDir()` instead of hardcoding

Replace the hardcoded path with the Tauri-backed suffix-aware resolution:

```typescript
removeRepositoryData: async (repoSlug: string): Promise<void> => {
  const mortDir = await new FilesystemClient().getDataDir();
  return invoke<void>("remove_repository_data", { repoSlug, mortDir });
},
```

Or if `FilesystemClient` is already available in scope, use the existing instance.

### Fix 2: `agents/src/lib/persistence-node.ts` — Make the fallback suffix-aware

The agent should read the suffix from `MORT_APP_SUFFIX` env var (which the Tauri backend could propagate), or at minimum log a warning when falling back to the hardcoded path. A pragmatic fix:

```typescript
constructor(mortDir?: string) {
  super();
  this.mortDir = mortDir ?? process.env.MORT_DATA_DIR ?? join(homedir(), ".mort");
  if (!mortDir && !process.env.MORT_DATA_DIR) {
    console.warn("[NodePersistence] No mortDir or MORT_DATA_DIR provided, falling back to ~/.mort");
  }
}
```

The fallback value itself is acceptable as a last resort (production is the safe default), but the warning ensures it's visible when it happens unexpectedly during dev.

### Fix 3: `core/lib/skills/skills-service.ts` — Same approach as #2

The fallback `${home}/.mort/skills` is acceptable as a last resort but should ideally never be hit. Since `SkillsService` is a shared core module used in both frontend and agent contexts, it can't import Tauri APIs. The fix is to ensure all callers always pass `mortDataDir` — which they already do today. The fallback can remain but should be documented as a production-only default.

## Phases

- [x] Fix `removeRepositoryData` in `src/lib/tauri-commands.ts` to use suffix-aware path
- [x] Add warning log in `NodePersistence` fallback path
- [x] Audit for any other hardcoded `.mort` paths that may have been missed (grep for patterns)
- [x] Verify the fix by checking `MORT_DATA_DIR` propagation in agent spawn paths

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
