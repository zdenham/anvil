# Hide External Worktrees by Default

Change `hideExternalWorktrees` default from `false` to `true` so external worktrees are hidden by default, while preserving the existing settings toggle to override.

## Phases

- [x] Flip the default value from `false` to `true` in all locations

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

The full infrastructure already exists (from `plans/completed/external-worktree-badge.md`):
- `hideExternalWorktrees` field in `WorkspaceSettingsSchema` (`src/entities/settings/types.ts:72`)
- Filtering logic in `useTreeData` (`src/hooks/use-tree-data.ts:352-354`)
- Settings toggle in `SidebarSettings` (`src/components/main-window/settings/sidebar-settings.tsx`)
- "external" badge on worktree items (`src/components/tree-menu/worktree-item.tsx:208`)

The only change is flipping the default from `false` → `true`.

## Changes

Three locations where the default `false` needs to become `true`:

1. **`src/entities/settings/types.ts:70`** — Update JSDoc comment:
   ```
   - * Optional for backwards compatibility — defaults to false (show all).
   + * Optional for backwards compatibility — defaults to true (hide external).
   ```

2. **`src/entities/settings/store.ts:62`** — Selector default:
   ```
   - getHideExternalWorktrees: () => get().workspace.hideExternalWorktrees ?? false,
   + getHideExternalWorktrees: () => get().workspace.hideExternalWorktrees ?? true,
   ```

3. **`src/hooks/use-tree-data.ts:304`** — Tree data filtering:
   ```
   - const hideExternal = useSettingsStore((s) => s.workspace.hideExternalWorktrees ?? false);
   + const hideExternal = useSettingsStore((s) => s.workspace.hideExternalWorktrees ?? true);
   ```

4. **`src/components/main-window/settings/sidebar-settings.tsx:7`** — Settings UI checkbox:
   ```
   - (s) => s.workspace.hideExternalWorktrees ?? false,
   + (s) => s.workspace.hideExternalWorktrees ?? true,
   ```

No schema changes needed — the field is already `z.boolean().optional()`. Users who previously set the value explicitly will keep their preference. Only users with no saved value will see the new default.
