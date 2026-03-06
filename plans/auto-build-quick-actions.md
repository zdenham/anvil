# Auto-Build Quick Actions on Startup

## Context

Quick actions live in `~/.mort/quick-actions/` — a Node.js project that must be built (`pnpm build` → `tsx build.ts`) to produce `dist/manifest.json`. Currently users must manually run `npm run build` in a terminal, then click "Reload Actions" in settings. We want to automate this so quick actions are always up to date.

### Current Flow
1. `quick-actions-init.ts` copies the template project (excluding `node_modules`) on first launch
2. User manually runs `pnpm install` + `pnpm build` in `~/.mort/quick-actions/`
3. On app startup, `quickActionService.hydrate()` reads `dist/manifest.json` into the store
4. Settings has a "Reload Actions" button that just re-reads the manifest (does not build)

### Desired Flow
1. On app startup (after hydration), kick off a background build of `~/.mort/quick-actions/`
2. When complete, re-hydrate the manifest so new/changed actions appear
3. The "Reload Actions" button in settings should also trigger a real build (not just re-read)
4. None of this blocks the hot path

## Phases

- [ ] Create `buildQuickActions()` function in `src/lib/quick-actions-build.ts`
- [ ] Wire background build into app startup
- [ ] Update settings "Reload Actions" button to trigger a real build
- [ ] Handle `pnpm install` when `node_modules` is missing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create `buildQuickActions()` in `src/lib/quick-actions-build.ts`

New file `src/lib/quick-actions-build.ts` (~50 lines):

```ts
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { quickActionService } from '@/entities/quick-actions/service.js';
import { logger } from '@/lib/logger-client.js';
import { getQuickActionsProjectPath } from '@/lib/paths.js';
```

**`buildQuickActions(): Promise<{ success: boolean; error?: string }>`**
- Resolve `projectPath` via `getQuickActionsProjectPath()` (or `appData.getAbsolutePath('quick-actions')`)
- Check `projectPath` exists, bail early if not (project not initialized)
- Check if `node_modules/` exists under `projectPath`; if not, run `pnpm install` first (Phase 4)
- Resolve `shellPath` via `invoke<string>("get_shell_path")` (same pattern as `quick-action-executor.ts:163`)
- Run `Command.create('node', [...buildArgs], { env: { PATH: shellPath }, cwd: projectPath })` — the build script is `build.ts` so we need to run `npx tsx build.ts` or `node node_modules/.bin/tsx build.ts`. Simplest: use `pnpm` directly since it's in the shell scope:
  ```
  Command.create('pnpm', ['build'], { env: { PATH: shellPath }, cwd: projectPath })
  ```

  **Problem**: `Command.create` doesn't support `cwd`. The Tauri shell plugin doesn't have a cwd option. Looking at how `quick-action-executor.ts` handles this — it passes absolute paths as args to `node`. So we should do:
  ```
  Command.create('node', [
    path.join(projectPath, 'node_modules', '.bin', 'tsx'),
    path.join(projectPath, 'build.ts')
  ], { env: { PATH: shellPath } })
  ```

  Actually, looking at the existing `node_modules` structure, `tsx` is at `.pnpm/tsx@.../node_modules/tsx`. The simpler approach is to use `npx` or resolve the bin path. But `npx` isn't in the Tauri shell scope.

  **Best approach**: Use `node` with `--import tsx` or just run the build.ts with tsx resolved. Actually the simplest: use `node` to run a small inline script that `cd`s and runs the build, OR just pass the absolute path to tsx:
  ```
  Command.create('node', [
    projectPath + '/node_modules/.pnpm/tsx@4.../node_modules/tsx/dist/cli.mjs',
    projectPath + '/build.ts'
  ])
  ```

  That's fragile. Better: just use `pnpm` (which IS in the shell scope) with `--dir`:
  ```
  Command.create('pnpm', ['--dir', projectPath, 'build'], { env: { PATH: shellPath } })
  ```
  `pnpm --dir <path> build` runs the build script in the specified directory. This is clean and uses existing shell scope permissions.

- Await execution, capture stdout/stderr
- On success: call `quickActionService.reloadManifest()` to re-hydrate
- On failure: log error, return failure result
- Add a module-level lock (simple boolean) to prevent concurrent builds

## Phase 2: Wire background build into app startup

In `src/entities/index.ts`, after the existing `quickActionService.hydrate()` call (~line 174):

```ts
await timed("quickActionService.hydrate", () => quickActionService.hydrate());

// Fire-and-forget background build (non-blocking)
buildQuickActions().catch((e) => {
  logger.warn('Background quick actions build failed', { error: String(e) });
});
```

This means:
- The store first hydrates from whatever `dist/manifest.json` exists (fast, sync with existing built actions)
- Then a background build kicks off
- When it finishes, `reloadManifest()` updates the store with any new/changed actions
- If it fails, we log and move on — the old manifest is still loaded

## Phase 3: Update settings "Reload Actions" button

In `src/components/settings/quick-actions-settings.tsx`, update `handleRebuild`:

```ts
const handleRebuild = async () => {
  setIsRebuilding(true);
  try {
    const result = await buildQuickActions();
    if (result.success) {
      toast.success('Actions rebuilt');
    } else {
      toast.error(`Build failed: ${result.error}`);
    }
  } catch (e) {
    toast.error(`Failed to build: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setIsRebuilding(false);
  }
};
```

Also update the UI text:
- Button: "Rebuild Actions" (instead of "Reload Actions")
- Help text: Remove the manual `npm run build` instruction, replace with something like "Edit actions in `~/.mort/quick-actions/src/actions/`, then click Rebuild"

## Phase 4: Handle `pnpm install` when `node_modules` is missing

Inside `buildQuickActions()`, before running the build:

```ts
const nodeModulesExists = await fs.exists(projectPath + '/node_modules');
if (!nodeModulesExists) {
  logger.info('[quick-actions-build] Installing dependencies...');
  const installCmd = Command.create('pnpm', ['--dir', projectPath, 'install'], {
    env: { PATH: shellPath }
  });
  const installResult = await installCmd.execute();
  if (installResult.code !== 0) {
    return { success: false, error: 'pnpm install failed: ' + installResult.stderr };
  }
}
```

This handles:
- Fresh installs where template was copied but `pnpm install` never ran
- Cases where `node_modules` was deleted

## Files Changed

| File | Change |
|------|--------|
| `src/lib/quick-actions-build.ts` | **New** — `buildQuickActions()` function |
| `src/entities/index.ts` | Add fire-and-forget `buildQuickActions()` call after hydrate |
| `src/components/settings/quick-actions-settings.tsx` | Wire button to `buildQuickActions()`, update copy |
