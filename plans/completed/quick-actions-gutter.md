# Quick Actions Gutter

Coordinated plan for the bottom status bar (VS Code-style gutter) and the quick actions auto-build infrastructure that feeds it.

## Context

Quick actions are user-defined scripts in `~/.anvil/quick-actions/`. They need two improvements:

1. **Auto-build** — Currently users must manually `pnpm build` + click "Reload Actions". We want the app to build on startup and the settings button to trigger a real build.
2. **Bottom gutter** — Quick actions are currently disabled in the UI (commented out in `ThreadInputSection`). We want them in a thin VS Code-style status bar at the bottom of the main window, alongside the status legend.

### Current Auto-Build Flow
1. `quick-actions-init.ts` copies the template project (excluding `node_modules`) on first launch
2. User manually runs `pnpm install` + `pnpm build` in `~/.anvil/quick-actions/`
3. On app startup, `quickActionService.hydrate()` reads `dist/manifest.json` into the store
4. Settings has a "Reload Actions" button that just re-reads the manifest (does not build)

### Current UI State
- **StatusLegend** lives at the bottom of the left sidebar (`main-window-layout.tsx:779-781`), wrapped in `px-3 py-2 border-t border-surface-800`
- **QuickActionsPanel** (`quick-actions-panel.tsx`) is currently commented out / disabled in `ThreadInputSection`
- Quick actions have arrow-key navigation (`quick-actions-panel.tsx:97-184`) which should be removed
- Quick action hotkeys already exist (`use-quick-action-hotkeys.ts`) using `Cmd+0-9`

## Phases

- [x] Create `buildQuickActions()` function
- [x] Wire background build into app startup
- [x] Update settings "Reload Actions" button to trigger a real build
- [x] Handle `pnpm install` when `node_modules` is missing
- [x] Create `BottomGutter` component with legend left, quick actions right
- [x] Wire `BottomGutter` into `MainWindowLayout`, remove StatusLegend from sidebar
- [x] Simplify `QuickActionsPanel` — strip arrow nav, muted styling
- [x] Re-enable `useQuickActionHotkeys` and clean up unused code

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Gutter Design

```
┌─────────────────────────────────────────────────────┐
│ Window Titlebar  (border-b border-dashed ...)       │
├─────────────────────────────────────────────────────┤
│ Left Panel │        Center Panel       │ Right Panel │
│            │                           │             │
│            │                           │             │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
│ ● Running  ● Needs Input  ● Unread    /commit  /pr │
└─────────────────────────────────────────────────────┘
```

