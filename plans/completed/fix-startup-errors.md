# Fix Startup Hydration Errors

## Problem

Two errors appear at startup:

1. **SKILL.md ENOENT (FATAL)** — `syncManagedSkills` crashes hydration because `fs_copy_file` uses `cp()` from `node:fs/promises` which internally does `stat(dest)` → `unlink(dest)` → `copyFile(src, dest)`. This races when multiple windows call `syncManagedSkills` concurrently (it's not gated by `isMainWindow`), causing the second `unlink` to fail with ENOENT after the first already deleted the file. Can also fail on first launch when the destination doesn't exist yet.

2. **gh CLI "not installed" (non-fatal)** — `classifyGhError` in `src/lib/gh-cli/errors.ts:50` uses `lower.includes("not found") && lower.includes("gh")` which is overly broad — it matches API errors like "resource not found" or "not found: gh api..." not just gh-binary-missing cases.

## Root Causes

### SKILL.md ENOENT
Three contributing factors:
1. **Wrong Node API** (`sidecar/src/dispatch/dispatch-fs.ts:77-82`): `fs_copy_file` uses `cp()` which is designed for recursive directory operations. For single-file copies, `copyFile()` is the correct API — it atomically opens with `O_WRONLY|O_CREAT|O_TRUNC`, no stat/unlink cycle.
2. **Multi-window race** (`src/entities/index.ts:212`): `syncManagedSkills()` runs during `hydrateEntities()` for every window — it's not gated by `isMainWindow`. When main window + control panel start concurrently, both fire `fs_copy_file` commands targeting the same SKILL.md files via the shared sidecar process.
3. **No per-file error handling** (`src/lib/skill-sync.ts:52-62`): `copySkillDirectory` has no try/catch, so one failed copy crashes the entire hydration.

### gh CLI classification
- **File**: `src/lib/gh-cli/errors.ts:50-52`
- The pattern `lower.includes("not found") && lower.includes("gh")` matches too many things. Should be more specific to actual "command not found" patterns.

## Phases

- [x] Fix `fs_copy_file` in sidecar to use `copyFile()` instead of `cp()` for single files
- [x] Add per-file error handling in `copySkillDirectory` so one failed copy doesn't crash hydration
- [x] Gate `syncManagedSkills` to main window only to eliminate multi-window race
- [x] Tighten `classifyGhError` pattern to avoid false "not installed" classification
- [x] Test that startup completes without errors

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Fix `fs_copy_file`

In `sidecar/src/dispatch/dispatch-fs.ts`, change the `fs_copy_file` case:

```typescript
// Before
case "fs_copy_file":
  await cp(
    extractArg<string>(args, "from"),
    extractArg<string>(args, "to"),
  );
  return null;

// After — import copyFile from node:fs/promises, use it instead of cp
case "fs_copy_file":
  await copyFile(
    extractArg<string>(args, "from"),
    extractArg<string>(args, "to"),
  );
  return null;
```

Add `copyFile` to the existing import from `node:fs/promises`.

### Phase 2: Add resilience to `copySkillDirectory`

In `src/lib/skill-sync.ts`, wrap the `fs.copyFile` call in `copySkillDirectory` with try/catch:

```typescript
async function copySkillDirectory(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst);
  const entries = await fs.listDir(src);
  for (const entry of entries) {
    try {
      if (entry.isDirectory) {
        await copySkillDirectory(`${src}/${entry.name}`, `${dst}/${entry.name}`);
      } else {
        await fs.copyFile(`${src}/${entry.name}`, `${dst}/${entry.name}`);
      }
    } catch (e) {
      logger.warn(`[skill-sync] Failed to copy ${entry.name} from ${src}:`, e);
    }
  }
}
```

### Phase 3: Gate `syncManagedSkills` to main window only

In `src/entities/index.ts`, move `syncManagedSkills()` inside the existing `isMainWindow` guard. Only one window needs to write skill files to disk — all windows read from the same `~/.anvil/skills/` directory. The settings UI re-sync (`src/components/main-window/settings/skills-settings.tsx:25`) is fine since it only runs from the main window on user action.

```typescript
// In hydrateEntities(), move line 212 inside the isMainWindow block:
if (isMainWindow) {
  await timed("syncManagedSkills", () => syncManagedSkills());
  await timed("gatewayChannelService.hydrate", () => gatewayChannelService.hydrate());
  // ... rest of existing isMainWindow block ...
}
```

### Phase 4: Tighten gh CLI error classification

In `src/lib/gh-cli/errors.ts`, make the "not installed" check more specific:

```typescript
// Before
if (lower.includes("not found") && lower.includes("gh")) {
  return new GhCliNotInstalledError();
}

// After — match actual "command not found" patterns
if (
  lower.includes("command not found") ||
  lower.includes("gh: not found") ||
  (lower.includes("not found") && lower.includes("executable"))
) {
  return new GhCliNotInstalledError();
}
```

Also check if the Tauri `Command.create("gh", ...)` in `executor.ts:31` throws a different error type when the binary isn't found (it may not go through `classifyGhError` at all).