- Full-width bar below all panels (outside the flex row, same level as titlebar)
- Border: `border-t border-dashed border-surface-600/40` (matches titlebar's `border-b border-dashed border-surface-600/40`)
- Height: thin — same density as titlebar (~24-28px), using `text-xs` / `text-[10px]`
- Background: `bg-surface-900` (same as main window)
- Left side: StatusLegend (as-is)
- Right side: Quick actions, rendered muted (`text-surface-600`, no border on pills, no selected state)

## Phase Details

### 1. Create `buildQuickActions()` — `src/lib/quick-actions-build.ts`

New file (~50 lines):

```ts
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { quickActionService } from '@/entities/quick-actions/service.js';
import { logger } from '@/lib/logger-client.js';
import { getQuickActionsProjectPath } from '@/lib/paths.js';
```

**`buildQuickActions(): Promise<{ success: boolean; error?: string }>`**
- Resolve `projectPath` via `getQuickActionsProjectPath()`
- Check `projectPath` exists, bail early if not
- Check if `node_modules/` exists; if not, run `pnpm install` first (Phase 4)
- Resolve `shellPath` via `invoke<string>("get_shell_path")`
- Run build using `pnpm --dir`:
  ```
  Command.create('pnpm', ['--dir', projectPath, 'build'], { env: { PATH: shellPath } })
  ```
- Await execution, capture stdout/stderr
- On success: call `quickActionService.reloadManifest()` to re-hydrate
- On failure: log error, return failure result
- Add a module-level lock (simple boolean) to prevent concurrent builds

### 2. Wire background build into app startup

In `src/entities/index.ts`, after the existing `quickActionService.hydrate()` call:

```ts
await timed("quickActionService.hydrate", () => quickActionService.hydrate());

// Fire-and-forget background build (non-blocking)
buildQuickActions().catch((e) => {
  logger.warn('Background quick actions build failed', { error: String(e) });
});
```

The store first hydrates from the existing `dist/manifest.json` (fast), then a background build kicks off. When it finishes, `reloadManifest()` updates the store. If it fails, the old manifest is still loaded.

### 3. Update settings "Reload Actions" button

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

Update UI text: Button → "Rebuild Actions". Remove the manual `npm run build` instruction, replace with "Edit actions in `~/.anvil/quick-actions/src/actions/`, then click Rebuild".

### 4. Handle `pnpm install` when `node_modules` is missing

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

### 5. Create `BottomGutter` component — `src/components/ui/bottom-gutter.tsx`

```tsx
// Thin full-width bar at bottom of window
// Left: StatusLegend
// Right: QuickActionsPanel (muted variant)
// Border matches titlebar: border-t border-dashed border-surface-600/40
```

- Uses `flex items-center justify-between px-3 py-1`
- Renders `<StatusLegend />` on the left
- Renders a simplified quick actions list on the right

### 6. Wire into `MainWindowLayout`, remove legend from sidebar

Insert `<BottomGutter />` between the main `flex flex-1 min-h-0` row and the debug panel:

```tsx
{/* Main horizontal layout */}
<div className="flex flex-1 min-h-0">
  {/* ... panels ... */}
</div>

{/* Bottom gutter */}
<BottomGutter />

{/* Debug Panel (Cmd+Shift+D) */}
{debugPanelOpen && ( ... )}
```

Delete the StatusLegend from the left sidebar (lines 779-781):
```tsx
// Remove:
<div className="px-3 py-2 border-t border-surface-800">
  <StatusLegend />
</div>
```

### 7. Simplify `QuickActionsPanel`

**Strip out:**
- `selectedIndex` state and all related logic
- `handleKeyDown` keyboard handler (arrow nav, Enter, Escape)
- `findThreadInput` helper
- `focusin` / `input` event listeners
- `isSelected` prop from `ActionItem`

**Keep:**
- Action list rendering
- Click-to-execute
- `isExecuting` / `executingAction` state
- Empty state (update to fit gutter — no border, just text)

**Restyle `ActionItem`:**
- Remove `border` — use plain text buttons
- `text-surface-600 hover:text-surface-400` (more muted than current)
- Keep `font-mono text-[10px]` sizing
- Add hotkey hint badge: small `text-surface-700` label like `⌘1` next to the action title

### 8. Re-enable hotkeys and cleanup

- Uncomment `useQuickActionHotkeys()` on line 75 of `main-window-layout.tsx`
- Remove `QuickActionsPanel` import from `thread-input-section.tsx` if still present
- Remove the `contextType` prop from `QuickActionsPanel` if no longer needed
- Delete arrow-nav related code (~90 lines from `quick-actions-panel.tsx`)

## Files Changed

| File | Change |
|------|--------|
| `src/lib/quick-actions-build.ts` | **New** — `buildQuickActions()` function |
| `src/entities/index.ts` | Add fire-and-forget `buildQuickActions()` call after hydrate |
| `src/components/settings/quick-actions-settings.tsx` | Wire button to `buildQuickActions()`, update copy |
| `src/components/ui/bottom-gutter.tsx` | **New** — `BottomGutter` component |
| `src/components/main-window/main-window-layout.tsx` | Add `<BottomGutter />`, remove sidebar legend, uncomment hotkeys |
| `src/components/quick-actions/quick-actions-panel.tsx` | Strip arrow nav, muted styling, hotkey hints |
| `src/components/reusable/thread-input-section.tsx` | Remove old QuickActionsPanel import |
